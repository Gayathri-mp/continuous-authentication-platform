from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from app.database import get_db
from app.auth.session import validate_session
from app.auth.models import Session as SessionModel
from app.trust.policy import evaluate_policy
from app.utils.logger import logger

router = APIRouter(prefix="/trust", tags=["trust"])


class TrustScoreResponse(BaseModel):
    """Trust score response."""
    session_id: str
    trust_score: float
    status: str
    action: str
    message: str
    require_stepup: bool


class StepUpRequest(BaseModel):
    """Step-up authentication request."""
    session_id: str
    credential: dict


@router.get("/score/{session_id}", response_model=TrustScoreResponse)
async def get_trust_score(
    session_id: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Get current trust score for a session.
    """
    # Validate session
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    if session.id != session_id:
        raise HTTPException(status_code=403, detail="Unauthorized access")
    
    # Evaluate policy
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
    """
    Force trust evaluation for current session.
    """
    # Validate session
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Evaluate policy
    policy = evaluate_policy(session.trust_score, session.status)
    
    logger.info(f"Trust evaluation forced for session {session.id}")
    
    return {
        "session_id": session.id,
        "trust_score": session.trust_score,
        "policy": policy
    }


@router.post("/stepup")
async def handle_stepup(
    request: StepUpRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Handle step-up authentication.
    """
    # Validate session
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    if session.id != request.session_id:
        raise HTTPException(status_code=403, detail="Session ID mismatch")
    
    # In a real implementation, verify the credential here
    # For now, we'll just reset the trust score
    
    session.trust_score = 100.0
    session.status = "OK"
    db.commit()
    
    logger.info(f"Step-up authentication completed for session {session.id}")
    
    return {
        "success": True,
        "message": "Step-up authentication successful",
        "trust_score": session.trust_score
    }
