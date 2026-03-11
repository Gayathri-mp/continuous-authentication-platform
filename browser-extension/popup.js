/**
 * YourCredence Auth Monitor — Popup Script
 *
 * Queries the background service worker for current state and renders the UI.
 * Updates dynamically while the popup is open via chrome.runtime messaging.
 */

const PLATFORM_URL = 'http://localhost:5173';

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const connectedView  = document.getElementById('connected-view');
const notConnected   = document.getElementById('not-connected');
const statusPill     = document.getElementById('status-pill');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const scoreNum       = document.getElementById('score-num');
const ringValue      = document.getElementById('ring-value');
const usernameEl     = document.getElementById('username-el');
const sessionStatus  = document.getElementById('session-status-el');
const actionMsg      = document.getElementById('action-msg');
const footerUpdate   = document.getElementById('footer-update');
const btnOpen        = document.getElementById('btn-open');
const sparkCanvas    = document.getElementById('sparkline-canvas');

// Circumference of the ring (r=30)
const CIRC = 2 * Math.PI * 30; // 188.4

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────
function colorFromScore(score) {
  if (score >= 75) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}

function tierFromScore(score) {
  if (score >= 75) return 'active';
  if (score >= 50) return 'warning';
  return 'danger';
}

function updateRing(score) {
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = CIRC * (1 - pct);
  ringValue.style.strokeDashoffset = offset.toFixed(1);
  ringValue.style.stroke = colorFromScore(score);
  scoreNum.textContent = Math.round(score).toString();
}

function drawSparkline(scores) {
  if (!sparkCanvas) return;
  const ctx = sparkCanvas.getContext('2d');
  const w = sparkCanvas.offsetWidth || 308;
  const h = 36;
  sparkCanvas.width  = w;
  sparkCanvas.height = h;

  ctx.clearRect(0, 0, w, h);

  if (!scores || scores.length < 2) return;

  const min = 0, max = 100;
  const pts = scores.map((v, i) => ({
    x: (i / (scores.length - 1)) * (w - 4) + 2,
    y: h - 4 - ((v - min) / (max - min)) * (h - 8),
  }));

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  const lastColor = colorFromScore(scores[scores.length - 1]);
  grad.addColorStop(0,   lastColor + '44');
  grad.addColorStop(1,   lastColor + '00');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, h);
  ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i-1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(pts[pts.length - 1].x, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i-1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = lastColor;
  ctx.lineWidth   = 1.8;
  ctx.stroke();

  // Last point dot
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = lastColor;
  ctx.fill();
}

function renderConnected(state) {
  connectedView.style.display = 'block';
  notConnected.style.display  = 'none';

  const score  = state.score ?? 0;
  const status = state.status ?? 'OK';
  const tier   = tierFromScore(score);

  // Status pill
  statusPill.className = `status-pill ${tier}`;
  statusDot.className  = `status-dot ${tier === 'danger' ? 'blink' : ''}`;
  statusText.textContent = status;

  // Ring
  updateRing(score);

  // Meta
  usernameEl.textContent    = state.username ?? '—';
  sessionStatus.textContent = state.sessionId ? 'Active' : 'Inactive';

  // Action message
  if (score < 50) {
    actionMsg.textContent = '⚠️ Anomalous behaviour detected';
    actionMsg.style.color = '#ef4444';
  } else if (score < 75) {
    actionMsg.textContent = '⚠️ Monitoring — activity is unusual';
    actionMsg.style.color = '#eab308';
  } else {
    actionMsg.textContent = '✓ Session is secure';
    actionMsg.style.color = '#22c55e';
  }

  // Sparkline
  drawSparkline(state.scores || []);

  // Footer
  footerUpdate.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function renderDisconnected() {
  connectedView.style.display = 'none';
  notConnected.style.display  = 'flex';
  statusPill.className  = 'status-pill offline';
  statusDot.className   = 'status-dot';
  statusText.textContent = 'Offline';
  footerUpdate.textContent = '—';
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch state from background
// ─────────────────────────────────────────────────────────────────────────────
function fetchAndRender() {
  // Also read username from storage
  chrome.storage.local.get(['yc_score', 'yc_status', 'yc_scores', 'yc_token'], (items) => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (state) => {
      if (!state || !state.isMonitoring) {
        renderDisconnected();
        return;
      }
      renderConnected({
        score:     state.score ?? items.yc_score,
        status:    items.yc_status,
        scores:    state.scores ?? items.yc_scores ?? [],
        sessionId: state.sessionId,
        username:  '—',
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Open platform button
// ─────────────────────────────────────────────────────────────────────────────
btnOpen.addEventListener('click', () => {
  chrome.tabs.create({ url: PLATFORM_URL });
  window.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Listen for live updates while popup is open
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TRUST_UPDATE' && message.score !== null) {
    chrome.storage.local.get(['yc_status', 'yc_scores'], (items) => {
      renderConnected({
        score:    message.score,
        status:   message.status ?? items.yc_status,
        scores:   items.yc_scores ?? [],
        username: '—',
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
fetchAndRender();
// Auto-refresh every 5 seconds while popup is open
setInterval(fetchAndRender, 5000);
