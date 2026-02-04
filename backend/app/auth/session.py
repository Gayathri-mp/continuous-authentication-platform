from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.config import settings
from app.auth.models import Session as SessionModel, User
from app.utils.logger import logger
import uuid


def create_session(
    db: Session,
    user_id: str,
    device_info: Optional[dict] = None
) -> SessionModel:
    """
    Create a new session for a user.
    
    Args:
        db: Database session
        user_id: User ID
        device_info: Optional device information
        
    Returns:
        Created session object
    """
    # Generate session token
    token_data = {
        "user_id": user_id,
        "session_id": str(uuid.uuid4()),
        "exp": datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRATION_MINUTES)
    }
    token = jwt.encode(token_data, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    
    # Create session
    session = SessionModel(
        id=token_data["session_id"],
        user_id=user_id,
        token=token,
        trust_score=100.0,
        status="OK",
        expires_at=token_data["exp"],
        device_info=device_info
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
    """
    Validate a session token.
    
    Args:
        db: Database session
        token: JWT token
        
    Returns:
        Session object if valid, None otherwise
    """
    try:
        # Decode token
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        session_id = payload.get("session_id")
        
        if not session_id:
            return None
        
        # Get session from database
        session = db.query(SessionModel).filter(
            SessionModel.id == session_id,
            SessionModel.token == token,
            SessionModel.is_active == True
        ).first()
        
        if not session:
            return None
        
        # Check expiration
        if session.expires_at < datetime.utcnow():
            session.is_active = False
            session.status = "EXPIRED"
            db.commit()
            return None
        
        # Update last activity
        session.last_activity = datetime.utcnow()
        db.commit()
        
        return session
        
    except JWTError as e:
        logger.error(f"JWT validation error: {str(e)}")
        return None


def revoke_session(db: Session, session_id: str) -> bool:
    """
    Revoke a session.
    
    Args:
        db: Database session
        session_id: Session ID to revoke
        
    Returns:
        True if revoked, False otherwise
    """
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
    """
    Update session trust score and status.
    
    Args:
        db: Database session
        session_id: Session ID
        trust_score: New trust score (0-100)
        
    Returns:
        Updated session object
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    
    if not session:
        return None
    
    session.trust_score = trust_score
    
    # Update status based on trust score
    if trust_score >= settings.TRUST_THRESHOLD_OK:
        session.status = "OK"
    elif trust_score >= settings.TRUST_THRESHOLD_MONITOR:
        session.status = "MONITOR"
    elif trust_score >= settings.TRUST_THRESHOLD_STEPUP:
        session.status = "SUSPICIOUS"
    else:
        session.status = "CRITICAL"
        session.is_active = False
    
    db.commit()
    db.refresh(session)
    
    logger.info(f"Trust score updated", extra={
        "session_id": session_id,
        "trust_score": trust_score,
        "status": session.status
    })
    
    return session
