from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.auth.session import validate_session, revoke_session, update_trust_score
from app.events import schemas, models
from app.events.processor import extract_features
from app.trust.engine import compute_trust_score
from app.trust.policy import evaluate_policy, PolicyAction
from app.auth.models import SecurityAlert, Session as SessionModel
from app.config import settings
from app.utils.logger import logger

router = APIRouter(prefix="/events", tags=["events"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _emit_alert(db: Session, session_id: str, alert_type: str, message: str,
                severity: str, trust_score: float = None):
    """Persist a security alert for a session."""
    alert = SecurityAlert(
        session_id=session_id,
        alert_type=alert_type,
        message=message,
        severity=severity,
        trust_score=trust_score,
    )
    db.add(alert)
    db.commit()


def _enforce_stepup_timeout(db: Session, session: SessionModel) -> bool:
    """
    Check if an active step-up deadline has expired.
    If it has, revoke the session and emit a TIMEOUT alert.
    Returns True if session was terminated.
    """
    if session.stepup_deadline is None:
        return False

    deadline = session.stepup_deadline
    # Make timezone-aware if needed
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) > deadline:
        _emit_alert(
            db, session.id,
            alert_type="STEPUP_TIMEOUT",
            message=f"Step-up authentication not completed within {settings.STEPUP_TIMEOUT_SECONDS}s — session terminated",
            severity="danger",
            trust_score=session.trust_score
        )
        revoke_session(db, session.id)
        logger.warning(f"Session {session.id} auto-terminated: step-up timeout")
        return True

    return False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/batch", response_model=schemas.EventBatchResponse)
async def submit_event_batch(
    batch: schemas.EventBatch,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Submit a batch of behavioral events.
    Runs the full pipeline: events → features → trust score → policy → enforcement.
    Returns policy action so the frontend can immediately enforce step-up / termination.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    if session.id != batch.session_id:
        raise HTTPException(status_code=403, detail="Session ID mismatch")

    # --- Check stepup timeout BEFORE accepting new events ---
    if _enforce_stepup_timeout(db, session):
        raise HTTPException(status_code=401, detail="Session terminated: step-up timeout exceeded")

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

    # --- Full pipeline: features → trust → policy ---
    try:
        features = extract_features(db, batch.session_id)

        if features:
            trust_score = compute_trust_score(db, batch.session_id, features)
            updated_session = update_trust_score(db, batch.session_id, trust_score)

            policy = evaluate_policy(trust_score, updated_session.status if updated_session else "OK")
            action = policy["action"]

            if action == PolicyAction.TERMINATE:
                _emit_alert(db, batch.session_id,
                            alert_type="TERMINATED",
                            message=f"Session terminated — trust score critically low ({trust_score:.1f})",
                            severity="danger",
                            trust_score=trust_score)
                revoke_session(db, batch.session_id)
                logger.warning(f"Session {batch.session_id} terminated by policy engine")

            elif action == PolicyAction.STEPUP:
                # Only set deadline the first time (don't reset it on every batch)
                fresh_session = db.query(SessionModel).filter(
                    SessionModel.id == batch.session_id
                ).first()
                if fresh_session and fresh_session.stepup_deadline is None:
                    deadline = datetime.now(timezone.utc) + timedelta(seconds=settings.STEPUP_TIMEOUT_SECONDS)
                    fresh_session.stepup_deadline = deadline
                    db.commit()
                    logger.info(
                        f"Step-up deadline set for session {batch.session_id}: "
                        f"expires at {deadline.isoformat()}"
                    )

                _emit_alert(db, batch.session_id,
                            alert_type="STEPUP_REQUIRED",
                            message=f"Trust score dropped to {trust_score:.1f} — step-up required (30s timeout)",
                            severity="warning",
                            trust_score=trust_score)

            elif action == PolicyAction.MONITOR:
                _emit_alert(db, batch.session_id,
                            alert_type="TRUST_DROP",
                            message=f"Trust score entered monitoring range ({trust_score:.1f})",
                            severity="info",
                            trust_score=trust_score)

            elif action == PolicyAction.CONTINUE:
                # Clear any lingering stepup_deadline once trust recovers
                fresh_session = db.query(SessionModel).filter(
                    SessionModel.id == batch.session_id
                ).first()
                if fresh_session and fresh_session.stepup_deadline is not None:
                    fresh_session.stepup_deadline = None
                    db.commit()

            return schemas.EventBatchResponse(
                success=True,
                message=f"Processed {events_stored} events",
                events_processed=events_stored,
                trust_score=trust_score,
                status=updated_session.status if updated_session else None,
                action=action,
                require_stepup=policy["require_stepup"]
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing events for session {batch.session_id}: {str(e)}")

    return schemas.EventBatchResponse(
        success=True,
        message=f"Stored {events_stored} events (feature extraction skipped)",
        events_processed=events_stored
    )


@router.get("/session/{session_id}", response_model=schemas.SessionEventsResponse)
async def get_session_events(
    session_id: str,
    limit: int = 100,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Get events for a session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    if session.id != session_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to session")

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
