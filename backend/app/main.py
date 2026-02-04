from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db
from app.auth.routes import router as auth_router
from app.events.routes import router as events_router
from app.trust.routes import router as trust_router
from app.utils.logger import logger

# Create FastAPI application
app = FastAPI(
    title="Adaptive Continuous Authentication Platform",
    description="Passwordless authentication with behavioral monitoring and ML-based trust scoring",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
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
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "auth-platform"
    }
