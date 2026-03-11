from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional
import json

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json
)
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement,
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
)
from webauthn.helpers.cose import COSEAlgorithmIdentifier

from app.database import get_db
from app.config import settings
from app.auth import schemas, models
from app.auth.session import (
    create_session, validate_session, revoke_session,
    set_challenge, get_challenge, delete_challenge
)
from app.auth.webauthn_helpers import build_registration_credential, build_authentication_credential, b64url_decode
from app.utils.logger import logger

router = APIRouter(prefix="/auth", tags=["authentication"])


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

@router.post("/register/begin", response_model=schemas.RegistrationBeginResponse)
async def register_begin(
    request: schemas.RegistrationBeginRequest,
    db: Session = Depends(get_db)
):
    """Begin WebAuthn registration process."""
    existing_user = db.query(models.User).filter(
        models.User.username == request.username
    ).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    options = generate_registration_options(
        rp_id=settings.RP_ID,
        rp_name=settings.RP_NAME,
        user_id=request.username,
        user_name=request.username,
        user_display_name=request.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED
        ),
        supported_pub_key_algs=[
            COSEAlgorithmIdentifier.ECDSA_SHA_256,
            COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256
        ]
    )

    # Store challenge in DB (namespaced with "reg:" prefix)
    set_challenge(db, f"reg:{request.username}", options.challenge)

    options_json = json.loads(options_to_json(options))
    logger.info(f"Registration started for user: {request.username}")

    return schemas.RegistrationBeginResponse(options=options_json)


@router.post("/register/complete", response_model=schemas.RegistrationCompleteResponse)
async def register_complete(
    request: schemas.RegistrationCompleteRequest,
    db: Session = Depends(get_db)
):
    """
    Complete WebAuthn registration.
    Verifies the attestation, stores the CBOR-encoded public key bytes (hex)
    so that future authentications and step-ups can perform full signature verification.
    """
    challenge = get_challenge(db, f"reg:{request.username}")
    if not challenge:
        raise HTTPException(status_code=400, detail="No registration in progress or challenge expired")

    try:
        raw_credential = request.credential
        parsed_credential = build_registration_credential(raw_credential)

        verification = verify_registration_response(
            credential=parsed_credential,
            expected_challenge=challenge,
            expected_rp_id=settings.RP_ID,
            expected_origin=settings.RP_ORIGIN,
        )

    except Exception as e:
        logger.error(f"Registration verification failed for {request.username}. Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"WebAuthn registration verification failed: {e}")

    try:
        user = models.User(
            username=request.username,
            display_name=request.username
        )
        db.add(user)
        db.flush()

        credential_record = models.Credential(
            user_id=user.id,
            # credential_id stored as base64url string (matches what browser sends back)
            credential_id=raw_credential.get("id", ""),
            # CBOR public key bytes stored as hex — used for signature verification
            public_key=verification.credential_public_key.hex(),
            sign_count=verification.sign_count,
        )
        db.add(credential_record)
        db.commit()

        delete_challenge(db, f"reg:{request.username}")
        logger.info(f"Registration completed for user: {request.username}")

        return schemas.RegistrationCompleteResponse(
            success=True,
            message="Registration successful",
            user_id=user.id
        )

    except Exception as e:
        db.rollback()
        logger.error(f"Registration DB write failed: {e}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {e}")


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post("/login/begin", response_model=schemas.AuthenticationBeginResponse)
async def login_begin(
    request: schemas.AuthenticationBeginRequest,
    db: Session = Depends(get_db)
):
    """Begin WebAuthn authentication process."""
    user = db.query(models.User).filter(
        models.User.username == request.username
    ).first()

    if not user:
        logger.warning(f"Login failed: User '{request.username}' not found in database.")
        raise HTTPException(status_code=404, detail=f"User '{request.username}' not found. Please register first.")

    credentials = db.query(models.Credential).filter(
        models.Credential.user_id == user.id
    ).all()

    if not credentials:
        raise HTTPException(status_code=400, detail="No credentials registered")

    allow_credentials = [
        PublicKeyCredentialDescriptor(id=b64url_decode(cred.credential_id))
        for cred in credentials
    ]

    options = generate_authentication_options(
        rp_id=settings.RP_ID,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED
    )

    # Store challenge in DB (namespaced with "auth:" prefix)
    set_challenge(db, f"auth:{request.username}", options.challenge)

    options_json = json.loads(options_to_json(options))
    logger.info(f"Authentication started for user: {request.username}")

    return schemas.AuthenticationBeginResponse(options=options_json)


@router.post("/demo/login", response_model=schemas.AuthenticationCompleteResponse)
async def demo_login(
    request: schemas.AuthenticationBeginRequest,
    db: Session = Depends(get_db)
):
    """Bypass WebAuthn for demo/testing purposes."""
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=403, detail="Demo login only available in DEMO_MODE")
        
    user = db.query(models.User).filter(
        models.User.username == request.username
    ).first()

    if not user:
        # Create user on the fly if it doesn't exist in demo mode
        user = models.User(username=request.username, display_name=request.username)
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"Demo Mode: Created user {request.username} on the fly")

    session = create_session(db, user.id)
    logger.info(f"Demo login successful for user: {user.username}")

    return schemas.AuthenticationCompleteResponse(
        success=True,
        message="Demo login successful",
        token=session.token,
        session_id=session.id,
        expires_at=session.expires_at
    )


