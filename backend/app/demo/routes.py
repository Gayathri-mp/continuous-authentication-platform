"""
Demo attack simulation endpoint.

Provides deterministic test routes for the impersonation demo scenario:

  POST /demo/simulate-attack
    Injects bot-like behavioral events directly into the session's event
    store.  These events have the hallmarks of an attacker (robot-fast
    typing, perfectly uniform intervals) and will cause the trust score
    to drop into SUSPICIOUS / TERMINATED territory within 1–2 batches.

  POST /demo/reset-trust
    Resets a session's trust score back to 100 and clears the stepup
    deadline.  Useful for resetting between demo runs.

  GET  /demo/status
    Returns a quick summary of the session's current trust state.

NOTE: These routes are only registered when DEMO_MODE=True in config.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional
import random

from app.database import get_db
from app.auth.session import validate_session
from app.auth.models import Session as SessionModel
from app.events.models import BehavioralEvent
from app.events.processor import extract_features
from app.trust.engine import compute_trust_score
from app.trust.policy import evaluate_policy, PolicyAction
from app.auth.session import update_trust_score, revoke_session
from app.auth.models import SecurityAlert
from app.config import settings
from app.utils.logger import logger

router = APIRouter(prefix="/demo", tags=["demo"])

# ---------------------------------------------------------------------------
# Attacker signature: fast, uniform keystrokes — designed to always
# exceed the rule-based thresholds and score poorly against any personal model
# ---------------------------------------------------------------------------

def _attacker_events(n_keystrokes: int = 60, n_mouse: int = 20) -> list:
    """
    Generate synthetic attacker events with:
      - Typing speed ~25 keys/s  (threshold: >15)
      - Inter-key interval  ~0.04 s,  std < 0.002  (threshold: std < 0.01)
      - Key hold time       ~0.01 s                 (threshold: <0.03)
      - Mouse speed         ~6 000 px/s             (threshold: >5000)
    """
    now = datetime.now(timezone.utc).timestamp()
    events = []

    rng = random.Random(42)   # fixed seed → deterministic

    # Keystrokes (down / up pairs, robot-uniform)
    KEYS = list("abcdefghijklmnopqrstuvwxyz ")
    t = now
    for _ in range(n_keystrokes):
        key = rng.choice(KEYS)
        down_t = t
        up_t   = t + 0.010 + rng.uniform(-0.001, 0.001)   # hold ~10 ms ± 1 ms
        events.append({"type": "keystroke", "key": key, "action": "down", "timestamp": down_t})
        events.append({"type": "keystroke", "key": key, "action": "up",   "timestamp": up_t})
        t += 0.040 + rng.uniform(-0.002, 0.002)            # inter-key ~40 ms ± 2 ms

    # Mouse moves (very fast, straight-line — bot pattern)
    x, y = 100.0, 100.0
    for i in range(n_mouse):
        x += 300 + rng.uniform(-5, 5)
        y += 2   + rng.uniform(-1, 1)
        events.append({
            "type": "mouse", "action": "move",
            "x": x, "y": y,
            "timestamp": now + i * 0.001,   # all within 20 ms → enormous speed
        })

    return events


@router.post("/simulate-attack")
async def simulate_attack(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    Inject attacker-like behavioral events into the current session, then
    immediately compute a trust score.  The score should drop to ≤ 35 after
    one call, and ≤ 15 after two calls (triggering step-up / termination).
    """
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=404, detail="Demo mode is not enabled")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    # Persist synthetic attacker events
    events = _attacker_events()
    for ev in events:
        db.add(BehavioralEvent(
            session_id=session.id,
            event_type=ev["type"],
            event_data=ev,
            timestamp=ev["timestamp"],
        ))
    db.commit()

    # Extract features + score (reuses the real pipeline)
    features = extract_features(db, session.id)
    if not features:
        raise HTTPException(status_code=500, detail="Feature extraction failed")

    trust_score   = compute_trust_score(db, session.id, features)
    updated       = update_trust_score(db, session.id, trust_score)
    policy        = evaluate_policy(trust_score, updated.status if updated else "OK")

    # Enforce policy (same logic as events/routes.py)
    action = policy["action"]
    if action == PolicyAction.TERMINATE:
        alert = SecurityAlert(
            session_id=session.id,
            alert_type="TERMINATED",
            message=f"[DEMO] Session terminated — trust score critically low ({trust_score:.1f})",
            severity="danger",
            trust_score=trust_score,
        )
        db.add(alert)
        db.commit()
        revoke_session(db, session.id)
        logger.warning(f"[DEMO] Session {session.id} terminated by policy engine (score={trust_score:.1f})")
    elif action == PolicyAction.STEPUP:
        alert = SecurityAlert(
            session_id=session.id,
            alert_type="STEPUP_REQUIRED",
            message=f"[DEMO] Step-up required — trust score {trust_score:.1f}",
            severity="warning",
            trust_score=trust_score,
        )
        db.add(alert)
        db.commit()

    logger.warning(
        f"[DEMO] Attack simulated for session {session.id}: "
        f"score={trust_score:.1f} status={updated.status if updated else 'N/A'} action={action}"
    )

    return {
        "simulated_events": len(events),
        "trust_score":      round(trust_score, 1),
        "status":           updated.status if updated else "UNKNOWN",
        "action":           action,
        "require_stepup":   policy["require_stepup"],
        "message":          f"Attack simulated. Trust dropped to {trust_score:.1f} → {action}",
    }


