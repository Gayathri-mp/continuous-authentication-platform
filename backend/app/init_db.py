#!/usr/bin/env python3
"""
Database initialization script.
Creates all tables and optionally seeds initial data.
"""

from app.database import init_db, SessionLocal
from app.auth.models import User, Credential, Session
from app.events.models import BehavioralEvent, FeatureVector
from app.utils.logger import logger


def main():
    """Initialize database."""
    logger.info("Initializing database...")
    
    try:
        # Create all tables
        init_db()
        logger.info("Database tables created successfully")
        
        # Verify tables
        db = SessionLocal()
        try:
            # Check if tables exist by querying
            user_count = db.query(User).count()
            logger.info(f"Users table verified ({user_count} users)")
            
            session_count = db.query(Session).count()
            logger.info(f"Sessions table verified ({session_count} sessions)")
            
            event_count = db.query(BehavioralEvent).count()
            logger.info(f"Events table verified ({event_count} events)")
            
            feature_count = db.query(FeatureVector).count()
            logger.info(f"Features table verified ({feature_count} features)")
            
        finally:
            db.close()
        
        logger.info("Database initialization completed successfully")
        
    except Exception as e:
        logger.error(f"Database initialization failed: {str(e)}")
        raise


if __name__ == "__main__":
    main()
