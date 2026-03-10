from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
from app.config import settings

# SQLite needs special connect_args; PostgreSQL uses a connection pool.
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    # check_same_thread=False is required for SQLite when used with FastAPI
    # (FastAPI handles requests across multiple threads)
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )

# Create SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class for models
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    Dependency function to get database session.
    Yields a database session and ensures it's closed after use.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database by creating all tables."""
    # Import all models here so they are registered with Base metadata
    import app.auth.models
    import app.events.models
    Base.metadata.create_all(bind=engine)
