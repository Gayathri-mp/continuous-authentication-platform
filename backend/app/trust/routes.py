from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
import json

from webauthn import (
    generate_authentication_options,
    verify_authentication_response,
    options_to_json
)
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement
)

from app.database import get_db
from app.config import settings
from app.auth.session import validate_session, update_trust_score, set_challenge, get_challenge, delete_challenge
from app.auth.models import Session as SessionModel, Credential, SecurityAlert
from app.trust.policy import evaluate_policy
from app.utils.logger import logger

router = APIRouter(prefix="/trust", tags=["trust"])


# -------------------------------------------------------------------------
# Response models
# -------------------------------------------------------------------------

class TrustScoreResponse(BaseModel):
    session_id: str
    trust_score: float
    status: str
    action: str
    message: str
    require_stepup: bool


class StepUpBeginResponse(BaseModel):
    options: dict
    message: str


class StepUpCompleteRequest(BaseModel):
    session_id: str
    credential: dict


class AlertResponse(BaseModel):
    id: str
    alert_type: str
    message: str
    severity: str
    trust_score: Optional[float]
    created_at: str


# -------------------------------------------------------------------------
# Trust score endpoints
# -------------------------------------------------------------------------

@router.get("/score/{session_id}", response_model=TrustScoreResponse)
async def get_trust_score(
    session_id: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Get current trust score for a session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    if session.id != session_id:
        raise HTTPException(status_code=403, detail="Unauthorized access")

    policy = evaluate_policy(session.trust_score, session.status)

    return TrustScoreResponse(
        session_id=session.id,
        trust_score=session.trust_score,
        status=session.status,
        action=policy["action"],
        message=policy["message"],
        require_stepup=policy["require_stepup"]
    )


@router.post("/evaluate")
async def force_evaluation(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Force trust evaluation for current session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    policy = evaluate_policy(session.trust_score, session.status)
    logger.info(f"Trust evaluation forced for session {session.id}")

    return {
        "session_id": session.id,
        "trust_score": session.trust_score,
        "policy": policy
    }


# -------------------------------------------------------------------------
# Step-up authentication — two-phase WebAuthn re-authentication
# -------------------------------------------------------------------------

@router.post("/stepup/begin", response_model=StepUpBeginResponse)
async def stepup_begin(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Phase 1 of step-up authentication.
    Returns a fresh WebAuthn challenge tied to the session.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    # Note: allow SUSPICIOUS sessions to begin step-up even though trust is low
    session = db.query(SessionModel).filter(
        SessionModel.token == token,
        SessionModel.is_active == True
    ).first()

    if not session:
        raise HTTPException(status_code=401, detail="No active session found")

    # Fetch user's registered credentials to allow_credentials list
    credentials = db.query(Credential).filter(
        Credential.user_id == session.user_id
    ).all()

    if not credentials:
        raise HTTPException(status_code=400, detail="No credentials registered for user")

    allow_credentials = [
        PublicKeyCredentialDescriptor(id=cred.credential_id.encode("utf-8"))
        for cred in credentials
    ]

    options = generate_authentication_options(
        rp_id=settings.RP_ID,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.REQUIRED  # stricter for step-up
    )

    # Store challenge in DB (namespaced with "stepup:" prefix)
    set_challenge(db, f"stepup:{session.id}", options.challenge)

    options_json = json.loads(options_to_json(options))
    logger.info(f"Step-up challenge issued for session {session.id}")

    return StepUpBeginResponse(
        options=options_json,
        message="WebAuthn challenge issued for step-up authentication"
    )


@router.post("/stepup/complete")
async def stepup_complete(
    request: StepUpCompleteRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Phase 2 of step-up authentication.

    Security guarantees:
      - Validates the stored CBOR challenge bytes match what the authenticator signed
      - Verifies the full WebAuthn assertion signature using the stored CBOR public key
      - Enforces sign_count increment (prevents credential cloning / replay)
      - On ANY verification failure: immediately terminates the session and returns 401

    Trust score is only reset if ALL checks pass.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = db.query(SessionModel).filter(
        SessionModel.token == token,
        SessionModel.is_active == True
    ).first()

    if not session:
        raise HTTPException(status_code=401, detail="No active session found")

    if session.id != request.session_id:
        raise HTTPException(status_code=403, detail="Session ID mismatch")

    # --- Retrieve stored challenge ---
    expected_challenge = get_challenge(db, f"stepup:{session.id}")
    if not expected_challenge:
        raise HTTPException(
            status_code=400,
            detail="No step-up challenge found or it expired — call /trust/stepup/begin again"
        )

    # --- Look up the credential submitted by the client ---
    raw_credential = request.credential
    credential_id = raw_credential.get("id", "")

    cred_record = db.query(Credential).filter(
        Credential.credential_id == credential_id,
        Credential.user_id == session.user_id
    ).first()

    if not cred_record:
        # Credential doesn't belong to this user — terminate immediately
        logger.warning(
            f"Step-up rejected for session {session.id}: credential {credential_id!r} "
            f"not registered to user {session.user_id}"
        )
        _terminate_session_after_failed_stepup(db, session, "Credential not associated with this account")
        raise HTTPException(status_code=401, detail="Step-up failed: credential not found for this user")

    # --- Full WebAuthn assertion verification ---
    try:
        from app.auth.webauthn_helpers import build_authentication_credential
        parsed_credential = build_authentication_credential(raw_credential)

        verification = verify_authentication_response(
            credential=parsed_credential,
            expected_challenge=expected_challenge,
            expected_rp_id=settings.RP_ID,
            expected_origin=settings.RP_ORIGIN,
            credential_public_key=bytes.fromhex(cred_record.public_key),
            credential_current_sign_count=cred_record.sign_count,
            require_user_verification=True,   # stricter for step-up
        )

    except Exception as exc:
        logger.warning(
            f"Step-up WebAuthn verification FAILED for session {session.id}: {exc}"
        )
        # Always terminate — a failed step-up means the presenter cannot prove identity
        _terminate_session_after_failed_stepup(db, session, f"WebAuthn verification failed: {exc}")
        raise HTTPException(status_code=401, detail="Step-up authentication failed — session terminated")

    # --- All checks passed: update sign_count, reset trust ---
    try:
        cred_record.sign_count = verification.new_sign_count
        cred_record.last_used = __import__("datetime").datetime.utcnow()

        session.trust_score = 100.0
        session.status = "OK"
        session.stepup_deadline = None   # clear timeout, resume normal monitoring
        db.commit()

    except Exception as exc:
        db.rollback()
        logger.error(f"DB update failed after successful step-up: {exc}")
        raise HTTPException(status_code=500, detail="Internal error updating session")

    # Clean up the consumed challenge
    delete_challenge(db, f"stepup:{session.id}")

    # Emit success alert
    alert = SecurityAlert(
        session_id=session.id,
        alert_type="STEPUP_SUCCESS",
        message="Step-up authentication verified successfully — trust score reset to 100",
        severity="info",
        trust_score=100.0
    )
    db.add(alert)
    db.commit()

    logger.info(f"Step-up authentication successful for session {session.id}")

    return {
        "success": True,
        "message": "Step-up authentication successful",
        "trust_score": 100.0
    }


def _terminate_session_after_failed_stepup(
    db: Session,
    session: SessionModel,
    reason: str
) -> None:
    """Immediately terminate session and emit a STEPUP_FAILED alert."""
    try:
        alert = SecurityAlert(
            session_id=session.id,
            alert_type="STEPUP_FAILED",
            message=f"Step-up authentication failed — session terminated. Reason: {reason}",
            severity="danger",
            trust_score=session.trust_score
        )
        db.add(alert)
        # Revoke session
        session.is_active = False
        session.status = "TERMINATED"
        session.stepup_deadline = None
        db.commit()
        logger.warning(f"Session {session.id} terminated after failed step-up: {reason}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to terminate session {session.id}: {e}")


# -------------------------------------------------------------------------
# Alerts
# -------------------------------------------------------------------------

@router.get("/alerts/{session_id}", response_model=List[AlertResponse])
async def get_alerts(
    session_id: str,
    limit: int = 20,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Return recent security alerts for a session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    if session.id != session_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    alerts = db.query(SecurityAlert).filter(
        SecurityAlert.session_id == session_id
    ).order_by(SecurityAlert.created_at.desc()).limit(limit).all()

    return [
        AlertResponse(
            id=a.id,
            alert_type=a.alert_type,
            message=a.message,
            severity=a.severity,
            trust_score=a.trust_score,
            created_at=a.created_at.isoformat()
        )
        for a in alerts
    ]
