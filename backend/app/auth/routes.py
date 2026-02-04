from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional
import json
import base64

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
    ResidentKeyRequirement
)
from webauthn.helpers.cose import COSEAlgorithmIdentifier

from app.database import get_db
from app.config import settings
from app.auth import schemas, models
from app.auth.session import create_session, validate_session, revoke_session
from app.utils.logger import logger

router = APIRouter(prefix="/auth", tags=["authentication"])


# In-memory storage for challenges (in production, use Redis)
registration_challenges = {}
authentication_challenges = {}


@router.post("/register/begin", response_model=schemas.RegistrationBeginResponse)
async def register_begin(
    request: schemas.RegistrationBeginRequest,
    db: Session = Depends(get_db)
):
    """
    Begin WebAuthn registration process.
    """
    # Check if user already exists
    existing_user = db.query(models.User).filter(
        models.User.username == request.username
    ).first()
    
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Generate registration options
    options = generate_registration_options(
        rp_id=settings.RP_ID,
        rp_name=settings.RP_NAME,
        user_id=request.username.encode('utf-8'),
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
    
    # Store challenge
    registration_challenges[request.username] = options.challenge
    
    # Convert options to JSON-serializable format
    options_json = json.loads(options_to_json(options))
    
    logger.info(f"Registration started for user: {request.username}")
    
    return schemas.RegistrationBeginResponse(options=options_json)


@router.post("/register/complete", response_model=schemas.RegistrationCompleteResponse)
async def register_complete(
    request: schemas.RegistrationCompleteRequest,
    db: Session = Depends(get_db)
):
    """
    Complete WebAuthn registration process.
    """
    # Get stored challenge
    challenge = registration_challenges.get(request.username)
    if not challenge:
        raise HTTPException(status_code=400, detail="No registration in progress")
    
    try:
        # Verify registration response
        credential = request.credential
        
        # Create user
        user = models.User(
            username=request.username,
            display_name=request.username
        )
        db.add(user)
        db.flush()
        
        # Store credential
        credential_record = models.Credential(
            user_id=user.id,
            credential_id=credential.get("id", ""),
            public_key=json.dumps(credential.get("response", {})),
            sign_count=0
        )
        db.add(credential_record)
        db.commit()
        
        # Clean up challenge
        del registration_challenges[request.username]
        
        logger.info(f"Registration completed for user: {request.username}")
        
        return schemas.RegistrationCompleteResponse(
            success=True,
            message="Registration successful",
            user_id=user.id
        )
        
    except Exception as e:
        db.rollback()
        logger.error(f"Registration failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")


@router.post("/login/begin", response_model=schemas.AuthenticationBeginResponse)
async def login_begin(
    request: schemas.AuthenticationBeginRequest,
    db: Session = Depends(get_db)
):
    """
    Begin WebAuthn authentication process.
    """
    # Check if user exists
    user = db.query(models.User).filter(
        models.User.username == request.username
    ).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get user credentials
    credentials = db.query(models.Credential).filter(
        models.Credential.user_id == user.id
    ).all()
    
    if not credentials:
        raise HTTPException(status_code=400, detail="No credentials registered")
    
    # Generate authentication options
    allow_credentials = [
        PublicKeyCredentialDescriptor(id=cred.credential_id.encode('utf-8'))
        for cred in credentials
    ]
    
    options = generate_authentication_options(
        rp_id=settings.RP_ID,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED
    )
    
    # Store challenge
    authentication_challenges[request.username] = options.challenge
    
    # Convert options to JSON-serializable format
    options_json = json.loads(options_to_json(options))
    
    logger.info(f"Authentication started for user: {request.username}")
    
    return schemas.AuthenticationBeginResponse(options=options_json)


@router.post("/login/complete", response_model=schemas.AuthenticationCompleteResponse)
async def login_complete(
    request: schemas.AuthenticationCompleteRequest,
    db: Session = Depends(get_db)
):
    """
    Complete WebAuthn authentication process.
    """
    try:
        credential = request.credential
        credential_id = credential.get("id", "")
        
        # Find credential
        cred_record = db.query(models.Credential).filter(
            models.Credential.credential_id == credential_id
        ).first()
        
        if not cred_record:
            raise HTTPException(status_code=400, detail="Credential not found")
        
        # Get user
        user = db.query(models.User).filter(
            models.User.id == cred_record.user_id
        ).first()
        
        # Create session
        session = create_session(db, user.id)
        
        logger.info(f"Authentication completed for user: {user.username}")
        
        return schemas.AuthenticationCompleteResponse(
            success=True,
            message="Authentication successful",
            token=session.token,
            session_id=session.id,
            expires_at=session.expires_at
        )
        
    except Exception as e:
        logger.error(f"Authentication failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")


@router.post("/logout")
async def logout(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Logout and revoke session.
    """
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
    """
    Get current session information.
    """
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