@router.post("/reset-trust")
async def reset_trust(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Reset trust score and status back to 100 / OK for a new demo run."""
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=404, detail="Demo mode is not enabled")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = db.query(SessionModel).filter(
        SessionModel.token == token,
        SessionModel.is_active == True,
    ).first()
    if not session:
        raise HTTPException(status_code=401, detail="No active session found")

    session.trust_score     = 100.0
    session.status          = "OK"
    session.stepup_deadline = None
    db.commit()

    logger.info(f"[DEMO] Trust reset for session {session.id}")
    return {"success": True, "trust_score": 100.0, "status": "OK"}


@router.get("/status")
async def demo_status(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Quick summary of the current session's trust state for demo dashboards."""
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=404, detail="Demo mode is not enabled")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    session = validate_session(db, token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    policy = evaluate_policy(session.trust_score, session.status)
    return {
        "session_id":  session.id,
        "trust_score": session.trust_score,
        "status":      session.status,
        "action":      policy["action"],
        "is_active":   session.is_active,
    }


# ---------------------------------------------------------------------------
# Force-terminate: guarantees session termination for demo purposes.
# Directly sets score to 5 and revokes the session — bypasses ML pipeline.
# ---------------------------------------------------------------------------

@router.post("/force-terminate")
async def force_terminate(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """
    [DEMO ONLY] Immediately terminate the current session by forcing the trust
    score to 5 and revoking it, regardless of the ML model's current output.
    Returns the same shape as /events/batch so the frontend can react identically.
    """
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=404, detail="Demo mode is not enabled")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "")
    # Allow already-SUSPICIOUS sessions too, so fetch directly
    session = db.query(SessionModel).filter(
        SessionModel.token == token,
        SessionModel.is_active == True,
    ).first()

    if not session:
        raise HTTPException(status_code=401, detail="No active session found")

    FORCED_SCORE = 5.0

    # Write the critical score into the session row
    session.trust_score = FORCED_SCORE
    session.status      = "TERMINATED"
    db.commit()

    # Emit a TERMINATED security alert
    alert = SecurityAlert(
        session_id=session.id,
        alert_type="TERMINATED",
        message=f"[DEMO] Session force-terminated — trust score set to {FORCED_SCORE} (attack simulation)",
        severity="danger",
        trust_score=FORCED_SCORE,
    )
    db.add(alert)
    db.commit()

    # Revoke the session
    revoke_session(db, session.id)
    logger.warning(f"[DEMO] Session {session.id} force-terminated (score={FORCED_SCORE})")

    return {
        "success":        True,
        "trust_score":    FORCED_SCORE,
        "status":         "TERMINATED",
        "action":         PolicyAction.TERMINATE,
        "require_stepup": False,
        "message":        "Session force-terminated by demo attack simulation",
    }

