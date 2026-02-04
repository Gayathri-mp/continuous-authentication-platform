from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application configuration settings."""
    
    # Database
    DATABASE_URL: str = "postgresql://authuser:authpass@localhost:5432/authdb"
    
    # JWT Settings
    JWT_SECRET: str = "dev-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60
    
    # WebAuthn Settings
    RP_ID: str = "localhost"
    RP_NAME: str = "Adaptive Auth Platform"
    RP_ORIGIN: str = "http://localhost:8080"
    
    # Trust Score Thresholds
    TRUST_THRESHOLD_OK: int = 70
    TRUST_THRESHOLD_MONITOR: int = 40
    TRUST_THRESHOLD_STEPUP: int = 20
    
    # Behavioral Monitoring
    BATCH_INTERVAL_SECONDS: int = 5
    FEATURE_WINDOW_SECONDS: int = 10
    
    # ML Model
    MODEL_PATH: str = "data/models/isolation_forest.pkl"
    
    # CORS
    CORS_ORIGINS: list = ["http://localhost:8080", "http://127.0.0.1:8080"]
    
    class Config:
        env_file = ".env"
        case_sensitive = True


# Global settings instance
settings = Settings()
