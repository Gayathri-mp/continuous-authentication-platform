"""
Trust engine: per-user Isolation Forest scoring.

Flow
----
1. On each feature batch compute_trust_score() is called.
2. It tries to load the user's personal model from the path stored in user_baselines.
3. If no model exists yet it checks whether the user has completed
   MIN_SESSIONS_TO_TRAIN normal sessions.  If so, it trains one now.
4. Anomaly score from the personal model is converted to a 0-100 trust score.
5. A rule-based heuristic layer is always applied on top as a safety net.

Global model removed — scoring is purely per-user to avoid false positives
caused by averaging over a heterogeneous user population.
"""

import os
import threading
from datetime import datetime, timezone
from typing import Optional, Dict

import numpy as np
from sqlalchemy.orm import Session as DBSession

from app.events.models import FeatureVector
from app.events.processor import get_feature_array
from app.trust.ml_model import TrustModel
from app.config import settings
from app.utils.logger import logger


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Minimum number of *completed, non-terminated* sessions before training
MIN_SESSIONS_TO_TRAIN: int = 3

# Minimum feature vectors (across those sessions) for a meaningful model
MIN_VECTORS_TO_TRAIN: int = 20

# Retrain whenever the user has MIN_RETRAIN_INCREMENT more vectors than at last training
MIN_RETRAIN_INCREMENT: int = 50

# In-memory cache of loaded / trained models so we don't hit disk on every batch
_model_cache: Dict[str, TrustModel] = {}
_cache_lock = threading.Lock()

# Base directory for user model files
_MODEL_DIR = os.path.join(os.path.dirname(settings.MODEL_PATH), "users")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _user_model_path(user_id: str) -> str:
    return os.path.join(_MODEL_DIR, f"{user_id}.pkl")


def _count_normal_sessions(db: DBSession, user_id: str) -> int:
    """Number of non-terminated, expired (completed) sessions for the user."""
    from app.auth.models import Session as SessionModel
    return (
        db.query(SessionModel)
        .filter(
            SessionModel.user_id == user_id,
            SessionModel.status.in_(["OK", "MONITOR", "SUSPICIOUS", "EXPIRED"]),
            SessionModel.is_active == False,   # session must have ended
        )
        .count()
    )


