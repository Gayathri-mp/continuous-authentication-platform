# Complete Setup & Troubleshooting Guide

## Step-by-Step Setup from Scratch

Follow these steps **exactly** to get the application running:

---

## Prerequisites Check

Before starting, verify you have:

```bash
# Check Docker
docker --version
# Should show: Docker version 20.x or higher

# Check Docker Compose
docker-compose --version
# Should show: docker-compose version 1.29 or higher

# Check Node.js
node --version
# Should show: v16.x or higher

# Check npm
npm --version
# Should show: 8.x or higher

# Check Python
python --version
# Should show: Python 3.11 or 3.10
```

**If any are missing:**
- **Docker Desktop**: Download from https://www.docker.com/products/docker-desktop
- **Node.js**: Download from https://nodejs.org (LTS version)
- **Python**: Download from https://python.org (3.11 recommended)

---

## Method 1: Docker Compose (Simplest)

### Step 1: Navigate to Project
```bash
cd d:\project\adaptive-continuous-auth
```

### Step 2: Stop Any Running Services
```bash
docker-compose down
docker ps -a
# Should show no containers running
```

### Step 3: Clean Start
```bash
# Remove old containers and volumes
docker-compose down -v

# Start services
docker-compose up -d

# Wait 30 seconds for services to start
timeout /t 30
```

### Step 4: Check Services Status
```bash
# Check all containers are running
docker-compose ps

# You should see:
# - db (postgres) - Up
# - backend (fastapi) - Up  
# - frontend (nginx) - Up
```

### Step 5: Initialize Database
```bash
docker-compose exec backend python -m app.init_db
```

**Expected output:**
```
Database initialized successfully
Tables created: users, credentials, sessions, behavioral_events, feature_vectors
```

### Step 6: Verify Backend is Running
```bash
# Test backend health
curl http://localhost:8000/health

# Or open in browser: http://localhost:8000/health
# Should show: {"status":"healthy","timestamp":"..."}
```

### Step 7: Access Application
Open browser and go to: **http://localhost:8080**

**If you see HTTP auth dialog**: See "Fixing HTTP Auth Dialog" section below

---

## Method 2: Development Mode (Recommended for Testing)

### Step 1: Start Database Only
```bash
cd d:\project\adaptive-continuous-auth

# Start only PostgreSQL
docker-compose up -d db

# Verify database is running
docker-compose ps db
```

### Step 2: Setup Backend

**Open Terminal 1 (PowerShell or CMD):**
```bash
cd d:\project\adaptive-continuous-auth\backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# For PowerShell:
.\venv\Scripts\Activate.ps1
# For CMD:
venv\Scripts\activate.bat

# Install dependencies
pip install -r requirements.txt

# Set environment variables (PowerShell)
$env:DATABASE_URL="postgresql://authuser:authpass@localhost:5432/authdb"
$env:JWT_SECRET="dev-secret-key-change-in-production"
$env:RP_ID="localhost"
$env:RP_NAME="Adaptive Auth"
$env:RP_ORIGIN="http://localhost:5173"

# For CMD, use:
# set DATABASE_URL=postgresql://authuser:authpass@localhost:5432/authdb
# set JWT_SECRET=dev-secret-key-change-in-production
# set RP_ID=localhost
# set RP_NAME=Adaptive Auth
# set RP_ORIGIN=http://localhost:5173

# Initialize database
python -m app.init_db

# Start backend server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**Keep this terminal open!**

### Step 3: Setup Frontend

**Open Terminal 2 (New PowerShell or CMD):**
```bash
cd d:\project\adaptive-continuous-auth\frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

**Expected output:**
```
  VITE v5.0.11  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h to show help
```

**Keep this terminal open!**

### Step 4: Access Application
Open browser and go to: **http://localhost:5173**

---

## Troubleshooting Common Issues

### Issue 1: "Cannot connect to localhost:8000"

**Diagnosis:**
```bash
# Check if backend is running
curl http://localhost:8000/health

# Check what's using port 8000
netstat -ano | findstr :8000
```

**Solutions:**

**A. Backend not started:**
```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**B. Port 8000 is in use:**
```bash
# Find process using port 8000
netstat -ano | findstr :8000
# Note the PID (last column)

# Kill the process
taskkill /PID <PID> /F

# Restart backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**C. Docker container not running:**
```bash
docker-compose ps
# If backend is not "Up", restart it:
docker-compose restart backend
docker-compose logs backend
```

---

### Issue 2: "Cannot connect to localhost:5173"

**Diagnosis:**
```bash
# Check if npm dev server is running
netstat -ano | findstr :5173
```

**Solutions:**

**A. Frontend not started:**
```bash
cd frontend
npm install
npm run dev
```

**B. Node modules not installed:**
```bash
cd frontend
rm -rf node_modules
rm package-lock.json
npm install
npm run dev
```

**C. Port 5173 is in use:**
```bash
# Kill process on port 5173
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Restart frontend
npm run dev
```

