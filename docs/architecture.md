# Adaptive Continuous Authentication Platform - Architecture

## System Overview

The Adaptive Continuous Authentication Platform is a proof-of-concept system that combines passwordless WebAuthn authentication with real-time behavioral monitoring and ML-based trust scoring to provide continuous authentication throughout a user session.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser Client                           │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   React UI   │  │   WebAuthn   │  │  Capture Agent       │  │
│  │  Components  │  │    Client    │  │  (Keystroke/Mouse)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                  │                     │               │
│         └──────────────────┴─────────────────────┘               │
│                            │                                     │
│                    HTTPS / WebSocket                             │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                      FastAPI Backend                              │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Auth Module     │  │  Event Ingestion │  │ Trust Engine  │ │
│  │  - WebAuthn      │  │  - Validation    │  │ - ML Model    │ │
│  │  - Session Mgmt  │  │  - Storage       │  │ - Rules       │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Feature Extract  │  │  Policy Engine   │  │  API Gateway  │ │
│  │  - Keystroke     │  │  - Thresholds    │  │  - Routes     │ │
│  │  - Mouse         │  │  - Actions       │  │  - Auth       │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                    PostgreSQL Database                            │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Users   │  │ Sessions │  │  Events  │  │ Feature Vectors│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│  ┌──────────┐  ┌──────────┐                                     │
│  │Credentials│  │  Logs    │                                     │
│  └──────────┘  └──────────┘                                     │
└───────────────────────────────────────────────────────────────────┘
```

## Component Details

### Frontend (React.js)

#### 1. Authentication UI
- **Purpose**: Handle user registration and login
- **Technology**: React components with WebAuthn API
- **Key Features**:
  - Passwordless registration flow
  - Biometric/security key authentication
  - Session state management
  - Error handling and user feedback

#### 2. Behavioral Capture Agent
- **Purpose**: Monitor user behavior in real-time
- **Implementation**: React hook (`useBehavioralCapture`)
- **Captured Events**:
  - **Keystroke**: key press/release, timestamps, inter-key intervals
  - **Mouse**: movement coordinates, click events, speeds
- **Batching**: Events collected every 5 seconds
- **Transmission**: Secure HTTPS POST to backend

#### 3. Dashboard
- **Purpose**: Display trust score and session information
- **Components**:
  - `TrustScoreCard`: Real-time trust score visualization
  - `SessionInfoCard`: Session details and logout
  - `ActivityCard`: Behavioral monitoring statistics
  - `AlertsCard`: Security alerts and warnings
  - `StepUpModal`: Re-authentication prompts

### Backend (FastAPI)

#### 1. Authentication Module
- **WebAuthn Integration**: FIDO2 protocol implementation
- **Session Management**: JWT-based tokens with expiration
- **Credential Storage**: Public keys stored securely
- **Endpoints**:
  - `/auth/register/begin` & `/auth/register/complete`
  - `/auth/login/begin` & `/auth/login/complete`
  - `/auth/session` & `/auth/logout`

#### 2. Event Ingestion Service
- **Purpose**: Receive and validate behavioral events
- **Processing**:
  1. Validate session token
  2. Store raw events in database
  3. Trigger feature extraction
  4. Update trust score
- **Endpoint**: `/events/batch`

#### 3. Feature Engineering
- **Keystroke Features**:
  - Average hold time
  - Inter-key interval statistics
  - Typing speed (keys/second)
  - Standard deviations
- **Mouse Features**:
  - Average speed and acceleration
  - Click rate
  - Movement patterns
- **Window**: 10-second sliding window

#### 4. Trust Engine
- **Rule-Based Baseline**:
  - Detect bot-like patterns (too fast, too consistent)
  - Flag low activity
  - Identify unusual timing
- **ML Model**: Isolation Forest for anomaly detection
- **Scoring**: Combined weighted score (0-100)
- **Thresholds**:
  - 70-100: OK (continue)
  - 40-69: Monitor
  - 20-39: Step-up required
  - 0-19: Terminate

#### 5. Policy Engine
- **Purpose**: Map trust scores to actions
- **Actions**:
  - **Continue**: Normal operation
  - **Monitor**: Log anomaly, continue
  - **Step-up**: Require re-authentication
  - **Terminate**: End session immediately

### Database Schema

#### Users Table
- `id`: UUID primary key
- `username`: Unique identifier
- `created_at`, `updated_at`: Timestamps
- `is_active`: Boolean flag

#### Credentials Table
- `id`: UUID primary key
- `user_id`: Foreign key to Users
- `credential_id`: WebAuthn credential ID
- `public_key`: Public key for verification
- `sign_count`: Counter for replay protection

#### Sessions Table
- `id`: UUID primary key
- `user_id`: Foreign key to Users
- `token`: JWT token
- `trust_score`: Current score (0-100)
- `status`: OK/MONITOR/SUSPICIOUS/CRITICAL
- `expires_at`: Expiration timestamp

#### Behavioral Events Table
- `id`: UUID primary key
- `session_id`: Foreign key to Sessions
- `event_type`: keystroke/mouse
- `event_data`: JSON payload
- `timestamp`: Event timestamp

#### Feature Vectors Table
- `id`: UUID primary key
- `session_id`: Foreign key to Sessions
- `window_start`, `window_end`: Time window
- Keystroke features (avg_key_hold_time, etc.)
- Mouse features (avg_mouse_speed, etc.)

## Data Flow

### Normal Authentication Flow
1. User initiates login
2. Frontend requests WebAuthn challenge
3. User authenticates with biometric/security key
4. Backend verifies credential and creates session
5. Frontend receives JWT token
6. Behavioral capture starts

### Continuous Monitoring Flow
1. Capture agent collects events (5s batches)
2. Events sent to `/events/batch` endpoint
3. Backend stores raw events
4. Feature extraction runs on 10s windows
5. Trust engine computes score
6. Policy engine determines action
7. Frontend receives updated trust score
8. Dashboard updates in real-time

### Attack Detection Flow
1. Anomalous behavior detected
2. Trust score drops below threshold
3. Policy engine triggers step-up
4. Frontend displays modal
5. User re-authenticates or session terminates

## Security Considerations

### WebAuthn Security
- **Phishing Resistant**: Credentials bound to origin
- **No Shared Secrets**: Public key cryptography
- **Replay Protection**: Sign counter verification
- **Tamper Evident**: Attestation validation

### Behavioral Monitoring
- **Privacy**: No PII in keystroke data
- **Encryption**: HTTPS for all transmissions
- **Validation**: Server-side event sanitization
- **Consent**: User awareness of monitoring

### Trust Scoring
- **Multi-Factor**: Combines multiple signals
- **Adaptive**: Thresholds adjust to context
- **Graceful Degradation**: Step-up before termination
- **Audit Trail**: All decisions logged

## Scalability Considerations

### Horizontal Scaling
- **Stateless Backend**: JWT tokens enable load balancing
- **Database Pooling**: Connection reuse
- **Async Processing**: Event batching reduces load

### Performance Optimization
- **Feature Caching**: Reduce computation
- **Model Inference**: <100ms latency target
- **Database Indexing**: Session and event queries

### Future Enhancements
- **Redis**: Session caching and challenge storage
- **Message Queue**: Async event processing
- **CDN**: Frontend asset delivery
- **Microservices**: Separate trust engine service

## Deployment Architecture

### Development
- Docker Compose orchestration
- Local PostgreSQL instance
- Hot reload for development

### Production (Recommended)
- Kubernetes cluster
- Managed PostgreSQL (AWS RDS, Google Cloud SQL)
- Load balancer for backend
- CDN for frontend
- Secrets management (Vault, AWS Secrets Manager)
- Monitoring (Prometheus, Grafana)
- Logging (ELK stack)

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Axios |
| Backend | FastAPI, Python 3.11 |
| Database | PostgreSQL 15 |
| Auth | WebAuthn (python-webauthn) |
| ML | scikit-learn (Isolation Forest) |
| Session | JWT (python-jose) |
| Container | Docker, Docker Compose |
| Deployment | Nginx (reverse proxy) |
