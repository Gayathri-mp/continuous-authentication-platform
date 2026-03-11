/**
 * YourCredence Auth Monitor — Content Script (v2)
 *
 * Cross-tab fix: Uses chrome.storage.onChanged as PRIMARY channel for trust
 * score updates. This is reliable across ALL tabs regardless of service worker
 * sleep state. sendMessage is kept as a secondary fast channel.
 *
 * Keep-alive fix: Opens a long-lived port to the background service worker.
 * While any content script port is open, the service worker stays awake and
 * can run setInterval-based event flushing / score polling.
 */

;(function () {
  'use strict';

  if (window.__ycInjected) return;
  window.__ycInjected = true;

  // ─── State ────────────────────────────────────────────────────────────────
  let lastScore = null;
  let lastMouseMove = 0;
  let bgPort = null;
  const MOUSE_THROTTLE = 80; // ms
  const eventQueue = []; // local buffer — flushed via port

  // ─── Keep-alive port ──────────────────────────────────────────────────────
  // Opening a Port keeps the MV3 service worker alive as long as this tab is open.
  function connectPort() {
    try {
      bgPort = chrome.runtime.connect({ name: 'yc-keepalive' });
      bgPort.onDisconnect.addListener(() => {
        bgPort = null;
        // Reconnect after a short delay (e.g. extension update or worker crash)
        setTimeout(connectPort, 2000);
      });
    } catch (_) {}
  }

  // ─── Send behavioral event ─────────────────────────────────────────────────
  function sendEvent(data) {
    if (bgPort) {
      try { bgPort.postMessage({ type: 'BEHAVIORAL_EVENT', data }); } catch (_) {}
    } else {
      // Fallback: postMessage wakes worker if sleeping
      try {
        chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EVENT', data }).catch(() => {});
      } catch (_) {}
    }
  }

  // ─── Create DOM overlay elements ──────────────────────────────────────────
  function createOverlay() {
    if (document.getElementById('yc-trust-border')) return;

    const border = document.createElement('div');
    border.id = 'yc-trust-border';
    document.documentElement.appendChild(border);

    const badge = document.createElement('div');
    badge.id = 'yc-score-badge';
    badge.className = 'yc-hidden';
    badge.innerHTML = `
      <span id="yc-badge-dot"></span>
      <span id="yc-badge-label">Trust</span>
      <span id="yc-badge-score">—</span>
    `;
    document.documentElement.appendChild(badge);
  }

  // ─── Update border + badge color ──────────────────────────────────────────
  function updateBorder(score) {
    const border  = document.getElementById('yc-trust-border');
    const badge   = document.getElementById('yc-score-badge');
    const dot     = document.getElementById('yc-badge-dot');
    const scoreEl = document.getElementById('yc-badge-score');

    if (!border || !badge) {
      // Overlay wasn't created yet (e.g. very fast init) — create it now
      createOverlay();
      setTimeout(() => updateBorder(score), 50);
      return;
    }

    if (score === null || score === undefined) {
      border.className = '';
      badge.className  = 'yc-hidden';
      return;
    }

    let tier;
    if (score >= 75)      tier = 'green';
    else if (score >= 50) tier = 'yellow';
    else                  tier = 'red';

    // Pulse on large drops
    const dropped = lastScore !== null && (lastScore - score) >= 12;

    border.className = `yc-${tier}`;
    if (dropped) {
      border.classList.remove('yc-pulse');
      void border.offsetWidth;
      border.classList.add('yc-pulse');
      setTimeout(() => border.classList.remove('yc-pulse'), 4500);
    }

    badge.className  = '';
    dot.className    = tier === 'green' ? '' : `yc-${tier}-dot`;
    scoreEl.className = tier === 'green' ? '' : `yc-${tier}-score`;
    scoreEl.textContent = Math.round(score).toString();

    lastScore = score;
  }

  // ─── PRIMARY: chrome.storage.onChanged ────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.yc_score !== undefined) {
      // If score was removed (stopMonitoring cleared it), hide the border
      if (changes.yc_score.newValue === undefined) {
        updateBorder(null);
      } else {
        updateBorder(changes.yc_score.newValue);
      }
    }
  });

  // ─── SECONDARY: direct message from background ────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRUST_UPDATE' && message.score !== undefined) {
      updateBorder(message.score);
    }
    if (message.type === 'FORCE_LOGOUT') {
      showForceLogoutOverlay();
    }
  });

  // ─── Force-logout full-screen overlay ────────────────────────────────────
  function showForceLogoutOverlay() {
    // Avoid duplicates
    if (document.getElementById('yc-force-logout')) return;

    // Hide the trust border — session is over
    updateBorder(null);

    const overlay = document.createElement('div');
    overlay.id = 'yc-force-logout';
    overlay.innerHTML = `
      <div id="yc-fl-box">
        <div id="yc-fl-icon">🔴</div>
        <h2 id="yc-fl-title">Session Terminated</h2>
        <p id="yc-fl-msg">
          Continuous authentication detected <strong>suspicious behaviour</strong>.
          Your session has been forcefully terminated for security.
        </p>
        <div id="yc-fl-score-row">
          <span class="yc-fl-chip yc-fl-red">Trust Score: Critical</span>
          <span class="yc-fl-chip yc-fl-grey">Action: TERMINATE</span>
        </div>
        <p id="yc-fl-redirect">Redirecting to login in <span id="yc-fl-countdown">5</span>s…</p>
        <button id="yc-fl-btn">Go to Login Now</button>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    const PLATFORM = 'http://localhost:5173';
    const btn = document.getElementById('yc-fl-btn');
    const countdownEl = document.getElementById('yc-fl-countdown');
    let remaining = 5;

    btn.addEventListener('click', () => { window.location.href = PLATFORM; });

    const tick = setInterval(() => {
      remaining -= 1;
      if (countdownEl) countdownEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(tick);
        window.location.href = PLATFORM;
      }
    }, 1000);
  }

  // ─── Behavioral event listeners ───────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.type === 'password') return;
    sendEvent({ type: 'keystroke', key: e.key.length === 1 ? e.key : e.code, action: 'down', timestamp: Date.now() / 1000 });
  }, { capture: true, passive: true });

  document.addEventListener('keyup', (e) => {
    if (e.target && e.target.type === 'password') return;
    sendEvent({ type: 'keystroke', key: e.key.length === 1 ? e.key : e.code, action: 'up', timestamp: Date.now() / 1000 });
  }, { capture: true, passive: true });

  document.addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now - lastMouseMove < MOUSE_THROTTLE) return;
    lastMouseMove = now;
    sendEvent({ type: 'mouse', x: e.clientX, y: e.clientY, action: 'move', timestamp: now / 1000 });
  }, { capture: true, passive: true });

  document.addEventListener('click', (e) => {
    sendEvent({ type: 'mouse', x: e.clientX, y: e.clientY, action: 'click', timestamp: Date.now() / 1000 });
  }, { capture: true, passive: true });

  // ─── Token sync from the platform page ────────────────────────────────────
  // Only runs on localhost:5173 — reads authToken and hands it to background.
  function syncTokenFromPage() {
    if (!window.location.hostname.includes('localhost')) return;
    const token = localStorage.getItem('authToken');
    if (token) {
      chrome.runtime.sendMessage({ type: 'YC_LOGIN', token }).catch(() => {});
    }
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== 'authToken') return;
    if (e.newValue) {
      chrome.runtime.sendMessage({ type: 'YC_LOGIN', token: e.newValue }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({ type: 'YC_LOGOUT' }).catch(() => {});
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    createOverlay();
    connectPort();
    syncTokenFromPage();

    // Read cached score from storage immediately — no message round-trip needed
    chrome.storage.local.get(['yc_score'], (items) => {
      if (items.yc_score !== undefined && items.yc_score !== null) {
        updateBorder(items.yc_score);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
