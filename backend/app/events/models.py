from sqlalchemy import Column, String, DateTime, Float, JSON, ForeignKey, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid


class BehavioralEvent(Base):
    """Raw behavioral event (keystroke or mouse)."""
    __tablename__ = "behavioral_events"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False, index=True)
    event_type = Column(String, nullable=False)  # keystroke, mouse
    event_data = Column(JSON, nullable=False)
    timestamp = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    session = relationship("Session", back_populates="events")


class FeatureVector(Base):
    """Extracted feature vector for ML model."""
    __tablename__ = "feature_vectors"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False, index=True)
    window_start = Column(DateTime(timezone=True), nullable=False)
    window_end = Column(DateTime(timezone=True), nullable=False)
    
    # Keystroke features
    avg_key_hold_time = Column(Float, nullable=True)
    avg_inter_key_interval = Column(Float, nullable=True)
    typing_speed = Column(Float, nullable=True)  # keys per second
    key_hold_std = Column(Float, nullable=True)
    inter_key_std = Column(Float, nullable=True)
    
    # Mouse features
    avg_mouse_speed = Column(Float, nullable=True)
    avg_mouse_acceleration = Column(Float, nullable=True)
    click_rate = Column(Float, nullable=True)  # clicks per second
    mouse_speed_std = Column(Float, nullable=True)
    
    # Combined features
    total_events = Column(Integer, nullable=False)
    keystroke_count = Column(Integer, nullable=False)
    mouse_count = Column(Integer, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
