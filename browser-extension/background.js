/**
 * YourCredence Auth Monitor — Background Service Worker (v2)
 *
 * Key fixes over v1:
 * 1. PORT KEEP-ALIVE: Content scripts open a port → keeps this worker alive
 *    as long as any tab is open → setInterval works reliably instead of alarms.
 * 2. STORAGE WRITES: Every trust score update is written to chrome.storage.local
 *    so chrome.storage.onChanged fires in ALL content scripts simultaneously.
 * 3. setInterval INSTEAD OF ALARMS: Alarms have a minimum of 30s in Chrome MV3.
 *    setInterval(5000) works while the worker is alive (kept alive by ports).
 */

const API_BASE = 'http://localhost:8000';

// ── In-memory state ──────────────────────────────────────────────────────────
let authToken    = null;
let sessionId    = null;
let currentScore = null;
let eventBuffer  = [];
let isMonitoring = false;
let lastScores   = [];
let flushTimer   = null;
let pollTimer    = null;

// Track open ports from content scripts (keep-alive mechanism)
const openPorts = new Set();

// ── Authenticated fetch ───────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// ── Start / stop setInterval timers ──────────────────────────────────────────
function startTimers() {
  if (flushTimer) clearInterval(flushTimer);
  if (pollTimer)  clearInterval(pollTimer);
  // Flush events every 5 seconds
  flushTimer = setInterval(flushEventBatch, 5000);
  // Poll trust score every 5 seconds (offset by 2s so they don't collide)
  pollTimer  = setInterval(pollTrustScore,  7000);
  console.log('[YC-BG] Timers started (5s flush / 7s poll)');
}

function stopTimers() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (pollTimer)  { clearInterval(pollTimer);  pollTimer  = null; }
}

// ── Init session ──────────────────────────────────────────────────────────────
async function initSession(token) {
  authToken = token;
  try {
    const info = await apiFetch('/auth/session');
    sessionId    = info.session_id;
    isMonitoring = true;
    lastScores   = [];
    console.log('[YC-BG] Session ready:', sessionId);
    startTimers();
    await pollTrustScore(); // immediate first read
  } catch (err) {
    console.warn('[YC-BG] Session init failed:', err.message);
    authToken    = null;
    sessionId    = null;
    isMonitoring = false;
    updateBadge(null, false);
  }
}

// ── Flush behavioral events ───────────────────────────────────────────────────
async function flushEventBatch() {
  if (!isMonitoring || !authToken || !sessionId) return;
  if (eventBuffer.length === 0) return;

  const batch = [...eventBuffer];
  eventBuffer = [];

  try {
    const result = await apiFetch('/events/batch', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, events: batch }),
    });
    if (result.trust_score !== undefined) {
      handleScoreUpdate(result.trust_score, result.status, result.action, result.require_stepup);
    }
    console.debug(`[YC-BG] Flushed ${batch.length} events → score: ${result.trust_score}`);
  } catch (err) {
    console.error('[YC-BG] Batch flush error:', err.message);
    // Restore events that failed
    eventBuffer = [...batch, ...eventBuffer];
  }
}

// ── Poll trust score ──────────────────────────────────────────────────────────
async function pollTrustScore() {
  if (!isMonitoring || !authToken || !sessionId) return;
  try {
    const result = await apiFetch(`/trust/score/${sessionId}`);
    handleScoreUpdate(result.trust_score, result.status, result.action, result.require_stepup);
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('403')) {
      console.warn('[YC-BG] Session expired — stopping');
      stopMonitoring();
    }
  }
}

// ── Handle a new score ────────────────────────────────────────────────────────
function handleScoreUpdate(score, status, action, requireStepup) {
  const prev = currentScore;
  currentScore = score;

  lastScores.push(score);
  if (lastScores.length > 20) lastScores.shift();

  updateBadge(score, true);

  // KEY FIX: Write score to chrome.storage.local
  chrome.storage.local.set({
    yc_score:  score,
    yc_status: status,
    yc_scores: lastScores,
  });

  // Also broadcast directly to any awake content scripts (fast path)
  broadcastTrustUpdate(score, status, action, requireStepup);

  // ── Session terminated by policy engine ──────────────────────────────────
  if (action === 'terminate') {
    console.warn('[YC-BG] Session terminated by backend — forcing logout on all tabs');
    broadcastForceLogout();
    stopMonitoring();
    return; // nothing more to do
  }

  // Notifications on significant drops
  if (prev !== null && (prev - score) >= 15 && score < 70) {
    chrome.notifications.create('yc_drop_' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'YourCredence: Trust Alert',
      message: `Trust score dropped to ${score.toFixed(0)} — unusual behaviour detected.`,
      priority: 1,
    });
  }

  if (requireStepup) {
    chrome.notifications.create('yc_stepup_' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Step-Up Authentication Required',
      message: 'Open YourCredence dashboard to verify your identity.',
      priority: 2,
    });
  }
}

