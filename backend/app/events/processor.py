from datetime import datetime, timedelta
from typing import List, Dict
import numpy as np
from sqlalchemy.orm import Session
from app.events.models import BehavioralEvent, FeatureVector
from app.config import settings
from app.utils.logger import logger


def extract_features(
    db: Session,
    session_id: str,
    window_seconds: int = None
) -> FeatureVector:
    """
    Extract features from behavioral events.
    
    Args:
        db: Database session
        session_id: Session ID
        window_seconds: Time window in seconds (default from config)
        
    Returns:
        FeatureVector object
    """
    if window_seconds is None:
        window_seconds = settings.FEATURE_WINDOW_SECONDS
    
    # Get events from the last window
    window_start = datetime.utcnow() - timedelta(seconds=window_seconds)
    events = db.query(BehavioralEvent).filter(
        BehavioralEvent.session_id == session_id,
        BehavioralEvent.created_at >= window_start
    ).all()
    
    if not events:
        logger.warning(f"No events found for session {session_id}")
        return None
    
    # Separate keystroke and mouse events
    keystroke_events = [e for e in events if e.event_type == "keystroke"]
    mouse_events = [e for e in events if e.event_type == "mouse"]
    
    # Initialize feature vector
    features = FeatureVector(
        session_id=session_id,
        window_start=window_start,
        window_end=datetime.utcnow(),
        total_events=len(events),
        keystroke_count=len(keystroke_events),
        mouse_count=len(mouse_events)
    )
    
    # Extract keystroke features
    if keystroke_events:
        features = _extract_keystroke_features(keystroke_events, features)
    
    # Extract mouse features
    if mouse_events:
        features = _extract_mouse_features(mouse_events, features)
    
    # Save feature vector
    db.add(features)
    db.commit()
    db.refresh(features)
    
    logger.info(f"Features extracted for session {session_id}", extra={
        "session_id": session_id,
        "total_events": len(events),
        "keystroke_count": len(keystroke_events),
        "mouse_count": len(mouse_events)
    })
    
    return features


def _extract_keystroke_features(events: List[BehavioralEvent], features: FeatureVector) -> FeatureVector:
    """Extract keystroke-specific features."""
    # Group events by key for hold time calculation
    key_events = {}
    for event in events:
        data = event.event_data
        key = data.get("key", "")
        action = data.get("action", "")
        timestamp = event.timestamp
        
        if key not in key_events:
            key_events[key] = {"down": [], "up": []}
        
        key_events[key][action].append(timestamp)
    
    # Calculate hold times
    hold_times = []
    for key, times in key_events.items():
        downs = sorted(times["down"])
        ups = sorted(times["up"])
        
        for down in downs:
            # Find matching up event
            matching_ups = [up for up in ups if up > down]
            if matching_ups:
                hold_time = matching_ups[0] - down
                hold_times.append(hold_time)
    
    if hold_times:
        features.avg_key_hold_time = float(np.mean(hold_times))
        features.key_hold_std = float(np.std(hold_times))
    
    # Calculate inter-key intervals (time between consecutive key presses)
    all_timestamps = sorted([e.timestamp for e in events])
    if len(all_timestamps) > 1:
        intervals = np.diff(all_timestamps)
        features.avg_inter_key_interval = float(np.mean(intervals))
        features.inter_key_std = float(np.std(intervals))
        
        # Typing speed (keys per second)
        time_span = all_timestamps[-1] - all_timestamps[0]
        if time_span > 0:
            features.typing_speed = len(all_timestamps) / time_span
    
    return features


def _extract_mouse_features(events: List[BehavioralEvent], features: FeatureVector) -> FeatureVector:
    """Extract mouse-specific features."""
    move_events = [e for e in events if e.event_data.get("action") == "move"]
    click_events = [e for e in events if e.event_data.get("action") == "click"]
    
    # Calculate mouse speeds
    if len(move_events) > 1:
        speeds = []
        accelerations = []
        
        for i in range(1, len(move_events)):
            prev = move_events[i-1]
            curr = move_events[i]
            
            prev_data = prev.event_data
            curr_data = curr.event_data
            
            # Calculate distance
            dx = curr_data.get("x", 0) - prev_data.get("x", 0)
            dy = curr_data.get("y", 0) - prev_data.get("y", 0)
            distance = np.sqrt(dx**2 + dy**2)
            
            # Calculate time difference
            dt = curr.timestamp - prev.timestamp
            
            if dt > 0:
                speed = distance / dt
                speeds.append(speed)
                
                # Calculate acceleration
                if i > 1 and len(speeds) > 1:
                    prev_speed = speeds[-2]
                    acceleration = (speed - prev_speed) / dt
                    accelerations.append(acceleration)
        
        if speeds:
            features.avg_mouse_speed = float(np.mean(speeds))
            features.mouse_speed_std = float(np.std(speeds))
        
        if accelerations:
            features.avg_mouse_acceleration = float(np.mean(np.abs(accelerations)))
    
    # Calculate click rate
    if click_events:
        all_timestamps = sorted([e.timestamp for e in events])
        time_span = all_timestamps[-1] - all_timestamps[0]
        if time_span > 0:
            features.click_rate = len(click_events) / time_span
    
    return features


def get_feature_array(feature: FeatureVector) -> np.ndarray:
    """
    Convert FeatureVector to numpy array for ML model.
    
    Args:
        feature: FeatureVector object
        
    Returns:
        Numpy array of features
    """
    return np.array([
        feature.avg_key_hold_time or 0,
        feature.avg_inter_key_interval or 0,
        feature.typing_speed or 0,
        feature.key_hold_std or 0,
        feature.inter_key_std or 0,
        feature.avg_mouse_speed or 0,
        feature.avg_mouse_acceleration or 0,
        feature.click_rate or 0,
        feature.mouse_speed_std or 0,
        feature.total_events,
        feature.keystroke_count,
        feature.mouse_count
    ])
