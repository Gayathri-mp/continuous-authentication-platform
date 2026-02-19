from sqlalchemy.orm import Session
from typing import Optional, Dict
import numpy as np
import threading

from app.events.models import FeatureVector
from app.events.processor import get_feature_array
from app.trust.ml_model import trust_model, TrustModel
from app.config import settings
from app.utils.logger import logger


# Per-user in-memory model cache
# key: user_id, value: TrustModel trained on that user's history
_user_models: Dict[str, TrustModel] = {}
_user_models_lock = threading.Lock()

# Minimum vectors needed before building a personal model
_MIN_PERSONAL_VECTORS = 30


def _get_user_feature_history(db: Session, user_id: str, limit: int = 200) -> np.ndarray:
    """
    Retrieve feature vectors for ALL sessions belonging to a user.
    Used to build / refresh per-user behavioural baselines.
    """
    from app.auth.models import Session as SessionModel

    session_ids = [
        s.id for s in db.query(SessionModel.id).filter(
            SessionModel.user_id == user_id
        ).all()
    ]

    if not session_ids:
        return np.array([])

    vectors = (
        db.query(FeatureVector)
        .filter(FeatureVector.session_id.in_(session_ids))
        .order_by(FeatureVector.created_at.desc())
        .limit(limit)
        .all()
    )

    if not vectors:
        return np.array([])

    return np.array([get_feature_array(v) for v in vectors])


def _get_or_train_user_model(db: Session, user_id: str) -> Optional[TrustModel]:
    """
    Return (and lazily train) a per-user Isolation Forest model.
    Returns None if there is insufficient data.
    """
    history = _get_user_feature_history(db, user_id)
    if len(history) < _MIN_PERSONAL_VECTORS:
        return None

    with _user_models_lock:
        model = _user_models.get(user_id)

    # Re-train every 50 new vectors (simple heuristic)
    should_train = model is None or len(history) % 50 == 0

    if should_train:
        try:
            personal_model = TrustModel()
            personal_model.train(history, contamination=0.05)
            with _user_models_lock:
                _user_models[user_id] = personal_model
            logger.info(f"Per-user model trained for user {user_id} on {len(history)} vectors")
            return personal_model
        except Exception as e:
            logger.error(f"Per-user model training failed for {user_id}: {e}")
            return None

    return model


def compute_trust_score(
    db: Session,
    session_id: str,
    current_features: FeatureVector
) -> float:
    """
    Compute trust score for a session.

    Scoring strategy (weights sum to 1.0):
      - Rule-based baseline:   always present                     (weight 0.20)
      - Global Isolation Forest (if trained):                      (weight 0.30–0.50)
      - Per-user Isolation Forest (if ≥30 personal vectors):      (weight 0.30–0.50)

    When both models are available the personal model gets more weight
    because it captures *this* user's individual patterns.
    """
    feature_array = get_feature_array(current_features)
    baseline_score = _compute_baseline_score(current_features)

    global_ml_score = 100.0
    personal_ml_score = None

    # --- Global model ---
    if trust_model.is_trained:
        try:
            anomaly = trust_model.predict_anomaly_score(feature_array)
            global_ml_score = (1.0 - anomaly) * 100.0
        except Exception as e:
            logger.error(f"Global ML scoring error: {e}")

    # --- Per-user model (needs session → user lookup) ---
    try:
        from app.auth.models import Session as SessionModel
        session_row = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if session_row:
            personal_model = _get_or_train_user_model(db, session_row.user_id)
            if personal_model:
                anomaly = personal_model.predict_anomaly_score(feature_array)
                personal_ml_score = (1.0 - anomaly) * 100.0
    except Exception as e:
        logger.error(f"Per-user ML scoring error: {e}")

    # --- Combine scores ---
    if personal_ml_score is not None and trust_model.is_trained:
        # Both models available: baseline 20%, global 30%, personal 50%
        final_score = 0.20 * baseline_score + 0.30 * global_ml_score + 0.50 * personal_ml_score
    elif trust_model.is_trained:
        # Only global model: baseline 30%, global 70%
        final_score = 0.30 * baseline_score + 0.70 * global_ml_score
    else:
        # No ML: rule-based only
        final_score = baseline_score

    final_score = max(0.0, min(100.0, final_score))

    logger.info("Trust score computed", extra={
        "session_id": session_id,
        "baseline": round(baseline_score, 2),
        "global_ml": round(global_ml_score, 2),
        "personal_ml": round(personal_ml_score, 2) if personal_ml_score is not None else "N/A",
        "final": round(final_score, 2)
    })

    return final_score


def _compute_baseline_score(features: FeatureVector) -> float:
    """Rule-based heuristics score (0–100). Starts at 100, deducts on suspicious signals."""
    score = 100.0

    if features.typing_speed and features.typing_speed > 15:
        score -= 20
        logger.warning(f"Suspicious typing speed: {features.typing_speed:.2f} keys/s")

    if features.inter_key_std and features.inter_key_std < 0.01:
        score -= 15
        logger.warning(f"Suspiciously consistent inter-key timing: std={features.inter_key_std:.4f}")

    if features.avg_mouse_speed and features.avg_mouse_speed > 5000:
        score -= 15
        logger.warning(f"Suspicious mouse speed: {features.avg_mouse_speed:.0f} px/s")

    if features.total_events < 5:
        score -= 10
        logger.warning(f"Very low activity: {features.total_events} events")

    if features.keystroke_count == 0 and features.total_events > 20:
        score -= 10
        logger.warning("No keystroke activity in high-event batch")

    if features.avg_key_hold_time:
        if features.avg_key_hold_time < 0.03 or features.avg_key_hold_time > 0.5:
            score -= 10
            logger.warning(f"Unusual key hold time: {features.avg_key_hold_time:.3f}s")

    return max(0.0, min(100.0, score))
