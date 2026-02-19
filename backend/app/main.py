from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db
from app.auth.routes import router as auth_router
from app.events.routes import router as events_router
from app.trust.routes import router as trust_router
from app.utils.logger import logger

app = FastAPI(
    title="Adaptive Continuous Authentication Platform",
    description="Passwordless authentication with behavioral monitoring and ML-based trust scoring",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(events_router)
app.include_router(trust_router)


def _bootstrap_ml_model():
    """
    Ensure the Isolation Forest model is trained before the first request.
    If a saved model exists it is loaded (done in ml_model.py at import time).
    If not, train on synthetic data so the ML path is always live.
    """
    from app.trust.ml_model import trust_model

    if trust_model.is_trained:
        logger.info("ML model already loaded from disk — skipping bootstrap training")
        return

    logger.info("No trained model found — bootstrapping with synthetic data")
    try:
        import numpy as np

        rng = np.random.default_rng(42)

        # Normal behaviour (1 000 samples)
        normal = np.column_stack([
            rng.normal(0.10, 0.03, 1000),   # avg_key_hold_time
            rng.normal(0.15, 0.05, 1000),   # avg_inter_key_interval
            rng.normal(5.0,  1.5,  1000),   # typing_speed
            rng.normal(0.02, 0.01, 1000),   # key_hold_std
            rng.normal(0.05, 0.02, 1000),   # inter_key_std
            rng.normal(500,  150,  1000),   # avg_mouse_speed
            rng.normal(100,  30,   1000),   # avg_mouse_acceleration
            rng.normal(0.5,  0.2,  1000),   # click_rate
            rng.normal(100,  30,   1000),   # mouse_speed_std
            rng.integers(50,  200, 1000),   # total_events
            rng.integers(20,  100, 1000),   # keystroke_count
            rng.integers(30,  100, 1000),   # mouse_count
        ])

        # Anomalous behaviour (100 samples — bot-like)
        anomaly = np.column_stack([
            rng.normal(0.02, 0.005, 100),
            rng.normal(0.03, 0.005, 100),
            rng.normal(20,   2,     100),
            rng.normal(0.003,0.001, 100),
            rng.normal(0.005,0.001, 100),
            rng.normal(2000, 200,   100),
            rng.normal(500,  50,    100),
            rng.normal(2.0,  0.3,   100),
            rng.normal(50,   10,    100),
            rng.integers(150, 300, 100),
            rng.integers(80,  150, 100),
            rng.integers(70,  150, 100),
        ])

        X = np.vstack([normal, anomaly])
        trust_model.train(X, contamination=0.1)
        trust_model.save(settings.MODEL_PATH)
        logger.info("Bootstrap ML model trained and saved successfully")

    except Exception as e:
        logger.error(f"ML bootstrap failed — system will use rule-based scoring only: {e}")


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    logger.info("Starting Adaptive Continuous Authentication Platform")
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {str(e)}")

    _bootstrap_ml_model()


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down Adaptive Continuous Authentication Platform")


@app.get("/")
async def root():
    """Root endpoint."""
    from app.trust.ml_model import trust_model
    return {
        "message": "Adaptive Continuous Authentication Platform API",
        "version": "1.0.0",
        "status": "running",
        "ml_model_trained": trust_model.is_trained
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from app.trust.ml_model import trust_model
    return {
        "status": "healthy",
        "service": "auth-platform",
        "ml_ready": trust_model.is_trained
    }
