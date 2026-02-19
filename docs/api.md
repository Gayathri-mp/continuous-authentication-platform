# API Reference

## Base URL
- Development: `http://localhost:8000`
- Production: `https://yourdomain.com/api`

## Authentication
Most endpoints require a JWT bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Authentication Endpoints

### POST /auth/register/begin
Start WebAuthn registration process.

**Request Body**:
```json
{
  "username": "string"
}
```

**Response**:
```json
{
  "options": {
    "challenge": "base64-string",
    "rp": { "name": "string", "id": "string" },
    "user": {
      "id": "base64-string",
      "name": "string",
      "displayName": "string"
    },
    "pubKeyCredParams": [...],
    "timeout": 60000,
    "attestation": "none"
  }
}
```

---

### POST /auth/register/complete
Complete WebAuthn registration.

**Request Body**:
```json
{
  "username": "string",
  "credential": {
    "id": "string",
    "rawId": "base64-string",
    "type": "public-key",
    "response": {
      "attestationObject": "base64-string",
      "clientDataJSON": "base64-string"
    }
  }
}
```

**Response**:
```json
{
  "message": "Registration successful"
}
```

---

### POST /auth/login/begin
Start WebAuthn login process.

**Request Body**:
```json
{
  "username": "string"
}
```

**Response**:
```json
{
  "options": {
    "challenge": "base64-string",
    "timeout": 60000,
    "rpId": "string",
    "allowCredentials": [
      {
        "type": "public-key",
        "id": "base64-string"
      }
    ],
    "userVerification": "preferred"
  }
}
```

---

### POST /auth/login/complete
Complete WebAuthn login.

**Request Body**:
```json
{
  "credential": {
    "id": "string",
    "rawId": "base64-string",
    "type": "public-key",
    "response": {
      "authenticatorData": "base64-string",
      "clientDataJSON": "base64-string",
      "signature": "base64-string",
      "userHandle": "base64-string"
    }
  }
}
```

**Response**:
```json
{
  "token": "jwt-token-string",
  "session_id": "uuid",
  "expires_at": "2024-01-01T12:00:00Z"
}
```

---

### GET /auth/session
Get current session information.

**Headers**: `Authorization: Bearer <token>`

**Response**:
```json
{
  "session_id": "uuid",
  "user_id": "uuid",
  "username": "string",
  "trust_score": 95.5,
  "status": "OK",
  "created_at": "2024-01-01T10:00:00Z",
  "expires_at": "2024-01-01T11:00:00Z"
}
```

---

### POST /auth/logout
Logout and revoke session.

**Headers**: `Authorization: Bearer <token>`

**Response**:
```json
{
  "message": "Logged out successfully"
}
```

---

## Event Endpoints

### POST /events/batch
Submit batch of behavioral events.

**Headers**: `Authorization: Bearer <token>`

**Request Body**:
```json
{
  "session_id": "uuid",
  "events": [
    {
      "type": "keystroke",
      "key": "a",
      "action": "down",
      "timestamp": 1704110400.123
    },
    {
      "type": "keystroke",
      "key": "a",
      "action": "up",
      "timestamp": 1704110400.223
    },
    {
      "type": "mouse",
      "x": 100,
      "y": 200,
      "action": "move",
      "timestamp": 1704110400.323
    },
    {
      "type": "mouse",
      "x": 150,
      "y": 250,
      "action": "click",
      "timestamp": 1704110400.423
    }
  ]
}
```

**Response**:
```json
{
  "message": "Events processed successfully",
  "events_processed": 4,
  "trust_score": 92.3,
  "status": "OK"
}
```

---

### GET /events/session/{session_id}
Get events for a session.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:
- `limit` (optional): Maximum number of events (default: 100)

**Response**:
```json
{
  "session_id": "uuid",
  "events": [
    {
      "id": "uuid",
      "type": "keystroke",
      "data": {...},
      "timestamp": "2024-01-01T10:00:00Z"
    }
  ],
  "total": 150
}
```

---

## Trust Endpoints

### GET /trust/score/{session_id}
Get current trust score for a session.

**Headers**: `Authorization: Bearer <token>`

