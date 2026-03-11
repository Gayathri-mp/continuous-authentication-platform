/**
 * YourCredence Auth Monitor — Background Service Worker
 *
 * Responsibilities:
 * 1. Reads the auth token from chrome.storage.local (synced by the frontend page)
 * 2. Buffers behavioral events from content scripts across ALL tabs
 * 3. Periodically flushes events to POST /events/batch
 * 4. Periodically polls GET /trust/score to get the latest trust score
 * 5. Broadcasts TRUST_UPDATE messages to all tabs so content scripts update the border
 * 6. Updates the extension badge with the current score
 */

const API_BASE = 'http://localhost:8000';
const BATCH_ALARM = 'yc_batch_flush';
const SCORE_ALARM = 'yc_score_poll';
const ALARM_PERIOD_MINUTES = 0.083; // ~5 seconds

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state (persists until service worker is unloaded)
// ─────────────────────────────────────────────────────────────────────────────
let authToken = null;
let sessionId = null;
let currentScore = null;
let eventBuffer = [];
let isMonitoring = false;
let lastScores = []; // rolling window for sparkline in popup

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Authenticated fetch against our backend
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialise monitoring session
// ─────────────────────────────────────────────────────────────────────────────
async function initSession(token) {
  authToken = token;
  try {
    const info = await apiFetch('/auth/session');
    sessionId = info.session_id;
    isMonitoring = true;
    lastScores = [];
    console.log('[YC-BG] Session initialised:', sessionId);
    // Fetch initial trust score immediately
    await pollTrustScore();
    // Broadcast status to any open popup
    broadcastStatus();
  } catch (err) {
    console.warn('[YC-BG] Failed to init session:', err.message);
    authToken = null;
    sessionId = null;
    isMonitoring = false;
    updateBadge(null, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flush behavioral events to backend
// ─────────────────────────────────────────────────────────────────────────────
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

    console.debug(`[YC-BG] Batch: ${batch.length} events → score: ${result.trust_score}`);

    if (result.trust_score !== undefined) {
      handleScoreUpdate(result.trust_score, result.status, result.action, result.require_stepup);
    }
  } catch (err) {
    console.error('[YC-BG] Batch flush failed:', err.message);
    // Put events back so they are not lost
    eventBuffer = [...batch, ...eventBuffer];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll trust score independently (keeps border updating even during idle)
// ─────────────────────────────────────────────────────────────────────────────
async function pollTrustScore() {
  if (!isMonitoring || !authToken || !sessionId) return;

  try {
    const result = await apiFetch(`/trust/score/${sessionId}`);
    handleScoreUpdate(result.trust_score, result.status, result.action, result.require_stepup);
  } catch (err) {
    // Session may have been terminated
    if (err.message.includes('401') || err.message.includes('403')) {
      console.warn('[YC-BG] Session invalid — stopping monitor');
      stopMonitoring();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle a new score value
// ─────────────────────────────────────────────────────────────────────────────
function handleScoreUpdate(score, status, action, requireStepup) {
  currentScore = score;

  // Rolling sparkline history (last 20 readings)
  lastScores.push(score);
  if (lastScores.length > 20) lastScores.shift();

  updateBadge(score, true);
  broadcastTrustUpdate(score, status, action, requireStepup);

  // Fire notification on significant drops
  if (lastScores.length >= 2) {
    const prev = lastScores[lastScores.length - 2];
    const drop = prev - score;
    if (drop >= 15 && score < 70) {
      chrome.notifications.create('yc_drop_' + Date.now(), {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'YourCredence: Trust Score Alert',
        message: `Trust score dropped to ${score.toFixed(0)} — unusual behaviour detected.`,
        priority: 1,
      });
    }
  }

  // Notify popup if step-up is required
  if (requireStepup) {
    chrome.notifications.create('yc_stepup_' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Step-Up Authentication Required',
      message: 'Please open YourCredence dashboard to verify your identity.',
      priority: 2,
    });
  }

  // Persist state for popup
  chrome.storage.local.set({ yc_score: score, yc_status: status, yc_scores: lastScores });
}

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast TRUST_UPDATE to all content scripts
// ─────────────────────────────────────────────────────────────────────────────
function broadcastTrustUpdate(score, status, action, requireStepup) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || tab.id < 0) continue;
      chrome.tabs.sendMessage(tab.id, {
        type: 'TRUST_UPDATE',
        score,
        status,
        action,
        requireStepup,
      }).catch(() => {}); // tab may not have content script
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast status to popup
// ─────────────────────────────────────────────────────────────────────────────
function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'STATUS',
    isMonitoring,
    score: currentScore,
    scores: lastScores,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge text + colour
// ─────────────────────────────────────────────────────────────────────────────
function updateBadge(score, active) {
  if (!active || score === null) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'YourCredence — Not connected' });
    return;
  }

  const text = Math.round(score).toString();
  let color = '#22c55e'; // green
  if (score < 50) color = '#ef4444';       // red
  else if (score < 75) color = '#eab308';  // yellow

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: `YourCredence — Trust: ${score.toFixed(1)}` });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop monitoring (logout or session termination)
// ─────────────────────────────────────────────────────────────────────────────
function stopMonitoring() {
  authToken = null;
  sessionId = null;
  isMonitoring = false;
  currentScore = null;
  lastScores = [];
  eventBuffer = [];
  updateBadge(null, false);
  broadcastTrustUpdate(null, null, null, false);
  chrome.storage.local.remove(['yc_token', 'yc_score', 'yc_status', 'yc_scores']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome alarms — periodic tasks
// ─────────────────────────────────────────────────────────────────────────────
chrome.alarms.create(BATCH_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
chrome.alarms.create(SCORE_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BATCH_ALARM) await flushEventBatch();
  if (alarm.name === SCORE_ALARM) await pollTrustScore();
});

// ─────────────────────────────────────────────────────────────────────────────
// Message handler — receives from content scripts and popup
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // Content script sends individual behavioral events
    case 'BEHAVIORAL_EVENT':
      if (isMonitoring) {
        eventBuffer.push(message.data);
      }
      break;

    // Frontend page (localhost:5173) sends token after login
    case 'YC_LOGIN':
      chrome.storage.local.set({ yc_token: message.token });
      initSession(message.token);
      sendResponse({ ok: true });
      break;

    // Frontend page sends logout signal
    case 'YC_LOGOUT':
      stopMonitoring();
      sendResponse({ ok: true });
      break;

    // Popup requests current state
    case 'GET_STATUS':
      sendResponse({
        isMonitoring,
        score: currentScore,
        scores: lastScores,
        sessionId,
      });
      break;

    default:
      break;
  }
  return false; // No async sendResponse needed
});

// ─────────────────────────────────────────────────────────────────────────────
// On service worker startup — restore token from storage
// ─────────────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['yc_token'], (result) => {
  if (result.yc_token) {
    console.log('[YC-BG] Restoring session from storage');
    initSession(result.yc_token);
  }
});
