from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


class KeystrokeEvent(BaseModel):
    """Keystroke event schema."""
    type: str = "keystroke"
    key: str
    action: str  # down, up
    timestamp: float


class MouseEvent(BaseModel):
    """Mouse event schema."""
    type: str = "mouse"
    x: int
    y: int
    action: str  # move, click, down, up
    timestamp: float


class EventBatch(BaseModel):
    """Batch of behavioral events."""
    session_id: str
    events: List[Dict[str, Any]]


class EventBatchResponse(BaseModel):
    """Response for event batch submission."""
    success: bool
    message: str
    events_processed: int
    trust_score: Optional[float] = None
    status: Optional[str] = None
    action: Optional[str] = None          # continue | monitor | stepup | terminate
    require_stepup: Optional[bool] = None


class SessionEventsResponse(BaseModel):
    """Response for session events query."""
    session_id: str
    total_events: int
    keystroke_events: int
    mouse_events: int
    events: List[Dict[str, Any]]