@router.post("/login/complete", response_model=schemas.AuthenticationCompleteResponse)
async def login_complete(
    request: schemas.AuthenticationCompleteRequest,
    db: Session = Depends(get_db)
):
    """Complete WebAuthn authentication process."""
    try:
        raw_credential = request.credential
        credential_id = raw_credential.get("id", "")

        cred_record = db.query(models.Credential).filter(
            models.Credential.credential_id == credential_id
        ).first()

        if not cred_record:
            raise HTTPException(status_code=400, detail="Credential not found")

        user = db.query(models.User).filter(
            models.User.id == cred_record.user_id
        ).first()

        if not user:
            raise HTTPException(status_code=400, detail="User not found")

        # Look up the challenge we issued at login/begin
        challenge = get_challenge(db, f"auth:{user.username}")
        if not challenge:
            raise HTTPException(status_code=400, detail="No login in progress or challenge expired")

        parsed_credential = build_authentication_credential(raw_credential)

        verification = verify_authentication_response(
            credential=parsed_credential,
            expected_challenge=challenge,
            expected_rp_id=settings.RP_ID,
            expected_origin=settings.RP_ORIGIN,
            credential_public_key=bytes.fromhex(cred_record.public_key),
            credential_current_sign_count=cred_record.sign_count,
            require_user_verification=False,  # PREFERRED during login
        )

        # Update sign count (replay-attack protection)
        cred_record.sign_count = verification.new_sign_count
        cred_record.last_used = __import__("datetime").datetime.utcnow()
        db.commit()

        delete_challenge(db, f"auth:{user.username}")

        session = create_session(db, user.id)
        logger.info(f"Authentication completed for user: {user.username}")

        return schemas.AuthenticationCompleteResponse(
            success=True,
            message="Authentication successful",
            token=session.token,
            session_id=session.id,
            expires_at=session.expires_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Authentication failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

@router.post("/logout")
async def logout(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Logout and revoke session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    revoke_session(db, session.id)
    return {"success": True, "message": "Logged out successfully"}


@router.get("/session", response_model=schemas.SessionResponse)
async def get_session(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Get current session information."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    user = db.query(models.User).filter(models.User.id == session.user_id).first()

    return schemas.SessionResponse(
        session_id=session.id,
        user_id=session.user_id,
        username=user.username,
        trust_score=session.trust_score,
        status=session.status,
        created_at=session.created_at,
        last_activity=session.last_activity,
        expires_at=session.expires_at
    )