// ── Broadcast FORCE_LOGOUT to all tabs ───────────────────────────────────────
function broadcastForceLogout() {
  chrome.notifications.create('yc_terminated_' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: '🔴 Session Terminated',
    message: 'Your session was terminated due to suspicious behaviour. Please log in again.',
    priority: 2,
  });

  // Via open ports (immediate)
  for (const port of openPorts) {
    try { port.postMessage({ type: 'FORCE_LOGOUT' }); } catch (_) {}
  }
  // Via tabs API (catches tabs whose port may have closed)
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || tab.id < 0) continue;
      chrome.tabs.sendMessage(tab.id, { type: 'FORCE_LOGOUT' }).catch(() => {});
    }
  });
}

// ── Broadcast TRUST_UPDATE to all awake content scripts ──────────────────────
function broadcastTrustUpdate(score, status, action, requireStepup) {
  // Also send via open ports (immediate, ordered delivery)
  for (const port of openPorts) {
    try {
      port.postMessage({ type: 'TRUST_UPDATE', score, status, action, requireStepup });
    } catch (_) {}
  }
  // Fallback: chrome.tabs.sendMessage to any remaining tabs
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || tab.id < 0) continue;
      chrome.tabs.sendMessage(tab.id, {
        type: 'TRUST_UPDATE', score, status, action, requireStepup,
      }).catch(() => {});
    }
  });
}

// ── Badge text + colour ───────────────────────────────────────────────────────
function updateBadge(score, active) {
  if (!active || score === null) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'YourCredence — Not connected' });
    return;
  }
  const text  = Math.round(score).toString();
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: `YourCredence — Trust: ${score.toFixed(1)}` });
}

// ── Stop monitoring ───────────────────────────────────────────────────────────
function stopMonitoring() {
  authToken    = null;
  sessionId    = null;
  isMonitoring = false;
  currentScore = null;
  lastScores   = [];
  eventBuffer  = [];
  stopTimers();
  updateBadge(null, false);
  // Clear storage so all content scripts hide their borders
  chrome.storage.local.remove(['yc_token', 'yc_score', 'yc_status', 'yc_scores']);
  broadcastTrustUpdate(null, null, null, false);
}

// ── Port-based keep-alive (from content scripts) ──────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'yc-keepalive') return;
  openPorts.add(port);
  console.debug(`[YC-BG] Port connected — ${openPorts.size} active tabs`);

  port.onMessage.addListener((message) => {
    // Receive behavioral events via port (fast path from content scripts)
    if (message.type === 'BEHAVIORAL_EVENT' && isMonitoring) {
      eventBuffer.push(message.data);
    }
  });

  port.onDisconnect.addListener(() => {
    openPorts.delete(port);
    console.debug(`[YC-BG] Port disconnected — ${openPorts.size} active tabs`);
    // If no more tabs open, stop timers (they'll restart when a tab connects)
    if (openPorts.size === 0) {
      stopTimers();
      // Restart immediately to keep polling even without tabs
      if (isMonitoring) startTimers();
    }
  });
});

// ── Message handler (from popup + content script sendMessage fallback) ─────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'BEHAVIORAL_EVENT':
      if (isMonitoring) eventBuffer.push(message.data);
      break;

    case 'YC_LOGIN':
      chrome.storage.local.set({ yc_token: message.token });
      initSession(message.token);
      sendResponse({ ok: true });
      break;

    case 'YC_LOGOUT':
      stopMonitoring();
      sendResponse({ ok: true });
      break;

    case 'GET_STATUS':
      sendResponse({ isMonitoring, score: currentScore, scores: lastScores, sessionId });
      break;
  }
  return false;
});

// ── On service worker startup — restore from storage ──────────────────────────
chrome.storage.local.get(['yc_token'], (result) => {
  if (result.yc_token) {
    console.log('[YC-BG] Restoring session from storage');
    initSession(result.yc_token);
  }
});
