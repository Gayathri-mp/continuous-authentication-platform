# Testing Guide - Adaptive Continuous Authentication Platform

## ⚠️ IMPORTANT: If You See a "Sign in" Dialog

If a browser dialog appears asking for "Username" and "Password" when you first access http://localhost:8080:

**This is NOT the application login!** This is a browser HTTP authentication dialog that shouldn't appear.

**Solution**:
1. **Click "Cancel"** on the dialog
2. **Stop the services**: `docker-compose down`
3. **Access backend directly**: Try http://localhost:8000 in your browser
4. **Check if frontend is running**: The React app should be served by Vite, not Nginx in development
5. **Alternative**: Access the frontend development server directly:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Then open http://localhost:5173 (Vite's default port)

**Why this happens**: The Docker Compose setup is configured for production with Nginx, which may have HTTP authentication enabled. For testing, it's better to run the frontend development server separately.

---

## Prerequisites

Before testing, ensure you have:
- ✅ Modern browser (Chrome, Firefox, Edge, Safari)
- ✅ WebAuthn-compatible authenticator:
  - **Windows**: Windows Hello (fingerprint, face, PIN)
  - **Mac**: Touch ID
  - **Android/iOS**: Biometric unlock
  - **Hardware**: YubiKey, Titan Security Key, or similar
- ✅ Backend running at http://localhost:8000
- ✅ Frontend running (either via Docker or npm dev server)

## Important: No Passwords!

This platform uses **WebAuthn** for passwordless authentication. You will **NOT** need a password. Instead, you'll use:
- Your fingerprint
- Face recognition
- Security key
- Device PIN

---

## Quick Start Testing Guide

### Step 1: Start the Application

**Option A: Using Docker (Production-like)**
```bash
# Navigate to project directory
cd adaptive-continuous-auth

# Start all services
docker-compose up -d

# Initialize database
docker-compose exec backend python -m app.init_db

# Optional: Train ML model
docker-compose exec backend python scripts/train_model.py
```

**Option B: Using Development Server (Recommended for Testing)**
```bash
# Terminal 1: Start backend
cd adaptive-continuous-auth
docker-compose up -d db  # Only start database
cd backend
python -m venv venv
venv\Scripts\activate  # Windows, or: source venv/bin/activate (Mac/Linux)
pip install -r requirements.txt
set DATABASE_URL=postgresql://authuser:authpass@localhost:5432/authdb  # Windows
# export DATABASE_URL=postgresql://authuser:authpass@localhost:5432/authdb  # Mac/Linux
set JWT_SECRET=dev-secret-key-change-in-production  # Windows
# export JWT_SECRET=dev-secret-key-change-in-production  # Mac/Linux
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Start frontend
cd adaptive-continuous-auth/frontend
npm install
npm run dev
```

**Access the application**:
- **Frontend**: http://localhost:5173 (Vite dev server) or http://localhost:8080 (Docker)
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

---

### Step 2: Register a New User

1. **Open the application**: Navigate to http://localhost:8080
2. **Click the "Register" tab**
3. **Enter a username**: 
   - Example: `testuser1`, `alice@example.com`, or any unique identifier
   - This is just an identifier, not a login credential
4. **Click "Register with WebAuthn"**
5. **Authenticate with your device**:
   - Windows: Use Windows Hello (fingerprint, face, or PIN)
   - Mac: Use Touch ID
   - Mobile: Use biometric unlock
   - Hardware key: Insert and touch your security key
6. **Wait for success message**: "Registration successful! Please login."

**Note**: Your biometric/security key is now linked to this username. The credential never leaves your device!

---

### Step 3: Login

1. **Click the "Login" tab**
2. **Enter the same username** you just registered (e.g., `testuser1`)
3. **Click "Login with WebAuthn"**
4. **Authenticate again** with your device
5. **Dashboard loads**: You should see the trust score dashboard

---

### Step 4: Observe Normal Behavior

Once logged in, you'll see the dashboard with:

