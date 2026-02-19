import threading
import time
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.config import settings
from app.auth.models import Session as SessionModel, User
from app.utils.logger import logger
import uuid


# ---------------------------------------------------------------------------
# Thread-safe challenge store with TTL (replaces bare dict)
# Suitable for single-server MVP; replace with Redis for multi-server prod.
# ---------------------------------------------------------------------------
class _ChallengeStore:
    """Thread-safe, TTL-based challenge store."""

    def __init__(self, ttl_seconds: int = 300):
        self._store: dict = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds

    def set(self, key: str, value: bytes) -> None:
        with self._lock:
            self._store[key] = {"value": value, "expires": time.monotonic() + self._ttl}

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.monotonic() > entry["expires"]:
                del self._store[key]
                return None
            return entry["value"]

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def purge_expired(self) -> None:
        now = time.monotonic()
        with self._lock:
            expired_keys = [k for k, v in self._store.items() if now > v["expires"]]
            for k in expired_keys:
                del self._store[k]


# Module-level stores — one for registration, one for authentication,
# one for step-up re-authentication.
registration_challenges = _ChallengeStore(ttl_seconds=300)
authentication_challenges = _ChallengeStore(ttl_seconds=300)
stepup_challenges = _ChallengeStore(ttl_seconds=300)


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
