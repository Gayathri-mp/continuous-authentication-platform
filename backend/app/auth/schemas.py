from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# Registration Schemas
class RegistrationBeginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)


class RegistrationBeginResponse(BaseModel):
    options: Dict[str, Any]


class RegistrationCompleteRequest(BaseModel):
    username: str
    credential: Dict[str, Any]


class RegistrationCompleteResponse(BaseModel):
    success: bool
    message: str
    user_id: Optional[str] = None


# Authentication Schemas
class AuthenticationBeginRequest(BaseModel):
    username: str


class AuthenticationBeginResponse(BaseModel):
    options: Dict[str, Any]


class AuthenticationCompleteRequest(BaseModel):
    credential: Dict[str, Any]


class AuthenticationCompleteResponse(BaseModel):
    success: bool
    message: str
    token: Optional[str] = None
    session_id: Optional[str] = None
    expires_at: Optional[datetime] = None


# Session Schemas
class SessionResponse(BaseModel):
    session_id: str
    user_id: str
    username: str
    trust_score: float
    status: str
    created_at: datetime
    last_activity: datetime
    expires_at: datetime
    
    class Config:
        from_attributes = True


class LogoutRequest(BaseModel):
    session_id: str
