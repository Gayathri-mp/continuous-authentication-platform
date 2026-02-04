/**
 * Behavioral Capture Agent
 * Captures keystroke and mouse events and sends to backend
 */

const BATCH_INTERVAL = 5000; // 5 seconds
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : '/api';

// State
let isCapturing = false;
let eventBuffer = [];
let batchInterval = null;
let keystrokeCount = 0;
let mouseCount = 0;
let batchesSent = 0;

/**
 * Start capturing behavioral events
 */
function startCapture() {
    if (isCapturing) return;

    isCapturing = true;
    eventBuffer = [];
    keystrokeCount = 0;
    mouseCount = 0;
    batchesSent = 0;

    console.log('Starting behavioral capture...');

    // Add event listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleMouseClick);

    // Start batch sending interval
    batchInterval = setInterval(sendEventBatch, BATCH_INTERVAL);
}

/**
 * Stop capturing behavioral events
 */
function stopCapture() {
    if (!isCapturing) return;

    isCapturing = false;

    console.log('Stopping behavioral capture...');

    // Remove event listeners
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('click', handleMouseClick);

    // Clear interval
    if (batchInterval) {
        clearInterval(batchInterval);
        batchInterval = null;
    }

    // Send remaining events
    if (eventBuffer.length > 0) {
        sendEventBatch();
    }
}

/**
 * Handle keydown event
 */
function handleKeyDown(event) {
    if (!isCapturing) return;

    // Don't capture sensitive fields
    if (event.target.type === 'password') return;

    const eventData = {
        type: 'keystroke',
        key: event.key.length === 1 ? event.key : event.code,
        action: 'down',
        timestamp: Date.now() / 1000
    };

    eventBuffer.push(eventData);
    keystrokeCount++;
    updateActivityStats();
}

/**
 * Handle keyup event
 */
function handleKeyUp(event) {
    if (!isCapturing) return;

    // Don't capture sensitive fields
    if (event.target.type === 'password') return;

    const eventData = {
        type: 'keystroke',
        key: event.key.length === 1 ? event.key : event.code,
        action: 'up',
        timestamp: Date.now() / 1000
    };

    eventBuffer.push(eventData);
}

/**
 * Handle mouse move event (throttled)
 */
let lastMouseMove = 0;
const MOUSE_THROTTLE = 100; // ms

function handleMouseMove(event) {
    if (!isCapturing) return;

    const now = Date.now();
    if (now - lastMouseMove < MOUSE_THROTTLE) return;
    lastMouseMove = now;

    const eventData = {
        type: 'mouse',
        x: event.clientX,
        y: event.clientY,
        action: 'move',
        timestamp: now / 1000
    };

    eventBuffer.push(eventData);
    mouseCount++;
    updateActivityStats();
}

/**
 * Handle mouse click event
 */
function handleMouseClick(event) {
    if (!isCapturing) return;

    const eventData = {
        type: 'mouse',
        x: event.clientX,
        y: event.clientY,
        action: 'click',
        timestamp: Date.now() / 1000
    };

    eventBuffer.push(eventData);
    mouseCount++;
    updateActivityStats();
}

/**
 * Send event batch to backend
 */
async function sendEventBatch() {
    if (eventBuffer.length === 0) return;
    if (!currentToken || !currentSessionId) return;

    const batch = {
        session_id: currentSessionId,
        events: [...eventBuffer]
    };

    // Clear buffer
    eventBuffer = [];

    try {
        const response = await fetch(`${API_BASE}/events/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify(batch)
        });

        if (!response.ok) {
            console.error('Failed to send event batch');
            return;
        }

        const result = await response.json();
        batchesSent++;
        updateActivityStats();

        // Update trust score if provided
        if (result.trust_score !== undefined && window.updateTrustScore) {
            window.updateTrustScore(result.trust_score, result.status);
        }

        console.log(`Batch sent: ${result.events_processed} events, trust score: ${result.trust_score}`);

    } catch (error) {
        console.error('Error sending event batch:', error);
    }
}

/**
 * Update activity statistics in UI
 */
function updateActivityStats() {
    const keystrokeEl = document.getElementById('keystrokeCount');
    const mouseEl = document.getElementById('mouseCount');
    const batchEl = document.getElementById('batchCount');

    if (keystrokeEl) keystrokeEl.textContent = keystrokeCount;
    if (mouseEl) mouseEl.textContent = mouseCount;
    if (batchEl) batchEl.textContent = batchesSent;
}

// Export functions
window.startCapture = startCapture;
window.stopCapture = stopCapture;