def _get_user_feature_history(db: DBSession, user_id: str, limit: int = 500) -> np.ndarray:
    """All feature vectors across all sessions for *user_id*, newest-first."""
    from app.auth.models import Session as SessionModel

    session_ids = [
        s.id for s in db.query(SessionModel.id)
        .filter(SessionModel.user_id == user_id)
        .all()
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


def _load_model_from_db(db: DBSession, user_id: str) -> Optional[TrustModel]:
    """
    Look up the user's model path in user_baselines, then load from disk.
    Returns None if no baseline exists or the file is missing.
    """
    from app.auth.models import UserBaseline

    baseline = db.query(UserBaseline).filter(UserBaseline.user_id == user_id).first()
    if baseline is None:
        return None

    model = TrustModel()
    if model.load(baseline.model_path):
        logger.info(f"Loaded personal model for user {user_id} from {baseline.model_path}")
        return model

    logger.warning(f"Personal model file missing for user {user_id}: {baseline.model_path}")
    return None


def _train_and_save_user_model(
    db: DBSession,
    user_id: str,
    feature_matrix: np.ndarray,
    sessions_used: int,
) -> Optional[TrustModel]:
    """
    Train a new Isolation Forest for *user_id*, save it, and upsert user_baselines.
    Returns the trained TrustModel or None on failure.
    """
    from app.auth.models import UserBaseline

    model_path = _user_model_path(user_id)
    os.makedirs(os.path.dirname(model_path), exist_ok=True)

    try:
        model = TrustModel()
        # Low contamination for personal models — we train only on normal behaviour
        model.train(feature_matrix, contamination=0.05)
        model.save(model_path)
    except Exception as exc:
        logger.error(f"Failed to train personal model for user {user_id}: {exc}")
        return None

    try:
        baseline = db.query(UserBaseline).filter(UserBaseline.user_id == user_id).first()
        if baseline is None:
            baseline = UserBaseline(
                user_id=user_id,
                model_path=model_path,
                sessions_used=sessions_used,
                vectors_used=len(feature_matrix),
            )
            db.add(baseline)
        else:
            baseline.model_path = model_path
            baseline.sessions_used = sessions_used
            baseline.vectors_used = len(feature_matrix)
            baseline.last_trained_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to persist UserBaseline for user {user_id}: {exc}")
        # Model still trained — return it even if DB write failed

    logger.info(
        f"Personal model trained for user {user_id}: "
        f"{len(feature_matrix)} vectors, {sessions_used} sessions"
    )
    return model


def _get_user_model(db: DBSession, user_id: str) -> Optional[TrustModel]:
    """
    Return the personal TrustModel for *user_id*.

    Priority:
    1. In-memory cache (fastest)
    2. Load from path in user_baselines (fast, disk read)
    3. Train now if the user meets the session / vector thresholds

    Also triggers a retrain when the user has accumulated
    MIN_RETRAIN_INCREMENT more vectors since the last training.
    """
    from app.auth.models import UserBaseline

    # --- Cache hit ---
    with _cache_lock:
        cached = _model_cache.get(user_id)

    # Check if a retrain is due even if we have a cached model
    baseline = db.query(UserBaseline).filter(UserBaseline.user_id == user_id).first()
    history = _get_user_feature_history(db, user_id)

    if baseline and cached:
        vectors_since_train = len(history) - baseline.vectors_used
        if vectors_since_train < MIN_RETRAIN_INCREMENT:
            return cached   # cache is fresh enough

    # --- Try loading from DB / disk ---
    if cached is None and baseline is not None:
        model = _load_model_from_db(db, user_id)
        if model:
            with _cache_lock:
                _model_cache[user_id] = model
            # Check if retrain needed
            if baseline and len(history) - baseline.vectors_used < MIN_RETRAIN_INCREMENT:
                return model

    # --- Check if we can train ---
    if len(history) < MIN_VECTORS_TO_TRAIN:
        return None  # not enough data yet

    normal_sessions = _count_normal_sessions(db, user_id)
    if normal_sessions < MIN_SESSIONS_TO_TRAIN:
        logger.info(
            f"User {user_id}: {normal_sessions}/{MIN_SESSIONS_TO_TRAIN} sessions complete — "
            "skipping personal model training"
        )
        return None

    # --- Train (or retrain) ---
    sessions_used = normal_sessions
    new_model = _train_and_save_user_model(db, user_id, history, sessions_used)
    if new_model:
        with _cache_lock:
            _model_cache[user_id] = new_model

    return new_model


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_trust_score(
    db: DBSession,
    session_id: str,
    current_features: FeatureVector,
) -> float:
    """
    Compute a 0-100 trust score for *session_id*.

    Scoring strategy
    ----------------
    If a personal model exists:
        score = 0.35 × rule_based  +  0.65 × personal_ml_score

    If no personal model yet (cold-start):
        score = rule_based only (conservative estimate)

    The global generic model has been removed to avoid cross-user contamination.
    """
    feature_array = get_feature_array(current_features)
    baseline_score = _compute_baseline_score(current_features)

    # --- Resolve user_id from session ---
    user_id: Optional[str] = None
    try:
        from app.auth.models import Session as SessionModel
        session_row = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if session_row:
            user_id = session_row.user_id
    except Exception as exc:
        logger.error(f"Could not resolve user_id for session {session_id}: {exc}")

    # --- Personal model scoring ---
    personal_score: Optional[float] = None
    if user_id:
        try:
            personal_model = _get_user_model(db, user_id)
            if personal_model:
                anomaly = personal_model.predict_anomaly_score(feature_array)
                personal_score = (1.0 - anomaly) * 100.0
        except Exception as exc:
            logger.error(f"Personal model scoring error for user {user_id}: {exc}")

    # --- Combine ---
    if personal_score is not None:
        final_score = 0.35 * baseline_score + 0.65 * personal_score
    else:
        # Cold-start: rule-based only; don't penalise users before we have data
        final_score = baseline_score

    final_score = max(0.0, min(100.0, final_score))

    logger.info(
        "Trust score",
        extra={
            "session_id": session_id,
            "user_id": user_id,
            "baseline": round(baseline_score, 2),
            "personal_ml": round(personal_score, 2) if personal_score is not None else "N/A (cold-start)",
            "final": round(final_score, 2),
        },
    )

    return final_score


def _compute_baseline_score(features: FeatureVector) -> float:
    """Rule-based heuristics — always applied, never alone enough to terminate."""
    score = 100.0

    if features.typing_speed and features.typing_speed > 15:
        score -= 20
        logger.warning(f"Suspicious typing speed: {features.typing_speed:.2f} keys/s")

    if features.inter_key_std and features.inter_key_std < 0.01:
        score -= 15
        logger.warning(f"Suspiciously uniform inter-key timing: std={features.inter_key_std:.4f}")

    if features.avg_mouse_speed and features.avg_mouse_speed > 5000:
        score -= 15
        logger.warning(f"Suspicious mouse speed: {features.avg_mouse_speed:.0f} px/s")

    if features.total_events < 5:
        score -= 10

    if features.keystroke_count == 0 and features.total_events > 20:
        score -= 10
        logger.warning("No keystrokes in high-event batch (possible bot)")

    if features.avg_key_hold_time:
        if features.avg_key_hold_time < 0.03 or features.avg_key_hold_time > 0.5:
            score -= 10
            logger.warning(f"Unusual key hold time: {features.avg_key_hold_time:.3f}s")

    return max(0.0, min(100.0, score))
