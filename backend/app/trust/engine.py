from sqlalchemy.orm import Session
from typing import Optional
import numpy as np
from app.events.models import FeatureVector
from app.events.processor import get_feature_array
from app.trust.ml_model import trust_model
from app.config import settings
from app.utils.logger import logger


def compute_trust_score(
    db: Session,
    session_id: str,
    current_features: FeatureVector
) -> float:
    """
    Compute trust score for a session based on behavioral features.
    
    Args:
        db: Database session
        session_id: Session ID
        current_features: Current feature vector
        
    Returns:
        Trust score (0-100)
    """
    # Get feature array
    feature_array = get_feature_array(current_features)
    
    # Rule-based baseline score
    baseline_score = _compute_baseline_score(current_features)
    
    # ML-based anomaly score (if model is trained)
    ml_score = 100.0
    if trust_model.is_trained:
        try:
            anomaly_score = trust_model.predict_anomaly_score(feature_array)
            # Convert anomaly score to trust score (invert)
            ml_score = (1 - anomaly_score) * 100
        except Exception as e:
            logger.error(f"Error computing ML score: {str(e)}")
    
    # Combine scores (weighted average)
    # If model is trained, give more weight to ML score
    if trust_model.is_trained:
        final_score = 0.3 * baseline_score + 0.7 * ml_score
    else:
        final_score = baseline_score
    
    # Clamp to 0-100
    final_score = max(0, min(100, final_score))
    
    logger.info(f"Trust score computed for session {session_id}", extra={
        "session_id": session_id,
        "baseline_score": baseline_score,
        "ml_score": ml_score,
        "final_score": final_score
    })
    
    return final_score


def _compute_baseline_score(features: FeatureVector) -> float:
    """
    Compute baseline trust score using rule-based heuristics.
    
    Args:
        features: Feature vector
        
    Returns:
        Baseline score (0-100)
    """
    score = 100.0
    
    # Check for suspicious patterns
    
    # 1. Extremely fast typing (bot-like)
    if features.typing_speed and features.typing_speed > 15:  # > 15 keys/sec
        score -= 20
        logger.warning(f"Suspicious typing speed: {features.typing_speed}")
    
    # 2. Very consistent timing (bot-like)
    if features.inter_key_std and features.inter_key_std < 0.01:  # Too consistent
        score -= 15
        logger.warning(f"Suspicious consistency: {features.inter_key_std}")
    
    # 3. Extremely fast mouse movements
    if features.avg_mouse_speed and features.avg_mouse_speed > 5000:  # pixels/sec
        score -= 15
        logger.warning(f"Suspicious mouse speed: {features.avg_mouse_speed}")
    
    # 4. Very low activity (possible session hijacking)
    if features.total_events < 5:
        score -= 10
        logger.warning(f"Low activity: {features.total_events} events")
    
    # 5. No keystroke activity (only mouse)
    if features.keystroke_count == 0 and features.total_events > 20:
        score -= 10
        logger.warning("No keystroke activity detected")
    
    # 6. Unusual key hold times
    if features.avg_key_hold_time:
        if features.avg_key_hold_time < 0.03 or features.avg_key_hold_time > 0.5:
            score -= 10
            logger.warning(f"Unusual key hold time: {features.avg_key_hold_time}")
    
    return max(0, min(100, score))


def get_historical_features(db: Session, session_id: str, limit: int = 100) -> np.ndarray:
    """
    Get historical feature vectors for a session.
    
    Args:
        db: Database session
        session_id: Session ID
        limit: Maximum number of feature vectors to retrieve
        
    Returns:
        Numpy array of feature vectors
    """
    features = db.query(FeatureVector).filter(
        FeatureVector.session_id == session_id
    ).order_by(FeatureVector.created_at.desc()).limit(limit).all()
    
    if not features:
        return np.array([])
    
    return np.array([get_feature_array(f) for f in features])
