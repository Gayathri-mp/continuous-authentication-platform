/**
 * YourCredence Auth Monitor — Content Script
 *
 * Injected into every page by the manifest.
 * Responsibilities:
 *  1. Capture behavioral events (keystrokes, mouse) and forward to background service worker
 *  2. Listen for TRUST_UPDATE messages and update the visual border + score badge
 */

;(function () {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────────
  // Guard: only inject once (handles iframes / script reinsertion edge cases)
  // ───────────────────────────────────────────────────────────────────────────
  if (window.__ycInjected) return;
  window.__ycInjected = true;

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────
  let lastScore = null;
  let lastMouseMove = 0;
  const MOUSE_THROTTLE = 100; // ms

  // ───────────────────────────────────────────────────────────────────────────
  // Build DOM elements for the border overlay and score badge
  // ───────────────────────────────────────────────────────────────────────────
  function createOverlay() {
    if (document.getElementById('yc-trust-border')) return;

    // Trust border (full-viewport fixed div)
    const border = document.createElement('div');
    border.id = 'yc-trust-border';
    document.documentElement.appendChild(border); // attach to <html> not <body>

    // Score badge (bottom-right corner)
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

  // ───────────────────────────────────────────────────────────────────────────
  // Update the visual border and badge based on score
  // ───────────────────────────────────────────────────────────────────────────
  function updateBorder(score) {
    const border = document.getElementById('yc-trust-border');
    const badge  = document.getElementById('yc-score-badge');
    const dot    = document.getElementById('yc-badge-dot');
    const scoreEl = document.getElementById('yc-badge-score');

    if (!border || !badge) return;

    // Determine color tier
    let tier;
    if (score === null || score === undefined) {
      // No active session — hide everything
      border.className = '';
      badge.className  = 'yc-hidden';
      return;
    } else if (score >= 75) {
      tier = 'green';
    } else if (score >= 50) {
      tier = 'yellow';
    } else {
      tier = 'red';
    }

    // Detect large drop → trigger pulse
    const dropped = lastScore !== null && (lastScore - score) >= 12;

    // Update border class
    border.className = `yc-${tier}`;

    if (dropped) {
      // Force reflow so removing then re-adding the class re-triggers animation
      border.classList.remove('yc-pulse');
      void border.offsetWidth; // trigger reflow
      border.classList.add('yc-pulse');
      // Auto-remove pulse class after animation completes (~1.4s × 3 iterations = 4.3s)
      setTimeout(() => border.classList.remove('yc-pulse'), 4500);
    }

    // Update badge
    badge.className = ''; // visible
    dot.className = tier === 'green' ? '' : `yc-${tier}-dot`;
    scoreEl.className = tier === 'green' ? '' : `yc-${tier}-score`;
    scoreEl.textContent = Math.round(score).toString();

    lastScore = score;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Send a behavioral event to the background service worker
  // ───────────────────────────────────────────────────────────────────────────
  function sendEvent(data) {
    try {
      chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EVENT', data }).catch(() => {});
    } catch (_) {}
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Event listeners — capture keyboard + mouse on the whole document
  // ───────────────────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Never capture passwords
    if (e.target && e.target.type === 'password') return;
    sendEvent({
      type: 'keystroke',
      key: e.key.length === 1 ? e.key : e.code,
      action: 'down',
      timestamp: Date.now() / 1000,
    });
  }, { capture: true, passive: true });

  document.addEventListener('keyup', (e) => {
    if (e.target && e.target.type === 'password') return;
    sendEvent({
      type: 'keystroke',
      key: e.key.length === 1 ? e.key : e.code,
      action: 'up',
      timestamp: Date.now() / 1000,
    });
  }, { capture: true, passive: true });

  document.addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now - lastMouseMove < MOUSE_THROTTLE) return;
    lastMouseMove = now;
    sendEvent({
      type: 'mouse',
      x: e.clientX,
      y: e.clientY,
      action: 'move',
      timestamp: now / 1000,
    });
  }, { capture: true, passive: true });

  document.addEventListener('click', (e) => {
    sendEvent({
      type: 'mouse',
      x: e.clientX,
      y: e.clientY,
      action: 'click',
      timestamp: Date.now() / 1000,
    });
  }, { capture: true, passive: true });

  // ───────────────────────────────────────────────────────────────────────────
  // Listen for TRUST_UPDATE messages from the background service worker
  // ───────────────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'TRUST_UPDATE') return;
    updateBorder(message.score);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Check if we're on the YourCredence platform tab — read token from localStorage
  // and send it to the background if found. This bridges the token handoff
  // without requiring externally_connectable config.
  // ───────────────────────────────────────────────────────────────────────────
  function syncTokenFromPage() {
    if (!window.location.hostname.includes('localhost')) return;
    const token = localStorage.getItem('authToken');
    if (token) {
      chrome.runtime.sendMessage({ type: 'YC_LOGIN', token }).catch(() => {});
    }
  }

  // Run on load and also watch for storage changes (login/logout events)
  syncTokenFromPage();

  window.addEventListener('storage', (e) => {
    if (e.key === 'authToken') {
      if (e.newValue) {
        chrome.runtime.sendMessage({ type: 'YC_LOGIN', token: e.newValue }).catch(() => {});
      } else {
        // Token removed = logout
        chrome.runtime.sendMessage({ type: 'YC_LOGOUT' }).catch(() => {});
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Initialise: create overlay elements and request current trust score
  // ───────────────────────────────────────────────────────────────────────────
  function init() {
    createOverlay();
    // Ask the background for the current score so border is correct immediately
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (response && response.score !== null && response.score !== undefined) {
        updateBorder(response.score);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