#### Trust Score Card (Large Circle)
- **Score**: Should start at 100 (perfect trust)
- **Status**: "All systems normal" (green)
- **Color**: Green gradient

#### Session Information
- Your username
- Session ID (truncated)
- Session start time
- Expiration time (60 minutes)

#### Behavioral Activity
- **Keystrokes**: Count of keys pressed
- **Mouse Events**: Count of mouse movements
- **Batches Sent**: Number of event batches sent to backend

#### Security Alerts
- Should show "No security alerts" initially

**What to do**:
- Type naturally in the browser (anywhere on the page)
- Move your mouse around
- Click on different elements
- Watch the activity counters increase
- Observe trust score remains high (90-100)

---

### Step 5: Test Attack Scenarios

#### Scenario A: Bot-like Typing (Rapid & Consistent)

**Goal**: Simulate automated/bot behavior

**Steps**:
1. Type very rapidly and consistently
2. Try to maintain exact same timing between keystrokes
3. Avoid mouse movement
4. Watch the trust score

**Expected Result**:
- Trust score drops below 70 (yellow - "Monitoring for anomalies")
- May drop to 40-69 (orange - "Suspicious activity detected")
- Alert appears: "Suspicious behavior detected"

#### Scenario B: Session Hijacking Simulation

**Goal**: Simulate stolen session token used on different device

**Steps**:
1. Open browser DevTools (F12)
2. Go to Application/Storage → Local Storage
3. Copy the `authToken` value
4. Open a **different browser** or **incognito window**
5. Navigate to http://localhost:8080
6. Open DevTools → Console
7. Run: `localStorage.setItem('authToken', 'PASTE_TOKEN_HERE')`
8. Refresh the page
9. Start typing with different pattern than original user

**Expected Result**:
- Behavioral mismatch detected
- Trust score drops rapidly
- Step-up authentication modal appears
- If not re-authenticated, session terminates

#### Scenario C: No Activity (Idle Detection)

**Goal**: Test low activity detection

**Steps**:
1. Stop typing and moving mouse
2. Wait 30-60 seconds
3. Observe trust score

**Expected Result**:
- Trust score may drop slightly due to lack of behavioral data
- Status changes to "Monitoring for anomalies"

---

### Step 6: Test Step-up Authentication

When trust score drops below 20-39, a modal will appear:

**Step-up Modal**:
- Title: "⚠️ Step-up Authentication Required"
- Message: "Your trust score has dropped below the threshold. Please re-authenticate to continue."
- Current trust score displayed

**Actions**:
1. **Click "Authenticate"**: Re-authenticate with WebAuthn
   - Trust score resets to 100
   - Session continues
2. **Click "Cancel"**: Modal closes but trust continues to degrade
   - If score drops below 20, session terminates

---

### Step 7: Test Logout

1. **Click "Logout" button** in Session Information card
2. **Verify**: Redirected to login page
3. **Check**: Session token removed from localStorage

---

## Testing Checklist

### ✅ Basic Functionality
- [ ] Register new user with WebAuthn
- [ ] Login with WebAuthn
- [ ] Dashboard loads and displays trust score
- [ ] Session information shows correctly
- [ ] Behavioral events captured (keystroke + mouse)
- [ ] Activity stats update in real-time
- [ ] Logout works correctly

### ✅ Trust Scoring
- [ ] Trust score starts at 100
- [ ] Normal behavior keeps score high (90-100)
- [ ] Rapid typing lowers score
- [ ] Bot-like patterns detected
- [ ] Trust score updates every 10 seconds
- [ ] Color changes based on score (green/yellow/orange/red)

### ✅ Attack Detection
- [ ] Bot simulation detected
- [ ] Session hijacking detected (different browser)
- [ ] Step-up modal appears when score < 40
- [ ] Re-authentication resets trust score
- [ ] Session terminates if score < 20

### ✅ UI/UX
- [ ] Animations smooth
- [ ] Toast notifications appear
- [ ] Dashboard responsive
- [ ] No console errors
- [ ] WebAuthn prompts work correctly

