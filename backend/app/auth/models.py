from sqlalchemy import Column, String, DateTime, Integer, Float, Boolean, JSON, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid


class User(Base):
    """User account model."""
    __tablename__ = "users"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    
    # Relationships
    credentials = relationship("Credential", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")


class Credential(Base):
    """WebAuthn credential storage."""
    __tablename__ = "credentials"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    credential_id = Column(String, unique=True, nullable=False, index=True)
    public_key = Column(Text, nullable=False)
    sign_count = Column(Integer, default=0)
    transports = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="credentials")


class Session(Base):
    """Active user session."""
    __tablename__ = "sessions"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    trust_score = Column(Float, default=100.0)
    status = Column(String, default="OK")  # OK, MONITOR, SUSPICIOUS, TERMINATED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_activity = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True)
    device_info = Column(JSON, nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="sessions")
    events = relationship("BehavioralEvent", back_populates="session", cascade="all, delete-orphan")
