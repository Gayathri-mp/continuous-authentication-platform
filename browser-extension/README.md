# YourCredence Browser Extension

A **Chromium Manifest V3** browser extension that adds:

- 🌈 **Visual trust border** — colored outline around every browser tab reflecting the real-time trust score
- 🟢 Green (≥ 75) · 🟡 Yellow (50–74) · 🔴 Red (< 50) — pulses on large drops
- 🔢 **Floating score badge** — bottom-right corner on every page
- 🛡️ **Toolbar popup** — score ring, sparkline history, session status
- 🔔 **Desktop notifications** — alerts on trust drops and step-up requirements
- 📡 **Background monitoring** — captures keystrokes + mouse across ALL tabs and sends to backend

---

## Requirements

- Google Chrome 105+ or Microsoft Edge 105+ (any Chromium-based browser)
- YourCredence platform running locally (`backend` on port **8000**, `frontend` on port **5173**)

---

## Installation (Developer / Unpacked Extension)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Navigate to `d:\project\adaptive-continuous-auth\browser-extension` and click **Select Folder**
5. The **YourCredence Monitor** extension will appear in your extensions list and toolbar

> **Tip:** Pin the extension to your toolbar by clicking the puzzle-piece icon → pin YourCredence.

---

## How to Connect

1. Start the backend:
   ```powershell
   cd d:\project\adaptive-continuous-auth\backend
   .\venv\Scripts\activate
   uvicorn app.main:app --port 8000 --reload
   ```

2. Start the frontend:
   ```powershell
   cd d:\project\adaptive-continuous-auth\frontend
   npm run dev
   ```

3. Open `http://localhost:5173` in Chrome and **log in** (demo login or WebAuthn)
4. The extension automatically receives the session token and begins monitoring
5. Navigate to **any other website** — you'll see the colored trust border appear

---

## Trust Border Colors

| Color | Score | Meaning |
|-------|-------|---------|
| 🟢 Green | ≥ 75 | Session healthy |
| 🟡 Yellow | 50–74 | Unusual behaviour — monitoring |
| 🔴 Red (pulsing) | < 50 | Anomaly detected — step-up may be required |

The border **pulses** when the score drops by more than 12 points in a single update.

---

## Popup Features

Click the extension icon in the toolbar to open the popup:

- **Circular score ring** — fills to represent current trust score
- **Status pill** — Active / Warning / Danger
- **Score history sparkline** — last 20 readings
- **Open Platform button** — opens `http://localhost:5173`

---

## Architecture

```
[content.js]  ──keystrokes/mouse──►  [background.js service worker]
                                              │
                                    ┌─────────┴──────────┐
                                    │ POST /events/batch  │
                                    │ GET  /trust/score   │── Backend :8000
                                    └─────────────────────┘
                                              │
[content.js]  ◄────TRUST_UPDATE──────────────┘
     └── updates colored border overlay on every page

[popup.js]    ◄────GET_STATUS message ─────── background.js
     └── renders score ring and sparkline
```

**Token handoff** — The content script reads `authToken` from `localStorage` when running on `localhost:5173` (the platform tab). It sends it to the background service worker via `chrome.runtime.sendMessage`. This requires no extra config or `externally_connectable` manifest permissions.

---

## Simulating an Attack (Demo / Testing)

To make the trust score drop and see the border change color, use PyAutoGUI to generate robotic mouse/keyboard input:

```python
import pyautogui, time, random

# Simulate instant, robotic mouse teleports — no human movement variance
for _ in range(60):
    pyautogui.moveTo(random.randint(0, 1920), random.randint(0, 1080), duration=0)
    pyautogui.click()
    time.sleep(0.05)
```

Run while the platform session is active. The anomaly detector will flag the inhuman pattern and the trust border will turn yellow then red.

---

## Files

```
browser-extension/
├── manifest.json       — Extension manifest (MV3)
├── background.js       — Service worker: API calls, alarm scheduling, badge
├── content.js          — Injected into all pages: event capture + border update
├── popup.html          — Popup markup
├── popup.js            — Popup logic: ring, sparkline, status
├── styles/
│   └── overlay.css     — Border overlay + badge styles (injected)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           — This file
```
