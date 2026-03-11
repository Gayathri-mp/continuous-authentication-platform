# YourCredence — Adaptive Continuous Authentication Platform
### Project Explanation for Examination

---

## Table of Contents

1. [Project Overview & Objective](#1-project-overview--objective)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema & Data Models](#4-database-schema--data-models)
5. [Backend — Module-by-Module Implementation](#5-backend--module-by-module-implementation)
   - 5.1 [Application Entry & Configuration](#51-application-entry--configuration)
   - 5.2 [Authentication Module (`auth/`)](#52-authentication-module-auth)
   - 5.3 [Behavioral Events Module (`events/`)](#53-behavioral-events-module-events)
   - 5.4 [Trust Engine Module (`trust/`)](#54-trust-engine-module-trust)
   - 5.5 [Utilities & Demo Support](#55-utilities--demo-support)
6. [Frontend — Component-by-Component Implementation](#6-frontend--component-by-component-implementation)
   - 6.1 [Entry & Routing](#61-entry--routing)
   - 6.2 [Global Context & API Layer](#62-global-context--api-layer)
   - 6.3 [Behavioral Capture Hook](#63-behavioral-capture-hook)
   - 6.4 [UI Components](#64-ui-components)
7. [How Files Are Connected — End-to-End Flow](#7-how-files-are-connected--end-to-end-flow)
8. [Key Features Implemented](#8-key-features-implemented)
9. [Alignment with Project Objectives](#9-alignment-with-project-objectives)
10. [Evaluation Metrics & Testing](#10-evaluation-metrics--testing)

---

## 1. Project Overview & Objective

**YourCredence** is an *Adaptive Continuous Authentication* platform designed to verify a user's identity not just once at login, but continuously throughout their entire session. The system monitors how a person types and moves their mouse, and uses this behavioral data to build a real-time picture of whether the legitimate user is still in control.

### Core Problem Being Solved

Traditional session management authenticates a user once at login and then trusts that token until it expires. This creates a window of vulnerability: if someone's session token is stolen, an attacker can impersonate them indefinitely. This project solves that problem by:

- **Removing the password** entirely (WebAuthn passwordless login)
- **Continuously monitoring** behavioral biometrics (keystrokes, mouse patterns)
- **Scoring trust in real-time** using machine learning
- **Triggering step-up re-authentication** when behavior becomes suspicious
- **Terminating sessions** automatically when trust drops critically low

### Primary Objectives

| Objective | Implementation |
|-----------|---------------|
| Passwordless authentication | WebAuthn (FIDO2) using hardware security keys / biometrics |
| Continuous identity verification | Behavioral biometric monitoring (keystroke + mouse dynamics) |
| Adaptive response to anomalies | Per-user Isolation Forest ML model + rule-based heuristics |
| Graduated response policy | Trust score thresholds driving CONTINUE → MONITOR → STEPUP → TERMINATE |
| User-visible security dashboard | React frontend showing real-time trust score, alerts, and session status |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER BROWSER                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   React Frontend (Vite, port 5173)                   │   │
│  │   AuthView → Dashboard → useBehavioralCapture hook  │   │
│  │   Components: TrustScoreCard, AlertsCard, StepUpModal│   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │ HTTP REST (via Vite proxy /api/*)      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   YourCredence Browser Extension (Chrome MV3)        │   │
│  │   ├─ background.js (service worker)                  │   │
│  │   │    Polls trust score, flushes events, manages    │   │
│  │   │    session, broadcasts FORCE_LOGOUT to all tabs  │   │
│  │   ├─ content.js (injected into every tab)            │   │
│  │   │    Captures keystrokes + mouse, draws trust      │   │
│  │   │    border overlay, shows force-logout screen     │   │
│  │   └─ popup.html / popup.js                           │   │
│  │        Mini dashboard in the extension badge         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────┼───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              FastAPI Backend (Python, port 8000)             │
│                                                              │
│  ┌──────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │  /auth   │  │   /events   │  │       /trust           │  │
│  │  routes  │  │   routes    │  │       routes           │  │
│  │          │  │             │  │                        │  │
│  │ Register │  │ Batch ingest│  │ Trust score GET        │  │
│  │ Login    │  │ Feature     │  │ Step-up begin/complete │  │
│  │ Logout   │  │ extraction  │  │ Alerts GET             │  │
│  │ Session  │  │ Trust score │  │                        │  │
│  └────┬─────┘  │ computation │  └──────────┬─────────────┘  │
│       │        │ Policy eval │             │                 │
│       │        └──────┬──────┘             │                 │
│       └───────────────┼────────────────────┘                 │
│                       │                                      │
│       ┌───────────────▼────────────────────┐                 │
│       │        SQLite Database (auth.db)    │                 │
│       │  users, credentials, sessions,      │                 │
│       │  behavioral_events, feature_vectors, │                 │
│       │  security_alerts, auth_challenges,  │                 │
│       │  user_baselines                     │                 │
│       └────────────────────────────────────┘                 │
│                                                              │
│       ┌────────────────────────────────────┐                 │
│       │    Per-User ML Models (*.pkl)       │                 │
│       │    data/models/users/{user_id}.pkl  │                 │
│       └────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

The system follows a **three-tier architecture**:
- **Presentation Layer** — React SPA served via Nginx
- **Application Layer** — FastAPI REST API with modular route handlers
- **Data Layer** — SQLite (persistence) + pickle files (ML models)

---

## 3. Technology Stack

### Backend
| Technology | Version | Role |
|------------|---------|------|
| **Python** | 3.12 | Core language |
| **FastAPI** | Latest | REST API framework with async support |
| **SQLAlchemy** | Latest | ORM for database abstraction |
| **SQLite** | Built-in | Persistent data store (single-node) |
| **py-webauthn** | Latest | WebAuthn/FIDO2 registration & authentication |
| **scikit-learn** | Latest | Isolation Forest ML model |
| **NumPy** | Latest | Numerical feature computation |
| **Pydantic** | v2 | Data validation and settings management |

### Frontend
| Technology | Version | Role |
|------------|---------|------|
| **React** | 18 | Component-based UI framework |
| **Vite** | Latest | Fast build tool and dev server |
| **Axios** | Latest | HTTP client for API communication |
| **Vanilla CSS** | — | Styling (no CSS framework used) |

### Browser Extension
| Technology | Role |
|------------|------|
| **Chrome MV3 Extension** | Background service worker + content scripts |
| **chrome.storage API** | Cross-tab trust score synchronization |
| **chrome.cookies API** | Session cookie clearing on force logout |
| **chrome.scripting API** | localStorage/sessionStorage wipe on other-site tabs |
| **Port-based keep-alive** | Prevents MV3 service worker from sleeping |

### Infrastructure
| Technology | Role |
|------------|------|
| **Nginx** | Reverse proxy — serves frontend + routes `/api/*` to backend |
| **Docker / Docker Compose** | Containerized deployment |

---

## 4. Database Schema & Data Models

All models are defined in `backend/app/auth/models.py` and `backend/app/events/models.py`. SQLAlchemy maps each class to a SQL table.

### `users` Table — `User` model
Stores registered user accounts.
- `id` (UUID PK), `username` (unique), `display_name`, `created_at`, `is_active`
- **Relationships**: one-to-many with `credentials`, `sessions`; one-to-one with `user_baselines`

### `credentials` Table — `Credential` model
Stores WebAuthn authenticator credentials (public keys).
- `credential_id` — base64url string, uniquely identifies the hardware key
- `public_key` — CBOR-encoded public key stored as hex string (used for cryptographic signature verification)
- `sign_count` — monotonically increasing counter, prevents credential cloning / replay attacks
- **Foreign key** → `users.id`

### `sessions` Table — `Session` model
Tracks active authenticated sessions.
- `token` — Bearer token sent in every API request (unique, indexed)
- `trust_score` — floating-point value 0–100, updated on each behavioral batch
- `status` — enum: `OK` | `MONITOR` | `SUSPICIOUS` | `TERMINATED`
- `stepup_deadline` — timestamp set when step-up is required; if user doesn't re-authenticate before this, the session is auto-terminated
- **Relationships**: one-to-many with `behavioral_events`, `security_alerts`

### `behavioral_events` Table — `BehavioralEvent` model
Raw event stream from the browser.
- `event_type` — `keystroke` or `mouse`
- `event_data` — JSON blob containing key name/action, mouse coordinates, action type
- `timestamp` — Unix timestamp in seconds (browser wall-clock)

### `feature_vectors` Table — `FeatureVector` model
Time-windowed feature summaries derived from raw events.
- `avg_key_hold_time`, `key_hold_std` — keystroke dynamics
- `avg_inter_key_interval`, `inter_key_std` — inter-key timing
- `typing_speed` — keys per second
- `avg_mouse_speed`, `mouse_speed_std`, `avg_mouse_acceleration` — mouse dynamics
- `click_rate` — clicks per second
- These 12 features form the **input vector** to the ML model

### `security_alerts` Table — `SecurityAlert` model
Audit trail of all trust-related events.
- `alert_type` — `TRUST_DROP` | `STEPUP_REQUIRED` | `STEPUP_SUCCESS` | `STEPUP_FAILED` | `TERMINATED` | `STEPUP_TIMEOUT`
- `severity` — `info` | `warning` | `danger`
- Displayed in the frontend `AlertsCard`

### `auth_challenges` Table — `AuthChallenge` model
Short-lived WebAuthn challenge storage (replaces the in-memory dictionary).
- `username` — namespaced key: `reg:<username>`, `auth:<username>`, or `stepup:<session_id>`
- `challenge` — hex-encoded challenge bytes
- `expires_at` — TTL for automatic expiry
- This table solves the problem of challenges being lost on server restart

### `user_baselines` Table — `UserBaseline` model
Tracks each user's personal ML model.
- `model_path` — file system path to the user's `.pkl` Isolation Forest model
- `sessions_used`, `vectors_used` — metadata about training data quantity
- `last_trained_at` — used to decide when to retrain

---

## 5. Backend — Module-by-Module Implementation

### 5.1 Application Entry & Configuration

#### `backend/app/main.py`
**The application root.** Creates the FastAPI app, registers CORS middleware (allowing requests from the Vite dev server and Nginx-served frontend), and mounts all route routers. On startup:
- Calls `init_db()` to create all SQLAlchemy tables if they don't exist
- If `DEMO_MODE=True`, lowers the ML training thresholds (so the model trains after just 1 session with 5 vectors instead of 3 sessions with 20 vectors), enabling quick demos without real user history
- Registers the `demo` router which exposes `/demo/*` endpoints (passwordless bypass for testing)

Key design decision: ML models are trained **lazily** (on the first scoring call after enough data accumulates), not at startup. This avoids a cold-start delay.

#### `backend/app/config.py`
**Central settings** via `pydantic_settings.BaseSettings`. All configuration lives here as typed fields with defaults, and can be overridden via environment variables or a `.env` file.

Critical settings:
```
TRUST_THRESHOLD_OK     = 70   # score ≥ 70 → CONTINUE
TRUST_THRESHOLD_MONITOR = 40   # score ≥ 40 → MONITOR
TRUST_THRESHOLD_STEPUP  = 20   # score ≥ 20 → STEP-UP REQUIRED
                                # score < 20 → TERMINATE
BATCH_INTERVAL_SECONDS  = 5    # frontend sends events every 5 seconds
FEATURE_WINDOW_SECONDS  = 10   # feature extraction looks back 10 seconds
STEPUP_TIMEOUT_SECONDS  = 30   # user has 30s to complete step-up
```

#### `backend/app/database.py`
**SQLAlchemy engine setup.** Creates the engine from `DATABASE_URL`, provides `Base` (the declarative base class all models inherit from), and the `get_db()` dependency function that yields a database session per request.

#### `backend/app/init_db.py`
**Database initializer.** Calls `Base.metadata.create_all()` to create all tables on first run. Called from `main.py` startup event.

---

### 5.2 Authentication Module (`auth/`)

This module handles everything related to user identity: WebAuthn registration, login, session management, and step-up challenge storage.

#### `backend/app/auth/models.py`
Defines the SQLAlchemy ORM classes: `User`, `Credential`, `Session`, `SecurityAlert`, `AuthChallenge`, and `UserBaseline`. See [Section 4](#4-database-schema--data-models) for details.

#### `backend/app/auth/schemas.py`
**Pydantic request/response models** used by FastAPI for automatic input validation and OpenAPI documentation. Examples:
- `RegistrationBeginRequest` — just `{ username: str }`
- `AuthenticationCompleteResponse` — `{ success, message, token, session_id, expires_at }`
- `SessionResponse` — exposes `trust_score` and `status` to the frontend

#### `backend/app/auth/session.py`
**Session lifecycle utilities** called by both `auth/routes.py` and `events/routes.py`.

Key functions:
- `create_session(db, user_id)` — generates a secure random token (UUID), creates a `Session` row with 60-minute expiry, commits, and returns the session
- `validate_session(db, token)` — looks up the token, checks `is_active=True` and `expires_at > now()`. Returns the session or `None`
- `revoke_session(db, session_id)` — marks `is_active=False`, `status=TERMINATED`
- `update_trust_score(db, session_id, score)` — writes new trust score and updates status based on thresholds (`OK` / `MONITOR` / `SUSPICIOUS`)
- `set_challenge / get_challenge / delete_challenge` — CRUD helpers for the `auth_challenges` table (namespaced key/value store for WebAuthn challenges)

#### `backend/app/auth/routes.py`
**Primary REST endpoints under `/auth/*`.**

**Registration flow (2-phase WebAuthn):**
1. `POST /auth/register/begin` — calls `py-webauthn`'s `generate_registration_options()` with ECDSA and RSA key support. Stores the generated challenge in `auth_challenges` with the key `"reg:<username>"`. Returns the JSON options to the browser.
2. `POST /auth/register/complete` — retrieves and verifies the challenge, calls `verify_registration_response()` to validate the attestation object and extract the CBOR-encoded public key. Creates `User` and `Credential` rows, deletes the challenge.

**Login flow (2-phase WebAuthn):**
1. `POST /auth/login/begin` — looks up the user's registered credentials, passes them as `allow_credentials` to `generate_authentication_options()`. Stores challenge with key `"auth:<username>"`.
2. `POST /auth/login/complete` — verifies the assertion signature using the stored CBOR public key (`bytes.fromhex(cred_record.public_key)`). Checks the sign count increment (replay protection). Creates a new `Session` and returns the bearer token.

**Session endpoints:**
- `GET /auth/session` — validates the token, returns session metadata including the current trust score
- `POST /auth/logout` — validates the token, calls `revoke_session()`

**Demo endpoints (DEMO_MODE only):**
- `POST /auth/demo/login` — available only in `DEMO_MODE=True`. Bypasses WebAuthn entirely for internal testing of the behavioral pipeline. **This button is not exposed in the production frontend UI.**

#### `backend/app/auth/webauthn_helpers.py`
**Binary data parsing utilities** for the WebAuthn protocol. The browser sends credentials as base64url strings; this file provides:
- `b64url_decode()` — converts base64url to raw bytes
- `build_registration_credential()` — constructs the `py-webauthn` `RegistrationCredential` object from the raw JSON dict
- `build_authentication_credential()` — constructs `AuthenticationCredential` for login and step-up verification

---

### 5.3 Behavioral Events Module (`events/`)

This module is the **data collection and feature engineering pipeline** — the foundation of the continuous authentication system.

#### `backend/app/events/models.py`
Defines `BehavioralEvent` (raw events) and `FeatureVector` (processed feature summaries). The `FeatureVector` columns are the 12 numerical features fed to the ML model.

#### `backend/app/events/schemas.py`
Pydantic schemas for the batch ingest API:
- `EventBatch` — `{ session_id: str, events: List[dict] }`
- `EventBatchResponse` — returns `trust_score`, `status`, `action`, `require_stepup` so the frontend immediately knows how to react

#### `backend/app/events/processor.py`
**Feature extraction engine.** Given a `session_id`, it:
1. Queries the last `FEATURE_WINDOW_SECONDS` (10 seconds) of `BehavioralEvent` rows
2. Separates events into keystroke and mouse categories
3. Computes **keystroke features**:
   - `avg_key_hold_time` and `key_hold_std` — how long keys are held down (biometric signature)
   - `avg_inter_key_interval` and `inter_key_std` — time between consecutive keystrokes
   - `typing_speed` — keystrokes per second
4. Computes **mouse features**:
   - `avg_mouse_speed` and `mouse_speed_std` — pixels per second between mouse move events
   - `avg_mouse_acceleration` — rate of change of speed
   - `click_rate` — clicks per second
5. The function `get_feature_array()` converts a `FeatureVector` object to a 12-element `numpy.ndarray` — the exact format expected by the scikit-learn model

**Why these features?** Keystroke and mouse dynamics are known behavioral biometrics — each person has unique patterns in how fast they type, how long they hold keys, and how smoothly they move the mouse. These patterns are difficult to replicate intentionally.

#### `backend/app/events/routes.py`
**Two endpoints under `/events/*`.**

`POST /events/batch` — the **core pipeline endpoint**, called every 5 seconds by the frontend:
1. Validates the Bearer token → gets the session
2. Checks if a step-up deadline has already expired (`_enforce_stepup_timeout`) → terminates the session if overdue
3. Stores all events in `behavioral_events`
4. Calls `extract_features()` → `compute_trust_score()` → `update_trust_score()` → `evaluate_policy()`
5. Based on policy action:
   - `TERMINATE` → revokes the session, emits a `TERMINATED` alert
   - `STEPUP` → sets `stepup_deadline = now + 30s` (only if not already set), emits `STEPUP_REQUIRED` alert
   - `MONITOR` → emits a `TRUST_DROP` info alert
   - `CONTINUE` → clears any lingering `stepup_deadline` (trust has recovered)
6. Returns the trust score, status, and action to the frontend in the response

`GET /events/session/{session_id}` — retrieves raw event data for a session (used for debugging/evaluation).

---

### 5.4 Trust Engine Module (`trust/`)

This is the **intelligence core** of the system — the ML scoring and policy enforcement engine.

#### `backend/app/trust/ml_model.py` — `TrustModel` class
Wraps scikit-learn's `IsolationForest` with a clean API.

**How Isolation Forest works for anomaly detection:**
- Training: the model learns the "normal" distribution of a user's feature vectors from completed sessions
- Prediction: for each new feature vector, the model computes an anomaly score
  - Inliers (behaviors matching training data) get scores near 0 (normal)
  - Outliers (anomalous behaviors) get scores near 1
- The raw `decision_function` output (range typically -0.5 to +0.5) is normalized: `normalized = clamp((-score + 0.5), 0, 1)`
- This is then converted: `personal_score = (1 - anomaly) × 100` so a score of 100 means "perfectly normal"

Key parameters:
- `contamination=0.05` — assumes 5% of training data may be slightly anomalous (conservative for personal models trained on normal sessions only)
- `n_estimators=100` — 100 isolation trees for robust anomaly detection
- `StandardScaler` — normalizes feature values before training/prediction so features with larger ranges (e.g., mouse speed in px/s) don't dominate

The model is serialized with Python's `pickle` and persisted to `data/models/users/{user_id}.pkl`.

#### `backend/app/trust/engine.py`
**Orchestrates per-user model lifecycle and trust score computation.**

**Model lifecycle:**
```
New session → not enough data → rule-based scoring only (cold start)
                    ↓
After MIN_SESSIONS_TO_TRAIN completed sessions with MIN_VECTORS_TO_TRAIN vectors:
                    ↓
_train_and_save_user_model() → TrustModel trained → saved to .pkl → UserBaseline upserted
                    ↓
Every subsequent batch → _get_user_model() loads from cache or disk
                    ↓
Every MIN_RETRAIN_INCREMENT (50) more vectors → automatic retraining
```

**Scoring formula:**
When a personal model exists:
```
final_score = 0.35 × rule_based_score + 0.65 × personal_ml_score
```

During cold-start (no model yet):
```
final_score = rule_based_score only
```

The weighting (35% rule-based, 65% ML) is deliberate: the ML model captures _individual behavior patterns_ more accurately than generic rules, so it gets higher weight once trained. The rule-based component provides a safety backstop against obvious attacks even before the model is ready.

**Rule-based heuristics (`_compute_baseline_score`):**
These fire immediately (even on day-1) as a safety net:
- `typing_speed > 15 keys/s` → −20 (robot-speed typing)
- `inter_key_std < 0.01` → −15 (suspiciously metronomic — no human variety)
- `avg_mouse_speed > 5000 px/s` → −15 (physically impossible mouse movement)
- `avg_key_hold_time < 30ms or > 500ms` → −10 (outside normal human range)

**In-memory model cache:** `_model_cache: Dict[str, TrustModel]` stores loaded models keyed by `user_id`. A threading lock (`_cache_lock`) prevents race conditions on concurrent requests for the same user. Cache hits avoid disk I/O on every event batch.

#### `backend/app/trust/policy.py`
**Translates a trust score into an action.**

```
score ≥ 70    → PolicyAction.CONTINUE   ("Trust level: OK")
40 ≤ score < 70 → PolicyAction.MONITOR   ("Monitoring for anomalies")
20 ≤ score < 40 → PolicyAction.STEPUP    ("Step-up required")
score < 20    → PolicyAction.TERMINATE  ("Session terminated")
```

Returns a dict with `action`, `message`, `require_stepup`, and `trust_score`. This simple, configurable policy layer is **deliberately separated** from the scoring engine so thresholds can be tuned without touching ML code.

#### `backend/app/trust/routes.py`
**Endpoints under `/trust/*`.**

- `GET /trust/score/{session_id}` — returns the current trust score and policy action from the stored session value. Used by the frontend's 10-second polling loop.
- `POST /trust/evaluate` — forces a policy re-evaluation (useful for testing).

**Step-up authentication (two-phase WebAuthn re-authentication):**

`POST /trust/stepup/begin`:
1. Validates the session token (allows SUSPICIOUS sessions to start)
2. Fetches the user's registered credentials
3. Generates a fresh WebAuthn authentication challenge with `UserVerificationRequirement.REQUIRED` (stricter than login)
4. Stores the challenge as `"stepup:<session_id>"`
5. Returns the challenge options to the frontend

`POST /trust/stepup/complete`:
1. Retrieves and validates the stored challenge
2. Confirms the submitted credential belongs to the same user (prevents account-switching attacks)
3. Calls `verify_authentication_response()` with `require_user_verification=True` — full cryptographic assertion signature check
4. Enforces sign count increment (prevents replay of the same authenticator response)
5. **On success**: resets `trust_score=100`, `status=OK`, clears `stepup_deadline`, emits `STEPUP_SUCCESS` alert
6. **On any failure**: immediately calls `_terminate_session_after_failed_stepup()` — the system always terminates on a failed step-up to prevent brute-force

- `GET /trust/alerts/{session_id}` — returns recent `SecurityAlert` rows for display in the frontend's `AlertsCard`

---

### 5.5 Utilities & Demo Support

#### `backend/app/utils/logger.py`
Configures a structured JSON logger. All modules import and use `from app.utils.logger import logger`. Log entries include contextual `extra` fields (session_id, user_id, trust scores) for easier analysis.

#### `backend/app/demo/routes.py`
Demo-mode routes (`/demo/*`) for simulation and automated testing. Key endpoints:
- `POST /demo/simulate-attack` — injects robot-like behavioral events (inhuman typing speed, teleporting mouse) into the current session and re-runs the real ML scoring pipeline. Useful for gradually driving down the trust score.
- `POST /demo/force-terminate` — directly sets the session trust score to 5 and revokes it, bypassing the ML pipeline. Used by the frontend attack simulation panel to guarantee a termination event during demos.
- `POST /demo/reset-trust` — resets trust score to 100 and status to OK for a fresh demo run without needing to log out.
- `GET /demo/status` — quick summary of the current session's trust state.

#### `backend/scripts/train_model.py`
An offline training script used during evaluation. Reads historical feature vectors from the database, trains `TrustModel` instances, and evaluates performance metrics (True Positive Rate, False Positive Rate, step-up rate, average trust latency).

---

## 6. Frontend — Component-by-Component Implementation

The frontend is a React Single Page Application (SPA) built with Vite. All files live in `frontend/src/`.

### 6.1 Entry & Routing

#### `frontend/index.html`
The HTML shell. A single `<div id="root">` where React mounts. Declares the `<title>` and loads `main.jsx` as a module.

#### `frontend/src/main.jsx`
**Application entry point.** Renders the root `<App>` component inside React's `StrictMode`. `App.jsx` decides what to render based on authentication state — it acts as the router, showing either `AuthView` (unauthenticated) or `Dashboard` (authenticated), based on whether a token exists in `AuthContext`.

#### `frontend/vite.config.js`
**Vite configuration.** Sets up the React plugin and proxies `/api/*` requests to `http://localhost:8000` during development. This means frontend components can call `/api/auth/login/begin` without worrying about CORS — the proxy handles it. In production, Nginx takes on this proxy role.

### 6.2 Global Context & API Layer

#### `frontend/src/context/AuthContext.jsx`
**Global authentication state** using React Context and `useContext`.

Stores: `token`, `sessionId`, `username` (persisted in `localStorage`)

Provides:
- `login(token, data)` — sets the token and session details in both state and localStorage. Called by `AuthView` after successful login.
- `logout()` — calls `authAPI.logout(token)`, clears localStorage, resets state. Called from `Dashboard` header and `StepUpModal`.
- `checkAuth()` — on app load, checks if a token in localStorage is still valid (`GET /auth/session`). If not, clears it.

All components that need auth state import `useAuth()` from this context — it's the single source of truth for identity.

#### `frontend/src/services/api.js`
**Centralized HTTP client.** Creates an Axios instance pointed at `/api`. Exports three API namespaces:

- `authAPI` — register, login, demo login, logout, getSession
- `eventsAPI` — submitBatch (the batched behavioral event upload), getSessionEvents
- `trustAPI` — getTrustScore, forceEvaluation, getAlerts, stepupBegin, stepupComplete

Also exports WebAuthn binary conversion utilities:
- `base64ToArrayBuffer()` — decodes base64url strings to `ArrayBuffer` for the WebAuthn browser API
- `arrayBufferToBase64()` — encodes `ArrayBuffer` to base64url for JSON transport
- `serializeCredential()` — converts the browser's `PublicKeyCredential` object into a plain JSON dict for the API

These conversions are necessary because the WebAuthn browser API uses raw binary (`ArrayBuffer`), but HTTP transports JSON.

### 6.3 Behavioral Capture Hook

#### `frontend/src/hooks/useBehavioralCapture.js`
**The most important frontend file.** This custom React hook is the behavioral biometrics collector.

**What it captures:**
- `keydown` events — key name, action `"down"`, Unix timestamp in seconds
- `keyup` events — key name, action `"up"`, Unix timestamp
- `mousemove` events — `x`, `y`, action `"move"`, timestamp (throttled to max 1 event per 100ms)
- `click` events — `x`, `y`, action `"click"`, timestamp

**How it works:**
1. All listeners are attached to `document` (global), so they work regardless of which element is focused
2. Events accumulate in `eventBuffer` (a React ref — persists between renders without causing re-renders)
3. Every 5 seconds (`BATCH_INTERVAL`), `sendEventBatch()` flushes the buffer to `POST /events/batch`
4. The batch response contains `trust_score`, `status`, `action`, and `require_stepup`
5. These are set into the `updateTrustScore` state, which `Dashboard` watches to react appropriately

**Robustness guarantees:**
- Empty batches are never sent (prevents false low-event-count readings)
- Idle detection: if no events occur for 30 seconds, `isIdle` is set to `true` and near-empty batches are skipped
- When `StepUpModal` is open, `pauseCapture()` stops collection and clears the buffer (events during re-authentication challenge aren't from normal usage and shouldn't be scored)
- If the batch API call fails, events are put **back** into the buffer to avoid data loss
- Password field events are explicitly excluded (`if (event.target.type === 'password') return`)

**Exposed API:**
```js
{ stats, updateTrustScore, isIdle, pauseCapture, resumeCapture }
```

### 6.4 UI Components

#### `frontend/src/components/AuthView.jsx`
**The login/register screen.** Two-tab interface:
- **Register tab**: collects a username, calls `authAPI.registerBegin()` to get options, invokes `navigator.credentials.create({ publicKey: options })` to trigger the authenticator, then calls `authAPI.registerComplete()` with the serialized credential
- **Login tab**: similar — `loginBegin()` → `navigator.credentials.get()` → `loginComplete()` → `login()` context call

Binary conversions (base64url ↔ ArrayBuffer) happen here before passing options to the WebAuthn browser API. The login form only exposes WebAuthn — there is no password or bypass button in the production UI.

#### `frontend/src/components/Dashboard.jsx`
**The main post-login screen** and the behavioral monitoring controller.

Initializes:
- `useBehavioralCapture(token, sessionId)` — starts event collection immediately
- `loadSessionInfo()` — fetches initial trust score and session metadata
- `fetchAlerts()` — pulls recent security alerts
- A 10-second polling interval to `trustAPI.getTrustScore()`

Reacts to trust updates (from both behavioral batches and polling) via `applyPolicy()`:
- `terminate` → shows toast, delays 4 seconds, calls `logout()`
- `stepup` → sets `showStepUp=true`, calls `pauseCapture()`, shows `StepUpModal`
- `monitor` → adds a local alert entry

Renders a grid of four cards: `TrustScoreCard`, `SessionInfoCard`, `ActivityCard`, `AlertsCard`. When step-up is active, the dashboard grid gets a `dashboard-locked` class (pointer-events disabled) and `StepUpModal` overlays it.

#### `frontend/src/components/StepUpModal.jsx`
**The re-authentication challenge dialog.** Shown when trust drops into the STEPUP range.

Flow:
1. User clicks "Authenticate Now"
2. Calls `trustAPI.stepupBegin(token)` to get a fresh WebAuthn challenge
3. Converts the challenge and invokes `navigator.credentials.get()` — prompts the user's hardware key or biometric
4. Calls `trustAPI.stepupComplete(token, sessionId, serializedCredential)` to verify with the backend
5. On success: calls `onSuccess()` (Dashboard resets trust to 100, calls `resumeCapture()`)
6. On failure (NotAllowedError, SecurityError): shows an error message within the modal
7. "Logout Instead" button calls `onCancel()` which triggers logout

#### `frontend/src/components/TrustScoreCard.jsx`
Displays the current trust score as a visual gauge (0–100) with color coding (green → yellow → orange → red). Shows the session status label and a manual "Refresh" button.

#### `frontend/src/components/AlertsCard.jsx`
Scrollable list of security events with severity-based color coding. Each entry shows the alert message, type, and timestamp.

#### `frontend/src/components/ActivityCard.jsx`
Shows live behavioral capture statistics: keystroke count, mouse event count, and number of batches sent to the backend.

#### `frontend/src/components/SessionInfoCard.jsx`
Displays session metadata: username, session ID, created time, expiry, and a Logout button.

#### `frontend/src/components/Header.jsx`
Application header bar with the platform name and navigation links.

#### `frontend/src/hooks/useToast.jsx`
Manages ephemeral toast notification state (success/error/warning messages that autohide).

#### `frontend/src/components/Toast.jsx`
The visual toast pop-up component.

---

## 7. How Files Are Connected — End-to-End Flow

### Flow 1: User Registration

```
AuthView.jsx
  → handleRegister()
  → authAPI.registerBegin(username)          [POST /api/auth/register/begin]
      → auth/routes.py::register_begin()
          → py-webauthn: generate_registration_options()
          → session.set_challenge(db, "reg:<user>", challenge)
          ← returns JSON options
  → navigator.credentials.create({ publicKey: options })   [Browser WebAuthn API]
      prompts hardware key / Touch ID / Face ID
      ← returns PublicKeyCredential
  → authAPI.registerComplete(username, credentialData)     [POST /api/auth/register/complete]
      → auth/routes.py::register_complete()
          → session.get_challenge(db, "reg:<user>")
          → py-webauthn: verify_registration_response()
          → creates User + Credential rows in DB
          → session.delete_challenge(db, "reg:<user>")
          ← { success: true, user_id }
```

### Flow 2: User Login

```
AuthView.jsx
  → handleLogin()
  → authAPI.loginBegin(username)             [POST /api/auth/login/begin]
      → auth/routes.py::login_begin()
          → generates auth options with allow_credentials list
          → stores "auth:<user>" challenge
          ← returns options
  → navigator.credentials.get({ publicKey: options })      [Browser WebAuthn API]
      ← returns assertion (signed by hardware key)
  → authAPI.loginComplete(assertionData)     [POST /api/auth/login/complete]
      → auth/routes.py::login_complete()
          → verify_authentication_response() (signature check + sign_count)
          → session.create_session(db, user.id)
          ← { token, session_id, expires_at }
  → AuthContext.login(token, { session_id, username })
      → stores in localStorage
      → App.jsx renders Dashboard
```

### Flow 3: Continuous Behavioral Monitoring

```
Dashboard.jsx
  → useBehavioralCapture(token, sessionId) starts
      → document.addEventListener('keydown', 'keyup', 'mousemove', 'click')
      → every 5s: sendEventBatch()
          → eventsAPI.submitBatch(token, sessionId, batch)    [POST /api/events/batch]
              → events/routes.py::submit_event_batch()
                  → validate_session(db, token)
                  → _enforce_stepup_timeout() — terminate if deadline passed
                  → stores BehavioralEvent rows
                  → extract_features(db, session_id)
                      → events/processor.py performs feature engineering
                      → creates + saves FeatureVector row
                  → compute_trust_score(db, session_id, features)
                      → trust/engine.py
                          → _compute_baseline_score(features)  [rule-based]
                          → _get_user_model(db, user_id)         [load/train IF model]
                              → trust/ml_model.py::TrustModel.predict_anomaly_score()
                          → final_score = 0.35×baseline + 0.65×ml_score
                  → update_trust_score(db, session_id, score)
                  → evaluate_policy(score, status)
                      → trust/policy.py returns action
                  → based on action: set deadline, emit alert, revoke session
                  ← { trust_score, status, action, require_stepup }
      → updateTrustScore state updated
  → Dashboard.useEffect watches updateTrustScore
      → applyPolicy(action, requireStepup, score, status)
          → if terminate: handleTerminate() → logout()
          → if stepup: setShowStepUp(true), pauseCapture()
          → if monitor: addAlert()
```

### Flow 4: Step-Up Authentication

```
Dashboard.jsx → StepUpModal rendered (capture paused)
  → StepUpModal::handleAuth()
  → trustAPI.stepupBegin(token)              [POST /api/trust/stepup/begin]
      → trust/routes.py::stepup_begin()
          → generates challenge with UserVerificationRequirement.REQUIRED
          → stores "stepup:<session_id>" challenge
          ← options JSON
  → navigator.credentials.get({ publicKey }) [Browser → hardware key]
      ← assertion
  → trustAPI.stepupComplete(token, sessionId, credential) [POST /api/trust/stepup/complete]
      → trust/routes.py::stepup_complete()
          → get_challenge("stepup:<session_id>")
          → verifies credential belongs to session's user
          → verify_authentication_response() (require_user_verification=True)
          → success: trust_score=100, status=OK, stepup_deadline=None
          → emits STEPUP_SUCCESS alert
          ← { success: true, trust_score: 100 }
  → onSuccess() in Dashboard
      → setTrustScore(100), setTrustStatus('OK')
      → setShowStepUp(false)
      → resumeCapture()  ← behavioral collection resumes
```

---

## 8. Key Features Implemented

### ✅ Feature 1: Passwordless WebAuthn Authentication
- Full FIDO2/WebAuthn protocol (registration + authentication)
- Supports ECDSA P-256 and RSA-PKCS1 keys
- Hardware keys (YubiKey, etc.), platform authenticators (Touch ID, Windows Hello)
- Database-backed challenge storage (persistent across server restarts)
- Sign-count replay prevention

### ✅ Feature 2: Continuous Behavioral Biometric Monitoring
- Global keydown/keyup and mouse move/click event capture
- Throttled mouse recording (100ms minimum interval) to prevent data overload
- 5-second batch uploads (configurable)
- Idle detection — no false signals during inactivity
- Events never collected during step-up challenge (clean signal)

### ✅ Feature 3: Feature Engineering Pipeline
- 12 behavioral features extracted from each 10-second time window
- Keystroke dynamics: hold time, inter-key intervals, typing speed
- Mouse dynamics: speed, acceleration, click rate, standard deviations
- Automated feature persistence for ML training history

### ✅ Feature 4: Per-User Isolation Forest ML Model
- Each user gets their own personal anomaly detection model
- Trained on that user's own historical behavior only (no cross-user contamination)
- Lazy training — model is trained as soon as enough sessions are available
- Automatic retraining every 50 new feature vectors
- In-memory caching with thread-safe access
- Serialized to disk for persistence across server restarts
- Demo mode lowers training thresholds (1 session, 5 vectors) for quick demonstration

### ✅ Feature 5: Rule-Based Heuristic Safety Net
- Always-active scoring layer, even before the ML model is trained
- Penalizes: robot-speed typing, metronomic keystroke timing, physically impossible mouse speeds, extreme key hold times
- Neutral on inactivity — idle users are not penalized

### ✅ Feature 6: Adaptive Trust Score & Policy Engine
- Real-time trust score (0–100) updated every 5 seconds
- Four policy zones: OK → MONITOR → STEPUP → TERMINATE
- Configurable thresholds (70 / 40 / 20)
- Hybrid scoring: 65% ML + 35% rule-based

### ✅ Feature 7: Step-Up Authentication with Timeout
- Triggered when trust drops into 20–40 range
- Full WebAuthn re-authentication (not just a PIN or password)
- 30-second timeout — session auto-terminates if not completed
- Failed step-up always terminates the session
- Successful step-up resets trust score to 100

### ✅ Feature 8: Session Termination & Security Alerting
- Sessions terminated when trust < 20 or step-up fails/times out
- Every trust event (drop, stepup, success, failure, termination) persisted as a `SecurityAlert`
- Alerts visible in real-time in the frontend dashboard

### ✅ Feature 9: Real-Time Security Dashboard
- Live trust score gauge with color-coded status
- Monitoring warning banner (yellow)
- Step-Up modal overlay (blocks dashboard interaction)
- Security alerts feed showing full event history
- Activity card showing behavioral capture statistics
- Session information card with expiry time

### ✅ Feature 10: Demo & Testing Infrastructure
- Automated test suite (pytest)
- Evaluation script computing TPR, FPR, step-up rate, average trust latency
- Docker Compose setup for reproducible deployment
- Demo backend endpoints (`/demo/simulate-attack`, `/demo/force-terminate`, `/demo/reset-trust`) that are backend-only and not exposed as UI buttons

### ✅ Feature 11: YourCredence Browser Extension (Chrome MV3)
A companion browser extension that extends behavioral monitoring and trust enforcement **across all browser tabs**, not just the platform tab.

- **`background.js`** (service worker): polls the backend for trust scores every 7 seconds, buffers and flushes behavioral events every 5 seconds, broadcasts trust updates and force-logout events to all tabs. Uses port-based keep-alive to prevent MV3 service worker sleep.
- **`content.js`** (injected into every page): captures keystrokes and mouse events, draws a color-coded trust border overlay (🟢 green / 🟡 yellow / 🔴 red) around every tab's viewport, shows a full-screen "Session Terminated" overlay on force logout.
- **`popup.html` / `popup.js`**: mini dashboard in the extension badge showing the current trust score, session status, and connection state.
- **`styles/overlay.css`**: injected CSS for the trust border and force-logout overlay card.
- **Communication**: uses `chrome.storage.local` for reliable cross-tab score distribution and port messaging (`chrome.runtime.connect`) as a fast path. Web page → extension messages use the `window.postMessage` bridge pattern (required because `chrome.runtime.sendMessage` is not available from web pages without `externally_connectable`).

### ✅ Feature 12: Cross-Tab Force Logout
When a session is terminated (trust score < 20), the extension forcefully logs the user out of **all** open browser tabs:

1. **Overlay**: content script shows a full-screen "🔴 Session Terminated" card with a 5-second countdown on every tab
2. **Cookie deletion**: `chrome.cookies.getAll` + `chrome.cookies.remove` deletes all cookies (including HttpOnly) for each tab's origin
3. **Storage wipe**: `chrome.scripting.executeScript` clears `localStorage` and `sessionStorage` on each non-platform tab
4. **Navigation**: each tab is redirected to the site's known logout URL (Pinterest, Google, Facebook, etc.) or reloaded at the root — forcing the site to redirect to its own login page

This applies to both the demo attack simulation and real trust-driven terminations.

### ✅ Feature 13: Attack Simulation Demo Panel
A dedicated demo panel in the dashboard for examiner demonstrations:

- **4-wave escalation**: Waves 1–3 call `POST /demo/simulate-attack` (real ML pipeline — score drops progressively). Wave 4 calls `POST /demo/force-terminate` (guaranteed session termination regardless of ML score).
- **Live UI feedback**: each wave lights up as it runs, the trust score gauge updates in real time.
- **Force logout trigger**: after force-terminate, the Dashboard sends `YC_FORCE_LOGOUT_REQUEST` via `window.postMessage` → content script bridges it to background → all other tabs are logged out.
- **Reset Demo button**: calls `POST /demo/reset-trust` to restore trust score to 100 for repeated demonstrations.

---

## 9. Alignment with Project Objectives

### Objective: Eliminate Password Vulnerabilities
**Achieved.** WebAuthn replaces passwords entirely. Registration and login use hardware security keys or biometrics registered to the user's device. Passwords cannot be phished, leaked in database breaches, or brute-forced.

### Objective: Continuously Verify Identity
**Achieved.** The system does not rely on a single login event. Every 5 seconds, the user's behavioral biometrics are measured and a new trust score is computed. If behavior changes (e.g., a different person takes over the keyboard), the trust score drops within seconds.

### Objective: Adaptive Response (not binary block/allow)
**Achieved.** The response is graduated:
- Low-grade anomaly → MONITOR (log it, alert, but let the session continue)
- Higher anomaly → STEPUP (challenge the user, give them 30 seconds)
- Critical anomaly → TERMINATE immediately

This avoids the frustration of being locked out for minor variations while ensuring real threats are caught promptly.

### Objective: Per-User Personalization
**Achieved.** Each user's ML model is trained only on their own historical behavior. A slow typist will not be flagged for having low typing speed. A fast typist will not be penalized. The model learns *what is normal for this specific person*, not what is normal on average.

### Objective: Security Auditability
**Achieved.** Every trust event is persisted as a `SecurityAlert` with type, message, severity, trust score at the time, and timestamp. This creates a full audit trail of when anomalies were detected and how the system responded.

### Objective: Practical Deployability
**Achieved.** The system runs via Docker Compose (one command to start everything). Nginx handles HTTPS-capable reverse proxying. The SQLite database requires no external service. Demo mode and automated tests make validation straightforward.

---

## 10. Evaluation Metrics & Testing

### ML Model Evaluation
The `backend/scripts/train_model.py` evaluation script computes:

| Metric | Description |
|--------|-------------|
| **True Positive Rate (TPR)** | % of impersonation sessions correctly flagged |
| **False Positive Rate (FPR)** | % of legitimate sessions incorrectly flagged |
| **Step-up Rate** | % of sessions that triggered step-up authentication |
| **Average Trust Latency** | Time from behavior change to trust score dropping below threshold |

### Automated Tests
- `backend/tests/` — pytest test suite
- Integration tests covering: registration flow, login flow, event batch pipeline, trust scoring, step-up flow including the impersonation scenario
- `backend/test_webauthn.py` — unit tests for WebAuthn credential parsing

### Manual Demo Scenario (Impersonation / Attack Simulation)
1. Register and log in normally via WebAuthn (`localhost:5173`)
2. Install the YourCredence browser extension and connect it (popup shows "Connected")
3. Open Pinterest, Google, or any other site in additional tabs
4. On the dashboard, click **"🔴 Launch Attack Simulation"**
5. Watch the trust score drop through each wave (score shown live on the gauge)
6. After wave 4 (force-terminate), all open tabs receive a full-screen "Session Terminated" overlay
7. Other-site sessions (Pinterest, etc.) are logged out via cookie deletion + navigation
8. The **"↺ Reset Demo"** button restores the score to 100 for a repeat demonstration

---

*Document generated: March 2026 | Project: YourCredence Adaptive Continuous Authentication Platform*
