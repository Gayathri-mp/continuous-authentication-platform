from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional, List
from app.database import get_db
from app.auth.session import validate_session
from app.events import schemas, models
from app.events.processor import extract_features
from app.trust.engine import compute_trust_score
from app.auth.session import update_trust_score
from app.utils.logger import logger

router = APIRouter(prefix="/events", tags=["events"])


@router.post("/batch", response_model=schemas.EventBatchResponse)
async def submit_event_batch(
    batch: schemas.EventBatch,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Submit a batch of behavioral events.
    """
    # Validate session
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    if session.id != batch.session_id:
        raise HTTPException(status_code=403, detail="Session ID mismatch")
    
    # Store events
    events_stored = 0
    for event_data in batch.events:
        event = models.BehavioralEvent(
            session_id=batch.session_id,
            event_type=event_data.get("type", "unknown"),
            event_data=event_data,
            timestamp=event_data.get("timestamp", 0)
        )
        db.add(event)
        events_stored += 1
    
    db.commit()
    
    logger.info(f"Events stored for session {batch.session_id}", extra={
        "session_id": batch.session_id,
        "events_count": events_stored
    })
    
    # Extract features and compute trust score
    try:
        features = extract_features(db, batch.session_id)
        
        if features:
            trust_score = compute_trust_score(db, batch.session_id, features)
            updated_session = update_trust_score(db, batch.session_id, trust_score)
            
            return schemas.EventBatchResponse(
                success=True,
                message=f"Processed {events_stored} events",
                events_processed=events_stored,
                trust_score=trust_score,
                status=updated_session.status if updated_session else None
            )
    except Exception as e:
        logger.error(f"Error processing events: {str(e)}")
    
    return schemas.EventBatchResponse(
        success=True,
        message=f"Stored {events_stored} events",
        events_processed=events_stored
    )


@router.get("/session/{session_id}", response_model=schemas.SessionEventsResponse)
async def get_session_events(
    session_id: str,
    limit: int = 100,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Get events for a session.
    """
    # Validate session
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    if session.id != session_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to session")
    
    # Get events
    events = db.query(models.BehavioralEvent).filter(
        models.BehavioralEvent.session_id == session_id
    ).order_by(models.BehavioralEvent.timestamp.desc()).limit(limit).all()
    
    keystroke_count = sum(1 for e in events if e.event_type == "keystroke")
    mouse_count = sum(1 for e in events if e.event_type == "mouse")
    
    return schemas.SessionEventsResponse(
        session_id=session_id,
        total_events=len(events),
        keystroke_events=keystroke_count,
        mouse_events=mouse_count,
        events=[{
            "id": e.id,
            "type": e.event_type,
            "data": e.event_data,
            "timestamp": e.timestamp
        } for e in events]
    )