---

### Issue 3: "Database connection failed"

**Diagnosis:**
```bash
# Check if database is running
docker-compose ps db

# Check database logs
docker-compose logs db
```

**Solutions:**

**A. Database not running:**
```bash
docker-compose up -d db
# Wait 10 seconds
timeout /t 10
```

**B. Database not initialized:**
```bash
docker-compose exec backend python -m app.init_db
```

**C. Wrong database credentials:**
Check `docker-compose.yml` for correct credentials:
- Username: `authuser`
- Password: `authpass`
- Database: `authdb`
- Port: `5432`

---

### Issue 4: HTTP Authentication Dialog Appears

**This is NOT the application login!**

**Solution 1: Use Development Server**
- Follow "Method 2: Development Mode" above
- Access http://localhost:5173 instead of http://localhost:8080

**Solution 2: Fix Nginx Configuration**
```bash
# Stop all services
docker-compose down

# Edit nginx.conf and remove any auth_basic directives
# Then restart
docker-compose up -d
```

---

### Issue 5: "Module not found" errors

**Backend:**
```bash
cd backend
venv\Scripts\activate
pip install -r requirements.txt --force-reinstall
```

**Frontend:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

---

### Issue 6: Docker containers won't start

**Complete Docker reset:**
```bash
# Stop all containers
docker-compose down

# Remove all containers
docker-compose down -v

# Remove Docker images
docker-compose down --rmi all

# Rebuild and start
docker-compose build --no-cache
docker-compose up -d
```

---

## Verification Checklist

After setup, verify everything is working:

### ✅ Backend Verification
```bash
# 1. Health check
curl http://localhost:8000/health
# Should return: {"status":"healthy",...}

# 2. API docs accessible
# Open browser: http://localhost:8000/docs
# Should show Swagger UI

# 3. Database connection
docker-compose exec backend python -c "from app.database import engine; engine.connect(); print('DB Connected!')"
```

### ✅ Frontend Verification
```bash
# 1. Dev server running
# Terminal should show: "Local: http://localhost:5173/"

# 2. Open in browser
# Navigate to: http://localhost:5173
# Should see login/register page (NOT HTTP auth dialog)

# 3. Check browser console
# Press F12, go to Console tab
# Should have no red errors
```

### ✅ Full Stack Test
1. Open http://localhost:5173
2. Open browser DevTools (F12) → Network tab
3. Click "Register" tab
4. Enter username: `test123`
5. Click "Register with WebAuthn"
6. Check Network tab for:
   - POST to `http://localhost:8000/auth/register/begin` - Status 200
   - Should see response with challenge

---

## Quick Start Commands (Copy-Paste)

**For Development Mode (Recommended):**

```bash
# Terminal 1 - Database
cd d:\project\adaptive-continuous-auth
docker-compose up -d db

# Terminal 2 - Backend
cd d:\project\adaptive-continuous-auth\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
$env:DATABASE_URL="postgresql://authuser:authpass@localhost:5432/authdb"
$env:JWT_SECRET="dev-secret-key"
$env:RP_ORIGIN="http://localhost:5173"
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 3 - Frontend
cd d:\project\adaptive-continuous-auth\frontend
npm install
npm run dev

# Browser
# Open: http://localhost:5173
```

---

## Still Having Issues?

### Collect Diagnostic Information

```bash
# System info
docker --version
docker-compose --version
node --version
npm --version
python --version

# Service status
docker-compose ps
netstat -ano | findstr :8000
netstat -ano | findstr :5173
netstat -ano | findstr :5432

# Logs
docker-compose logs db
docker-compose logs backend
docker-compose logs frontend

# Save to file
docker-compose logs > logs.txt
```

### Common Error Messages and Fixes

| Error | Solution |
|-------|----------|
| "Port already in use" | Kill process using the port (see Issue 1B, 2C) |
| "Cannot connect to database" | Start database: `docker-compose up -d db` |
| "Module not found" | Reinstall dependencies (see Issue 5) |
| "Permission denied" | Run PowerShell as Administrator |
| "EACCES" | Run `npm cache clean --force` |
| "Docker daemon not running" | Start Docker Desktop |

---

## Success Indicators

You'll know everything is working when:

1. ✅ Backend terminal shows: `Application startup complete`
2. ✅ Frontend terminal shows: `Local: http://localhost:5173/`
3. ✅ Browser shows login/register page (NOT HTTP auth)
4. ✅ No errors in browser console (F12)
5. ✅ http://localhost:8000/health returns JSON
6. ✅ http://localhost:8000/docs shows Swagger UI

---

## Next Steps After Successful Setup

Once everything is running:
1. Go to http://localhost:5173
2. Follow the TESTING_GUIDE.md for testing instructions
3. Register a user with WebAuthn
4. Test the behavioral monitoring features

**Remember**: No passwords needed! Use WebAuthn (fingerprint/face/PIN) for authentication.