**Response**:
```json
{
  "session_id": "uuid",
  "trust_score": 85.7,
  "status": "OK",
  "last_updated": "2024-01-01T10:05:00Z",
  "require_stepup": false,
  "details": {
    "rule_based_score": 90.0,
    "ml_anomaly_score": 0.15,
    "combined_score": 85.7
  }
}
```

---

### POST /trust/evaluate
Force trust score evaluation for current session.

**Headers**: `Authorization: Bearer <token>`

**Response**:
```json
{
  "trust_score": 88.2,
  "status": "OK",
  "action": "continue",
  "message": "Trust score within acceptable range"
}
```

---

### POST /trust/stepup
Handle step-up authentication.

**Headers**: `Authorization: Bearer <token>`

**Request Body**:
```json
{
  "session_id": "uuid",
  "credential": {
    "id": "string",
    "rawId": "base64-string",
    "type": "public-key",
    "response": {
      "authenticatorData": "base64-string",
      "clientDataJSON": "base64-string",
      "signature": "base64-string"
    }
  }
}
```

**Response**:
```json
{
  "message": "Step-up authentication successful",
  "trust_score": 100.0,
  "status": "OK"
}
```

---

## Health Endpoints

### GET /health
Check API health status.

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T10:00:00Z",
  "version": "1.0.0"
}
```

---

### GET /health/db
Check database connectivity.

**Response**:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2024-01-01T10:00:00Z"
}
```

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "detail": "Invalid request parameters"
}
```

### 401 Unauthorized
```json
{
  "detail": "Invalid or expired token"
}
```

### 403 Forbidden
```json
{
  "detail": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "detail": "Resource not found"
}
```

### 422 Validation Error
```json
{
  "detail": [
    {
      "loc": ["body", "username"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

### 500 Internal Server Error
```json
{
  "detail": "Internal server error"
}
```

---

## Rate Limiting

API endpoints are rate-limited to prevent abuse:
- **Authentication endpoints**: 10 requests/minute per IP
- **Event endpoints**: 120 requests/minute per session
- **Trust endpoints**: 60 requests/minute per session

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1704110460
```

---

## WebSocket (Future Enhancement)

### WS /ws/events
Real-time event streaming (planned feature).

**Connection**:
```javascript
const ws = new WebSocket('wss://yourdomain.com/ws/events?token=<jwt-token>')
```

**Message Format**:
```json
{
  "type": "trust_update",
  "data": {
    "trust_score": 87.5,
    "status": "OK",
    "timestamp": "2024-01-01T10:00:00Z"
  }
}
```

---

## Code Examples

### JavaScript/React

```javascript
import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' }
})

// Login
async function login(username) {
  const { data: options } = await api.post('/auth/login/begin', { username })
  
  // Convert challenge
  options.challenge = base64ToArrayBuffer(options.challenge)
  
  // Get credential
  const credential = await navigator.credentials.get({ publicKey: options })
  
  // Complete login
  const { data } = await api.post('/auth/login/complete', {
    credential: serializeCredential(credential)
  })
  
  return data.token
}

// Submit events
async function submitEvents(token, sessionId, events) {
  const { data } = await api.post('/events/batch', {
    session_id: sessionId,
    events
  }, {
    headers: { Authorization: `Bearer ${token}` }
  })
  
  return data
}
```

### Python

```python
import requests

API_BASE = 'http://localhost:8000'

# Login
def login(username):
    # Begin login
    response = requests.post(f'{API_BASE}/auth/login/begin', json={
        'username': username
    })
    options = response.json()['options']
    
    # ... WebAuthn flow ...
    
    # Complete login
    response = requests.post(f'{API_BASE}/auth/login/complete', json={
        'credential': credential_data
    })
    
    return response.json()['token']

# Submit events
def submit_events(token, session_id, events):
    response = requests.post(f'{API_BASE}/events/batch', 
        json={'session_id': session_id, 'events': events},
        headers={'Authorization': f'Bearer {token}'}
    )
    return response.json()
```

---

## Interactive API Documentation

FastAPI provides interactive API documentation:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

These interfaces allow you to:
- Explore all endpoints
- View request/response schemas
- Test API calls directly
- Download OpenAPI specification
