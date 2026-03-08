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
    description="Passwordless authentication with behavioral monitoring and per-user ML-based trust scoring",
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


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    logger.info("Starting Adaptive Continuous Authentication Platform")
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {str(e)}")

    # Per-user models are trained lazily on first scoring — no bootstrap needed.
    logger.info(
        "ML strategy: per-user Isolation Forest (trained after "
        f"{settings.STEPUP_TIMEOUT_SECONDS}s initial sessions). "
        "Cold-start uses rule-based heuristics."
    )


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down Adaptive Continuous Authentication Platform")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Adaptive Continuous Authentication Platform API",
        "version": "1.0.0",
        "status": "running",
        "ml_strategy": "per-user Isolation Forest (lazy training)",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "auth-platform",
        "ml_strategy": "per-user Isolation Forest",
    }
