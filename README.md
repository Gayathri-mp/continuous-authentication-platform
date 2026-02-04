# Adaptive Continuous Authentication Platform

A proof-of-concept adaptive continuous authentication system that combines passwordless WebAuthn login with real-time behavioral monitoring and ML-based trust scoring.

## 🎯 Overview

This platform provides:

1. **Passwordless Authentication** - WebAuthn/FIDO2 for initial login
2. **Behavioral Monitoring** - Continuous keystroke and mouse dynamics tracking
3. **Real-time Trust Scoring** - ML-based anomaly detection using Isolation Forest
4. **Adaptive Policy Enforcement** - Dynamic step-up authentication or session termination

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser Client                        │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  WebAuthn  │  │   Capture    │  │    Dashboard     │    │
│  │     UI     │  │    Agent     │  │   (Trust Score)  │    │
│  └────────────┘  └──────────────┘  └──────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS / WebSocket
┌─────────────────────────▼───────────────────────────────────┐
│                      Backend (FastAPI)                       │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │    Auth    │  │    Event     │  │      Trust       │    │
│  │   Module   │  │  Ingestion   │  │     Engine       │    │
│  └────────────┘  └──────────────┘  └──────────────────┘    │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  Session   │  │   Feature    │  │     Policy       │    │
│  │  Manager   │  │  Extraction  │  │     Engine       │    │
│  └────────────┘  └──────────────┘  └──────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    PostgreSQL Database                       │
│     Users | Sessions | Events | Features | Credentials      │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Modern browser with WebAuthn support (Chrome, Firefox, Edge)
- Hardware security key or platform authenticator (Windows Hello, Touch ID, etc.)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd adaptive-continuous-auth
   ```

2. **Start the services**
   ```bash
   docker-compose up -d
   ```

3. **Initialize the database**
   ```bash
   docker-compose exec backend python -m app.init_db
   ```

4. **Access the application**
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

### Local Development (without Docker)

1. **Backend setup**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   
   # Set environment variables
   export DATABASE_URL="postgresql://user:pass@localhost/authdb"
   export JWT_SECRET="your-secret-key"
   
   # Run the server
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Frontend setup**
   ```bash
   cd frontend
   # Serve with any static file server
   python -m http.server 8080
   ```

## 📡 API Reference

### Authentication Endpoints

#### Register User (WebAuthn)
```http
POST /auth/register/begin
Content-Type: application/json

{
  "username": "user@example.com"
}
```

```http
POST /auth/register/complete
Content-Type: application/json

{
  "username": "user@example.com",
  "credential": { ... }
}
```

#### Login (WebAuthn)
```http
POST /auth/login/begin
Content-Type: application/json

{
  "username": "user@example.com"
}
```

```http
POST /auth/login/complete
Content-Type: application/json

{
  "credential": { ... }
}
```

### Behavioral Monitoring Endpoints

#### Submit Event Batch
```http
POST /events/batch
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "session_id": "uuid",
  "events": [
    {
      "type": "keystroke",
      "key": "a",
      "action": "down",
      "timestamp": 1234567890.123
    },
    {
      "type": "mouse",
      "x": 100,
      "y": 200,
      "action": "move",
      "timestamp": 1234567890.456
    }
  ]
}
```

### Trust Endpoints

#### Get Trust Score
```http
GET /trust/score/{session_id}
Authorization: Bearer <session_token>
```

Response:
```json
{
  "session_id": "uuid",
  "trust_score": 85,
  "status": "OK",
  "last_updated": "2026-02-04T07:30:00Z"
}
```

## 🔒 Security Considerations

### WebAuthn Security
- Uses FIDO2 protocol for phishing-resistant authentication
- Credentials never leave the authenticator device
- Public key cryptography prevents credential theft

### Behavioral Monitoring
- Events collected client-side with minimal PII
- Encrypted transmission over HTTPS
- Server-side validation and sanitization

### Trust Scoring
- Multi-factor behavioral analysis
- Adaptive thresholds based on risk context
- Graceful degradation (step-up auth before termination)

### Data Protection
- Session tokens use JWT with short expiration
- Database credentials encrypted at rest
- Audit logging for all authentication events

## 🧪 Testing & Evaluation

### Run Tests
```bash
# Backend unit tests
cd backend
pytest tests/ -v

# Integration tests
docker-compose up -d
pytest tests/integration/ -v
```

### Attack Simulation Scenarios

1. **Session Hijacking**
   - Copy session token to different machine
   - Observe behavioral mismatch detection
   - Verify step-up authentication trigger

2. **Credential Stuffing**
   - Attempt automated login attempts
   - Verify WebAuthn prevents credential reuse

3. **Impersonation**
   - Different user types with stolen session
   - Observe trust score degradation
   - Verify session termination

### Performance Metrics
- Event processing latency: <50ms (p95)
- Trust score computation: <100ms (p95)
- False positive rate: <5% (target)
- True positive rate: >95% (target)

## 📊 Trust Score Policy

| Trust Score | Status | Action |
|------------|--------|--------|
| 70-100 | ✅ OK | Continue session |
| 40-69 | ⚠️ Monitor | Log anomaly, continue |
| 20-39 | 🔶 Suspicious | Require step-up auth |
| 0-19 | 🔴 Critical | Terminate session |

## 🛠️ Technology Stack

### Backend
- **Framework**: FastAPI (Python 3.11)
- **Database**: PostgreSQL 15
- **Authentication**: python-webauthn
- **ML**: scikit-learn (Isolation Forest)
- **Session**: JWT tokens

### Frontend
- **UI**: HTML5, CSS3, Vanilla JavaScript
- **Auth**: WebAuthn API
- **Communication**: Fetch API / WebSocket

### DevOps
- **Containerization**: Docker
- **Orchestration**: Docker Compose

## 📁 Project Structure

```
adaptive-continuous-auth/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Configuration
│   │   ├── database.py          # Database setup
│   │   ├── auth/                # Authentication module
│   │   ├── events/              # Event ingestion
│   │   ├── trust/               # Trust engine & policy
│   │   └── utils/               # Utilities
│   ├── scripts/                 # Training & data generation
│   ├── tests/                   # Test suite
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── index.html               # Main UI
│   ├── style.css                # Styling
│   ├── capture.js               # Behavioral capture agent
│   ├── auth.js                  # WebAuthn client
│   └── dashboard.js             # Monitoring dashboard
├── data/
│   ├── raw_events/              # Event logs
│   ├── features/                # Extracted features
│   └── models/                  # ML models
├── docs/
│   ├── architecture.md          # Architecture details
│   ├── threat_model.md          # Security analysis
│   ├── api.md                   # API documentation
│   └── evaluation.md            # Evaluation report
├── docker-compose.yml
└── README.md
```

## 🤝 Contributing

This is a proof-of-concept research project. Contributions welcome for:
- Additional behavioral signals (touch, gyroscope)
- Advanced ML models (autoencoders, LSTMs)
- Mobile client support
- Performance optimizations

## 📄 License

MIT License - See LICENSE file for details

## 🔗 References

- [WebAuthn Specification](https://www.w3.org/TR/webauthn/)
- [FIDO2 Project](https://fidoalliance.org/fido2/)
- [Behavioral Biometrics Research](https://ieeexplore.ieee.org/)

## 📞 Support

For issues and questions, please open a GitHub issue or contact the development team.

---

**⚠️ Disclaimer**: This is a proof-of-concept system for research and educational purposes. Not recommended for production use without additional security hardening and compliance review.
