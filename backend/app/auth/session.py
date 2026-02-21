from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.config import settings
from app.auth.models import Session as SessionModel, User, AuthChallenge
from app.utils.logger import logger
import uuid


# ---------------------------------------------------------------------------
# DB-backed challenge helpers
# ---------------------------------------------------------------------------
# Challenges are stored in the ``auth_challenges`` table with an expiry
# timestamp.  The ``key`` argument uses a prefix to avoid collisions between
# different challenge types:
#   registration → "reg:<username>"
#   login        → "auth:<username>"
#   step-up      → "stepup:<session_id>"
# ---------------------------------------------------------------------------

_CHALLENGE_TTL_SECONDS = 300


def _purge_expired(db: Session) -> None:
    """Delete all expired challenge rows (housekeeping, called as a side-effect)."""
    now = datetime.now(timezone.utc)
    db.query(AuthChallenge).filter(AuthChallenge.expires_at <= now).delete(synchronize_session=False)
    db.commit()


def set_challenge(db: Session, key: str, challenge: bytes, ttl: int = _CHALLENGE_TTL_SECONDS) -> None:
    """Persist a WebAuthn challenge to the DB, replacing any existing row for *key*."""
    _purge_expired(db)
    # Remove any previous challenge for this key (e.g. user retried begin)
    db.query(AuthChallenge).filter(AuthChallenge.username == key).delete(synchronize_session=False)
    db.add(AuthChallenge(
        username=key,
        challenge=challenge.hex(),
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl)
    ))
    db.commit()


def get_challenge(db: Session, key: str) -> Optional[bytes]:
    """Retrieve a challenge from the DB and return it as bytes.

    Returns ``None`` if the key is not found or the row has expired.
    Expired rows are deleted eagerly.
    """
    now = datetime.now(timezone.utc)
    row = db.query(AuthChallenge).filter(AuthChallenge.username == key).first()
    if row is None:
        return None
    if row.expires_at.replace(tzinfo=timezone.utc) <= now:
        db.delete(row)
        db.commit()
        return None
    return bytes.fromhex(row.challenge)


def delete_challenge(db: Session, key: str) -> None:
    """Delete a challenge row after successful verification."""
    db.query(AuthChallenge).filter(AuthChallenge.username == key).delete(synchronize_session=False)
    db.commit()


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def create_session(db: Session, user_id: str) -> SessionModel:
    """Create a new session for a user."""
    token_data = {
        "user_id": user_id,
        "session_id": str(uuid.uuid4()),
        "exp": datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRATION_MINUTES)
    }
    token = jwt.encode(token_data, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

    session = SessionModel(
        id=token_data["session_id"],
        user_id=user_id,
        token=token,
        trust_score=100.0,
        status="OK",
        expires_at=token_data["exp"]
    )

    db.add(session)
    db.commit()
    db.refresh(session)

    logger.info(f"Session created for user {user_id}", extra={
        "user_id": user_id,
        "session_id": session.id
    })

    return session


def validate_session(db: Session, token: str) -> Optional[SessionModel]:
    """Validate a session token. Returns None for invalid/expired/terminated sessions."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        session_id = payload.get("session_id")

        if not session_id:
            return None

        session = db.query(SessionModel).filter(
            SessionModel.id == session_id,
            SessionModel.token == token,
            SessionModel.is_active == True
        ).first()

        if not session:
            return None

        if session.expires_at < datetime.utcnow():
            session.is_active = False
            session.status = "EXPIRED"
            db.commit()
            return None

        session.last_activity = datetime.utcnow()
        db.commit()

        return session

    except JWTError as e:
        logger.error(f"JWT validation error: {str(e)}")
        return None


def revoke_session(db: Session, session_id: str) -> bool:
    """Revoke a session (logout or policy termination)."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()

    if not session:
        return False

    session.is_active = False
    session.status = "TERMINATED"
    db.commit()

    logger.info(f"Session revoked", extra={"session_id": session_id})
    return True


def update_trust_score(
    db: Session,
    session_id: str,
    trust_score: float
) -> Optional[SessionModel]:
    """Update session trust score and status based on configured thresholds."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()

    if not session:
        return None

    session.trust_score = trust_score

    if trust_score >= settings.TRUST_THRESHOLD_OK:
        session.status = "OK"
    elif trust_score >= settings.TRUST_THRESHOLD_MONITOR:
        session.status = "MONITOR"
    elif trust_score >= settings.TRUST_THRESHOLD_STEPUP:
        session.status = "SUSPICIOUS"
    else:
        # Do NOT set is_active=False here; the policy engine in events/routes does it
        # after emitting the TERMINATED alert.
        session.status = "CRITICAL"

    db.commit()
    db.refresh(session)

    logger.info(f"Trust score updated", extra={
        "session_id": session_id,
        "trust_score": trust_score,
        "status": session.status
    })

    return session