---

## Sample Test Users

You can create multiple test users to simulate different scenarios:

| Username | Purpose | Behavior Pattern |
|----------|---------|------------------|
| `normal_user` | Baseline | Type naturally, move mouse |
| `fast_typer` | Speed test | Type very quickly |
| `bot_user` | Bot detection | Consistent timing, no variance |
| `slow_user` | Slow typing | Long pauses between keys |
| `hijacker` | Session hijack | Copy token to different browser |

**Note**: Each user needs to register with their own WebAuthn credential.

---

## Troubleshooting

### Issue: "WebAuthn not supported"
**Solution**: 
- Use a modern browser (Chrome 67+, Firefox 60+, Edge 18+, Safari 13+)
- Ensure HTTPS or localhost (WebAuthn requires secure context)

### Issue: "No authenticator found"
**Solution**:
- Windows: Enable Windows Hello in Settings
- Mac: Ensure Touch ID is set up
- Use a hardware security key

### Issue: "Registration failed"
**Solution**:
- Check backend is running: http://localhost:8000/health
- Check browser console for errors
- Verify database is initialized

### Issue: "Trust score not updating"
**Solution**:
- Type and move mouse to generate events
- Wait 10 seconds for next update
- Check Network tab for `/events/batch` requests
- Verify backend is processing events

### Issue: "Dashboard not loading"
**Solution**:
- Clear localStorage and re-login
- Check JWT token is valid
- Verify session hasn't expired (60 min)

---

## Advanced Testing

### Performance Testing

1. **Event Processing Latency**:
   - Open DevTools → Network tab
   - Filter for `/events/batch`
   - Observe response times (should be < 100ms)

2. **Trust Score Computation**:
   - Filter for `/trust/score`
   - Check response times (should be < 100ms)

3. **Memory Usage**:
   - Open DevTools → Performance/Memory
   - Monitor for memory leaks during extended use

### Security Testing

1. **Token Expiration**:
   - Wait 60 minutes
   - Verify session expires
   - Check forced logout

2. **CORS Testing**:
   - Try accessing API from different origin
   - Verify CORS blocks unauthorized origins

3. **Input Validation**:
   - Try SQL injection in username
   - Try XSS in event data
   - Verify server-side validation

---

## Evaluation Metrics to Collect

While testing, collect these metrics for the evaluation report:

### Authentication
- Registration success rate: ____%
- Login success rate: ____%
- Average registration time: ____s
- Average login time: ____s

### Behavioral Monitoring
- Events captured per minute: ____
- Batch processing latency (p95): ____ms
- Failed batches: ____%

### Trust Scoring
- True positive rate (attacks detected): ____%
- False positive rate (normal flagged): ____%
- Average trust score (normal behavior): ____
- Time to detect anomaly: ____s

### Usability
- Ease of registration (1-10): ____
- Ease of login (1-10): ____
- Trust in security (1-10): ____
- Overall satisfaction (1-10): ____

---

## Expected Behavior Summary

| Action | Expected Trust Score | Expected Status |
|--------|---------------------|-----------------|
| Normal typing + mouse | 90-100 | ✅ OK |
| Rapid consistent typing | 60-80 | ⚠️ Monitor |
| Bot-like patterns | 30-50 | 🔶 Suspicious |
| Session hijacking | 10-30 | 🔴 Critical |
| No activity | 80-90 | ⚠️ Monitor |

---

## Getting Help

- **API Documentation**: http://localhost:8000/docs
- **Backend Health**: http://localhost:8000/health
- **Database Check**: `docker-compose exec backend python -c "from app.database import engine; engine.connect()"`
- **Logs**: `docker-compose logs -f backend`

---

## Next Steps After Testing

1. Fill out evaluation template: `docs/evaluation.md`
2. Document findings and metrics
3. Report bugs or issues
4. Suggest improvements
5. Test on different devices/browsers

---

**Happy Testing! 🚀**

For questions or issues, check the main README.md or documentation in the `docs/` folder.
