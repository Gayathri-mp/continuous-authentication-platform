/**
 * Dashboard Controller
 * Manages dashboard UI and trust score updates
 */

const TRUST_UPDATE_INTERVAL = 10000; // 10 seconds
let trustUpdateInterval = null;

/**
 * Initialize dashboard
 */
function initDashboard() {
    console.log('Initializing dashboard...');

    // Load session info
    loadSessionInfo();

    // Start trust score polling
    startTrustScorePolling();

    // Setup event listeners
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('refreshTrustBtn').addEventListener('click', refreshTrustScore);

    // Step-up modal handlers
    document.getElementById('stepupAuthBtn').addEventListener('click', handleStepUp);
    document.getElementById('stepupCancelBtn').addEventListener('click', closeStepUpModal);
}

/**
 * Load session information
 */
async function loadSessionInfo() {
    try {
        const response = await fetch(`${API_BASE}/auth/session`, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load session info');
        }

        const session = await response.json();

        // Update UI
        document.getElementById('sessionUsername').textContent = session.username;
        document.getElementById('sessionId').textContent = session.session_id.substring(0, 16) + '...';
        document.getElementById('sessionStarted').textContent = formatDate(session.created_at);
        document.getElementById('sessionExpires').textContent = formatDate(session.expires_at);

        // Update trust score
        updateTrustScore(session.trust_score, session.status);

    } catch (error) {
        console.error('Error loading session info:', error);
    }
}

/**
 * Start trust score polling
 */
function startTrustScorePolling() {
    trustUpdateInterval = setInterval(refreshTrustScore, TRUST_UPDATE_INTERVAL);
}

/**
 * Stop trust score polling
 */
function stopTrustScorePolling() {
    if (trustUpdateInterval) {
        clearInterval(trustUpdateInterval);
        trustUpdateInterval = null;
    }
}

/**
 * Refresh trust score
 */
async function refreshTrustScore() {
    if (!currentToken || !currentSessionId) return;

    try {
        const response = await fetch(`${API_BASE}/trust/score/${currentSessionId}`, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch trust score');
            return;
        }

        const data = await response.json();
        updateTrustScore(data.trust_score, data.status);

        // Check if step-up is required
        if (data.require_stepup) {
            showStepUpModal(data.trust_score);
        }

    } catch (error) {
        console.error('Error refreshing trust score:', error);
    }
}

/**
 * Update trust score display
 */
function updateTrustScore(score, status) {
    const scoreValue = document.getElementById('trustScoreValue');
    const scoreCircle = document.getElementById('trustScoreCircle');
    const trustStatus = document.getElementById('trustStatus');
    const statusIndicator = trustStatus.querySelector('.status-indicator');

    // Update score
    scoreValue.textContent = Math.round(score);

    // Update circle color
    scoreCircle.classList.remove('warning', 'danger');
    if (score < 40) {
        scoreCircle.classList.add('danger');
    } else if (score < 70) {
        scoreCircle.classList.add('warning');
    }

    // Update status text
    let statusText = 'All systems normal';
    let statusColor = '#10b981'; // green

    if (status === 'MONITOR') {
        statusText = 'Monitoring for anomalies';
        statusColor = '#f59e0b'; // yellow
    } else if (status === 'SUSPICIOUS') {
        statusText = 'Suspicious activity detected';
        statusColor = '#ef4444'; // red
        addAlert('Suspicious behavior detected. Step-up authentication may be required.', 'warning');
    } else if (status === 'CRITICAL') {
        statusText = 'Critical - Session at risk';
        statusColor = '#ef4444'; // red
        addAlert('Critical trust level. Session will be terminated.', 'danger');
    }

    trustStatus.querySelector('span').textContent = statusText;
    statusIndicator.style.background = statusColor;
}

/**
 * Show step-up authentication modal
 */
function showStepUpModal(trustScore) {
    const modal = document.getElementById('stepupModal');
    const scoreDisplay = document.getElementById('stepupTrustScore');

    scoreDisplay.textContent = `Trust Score: ${Math.round(trustScore)}`;
    modal.classList.add('active');

    addAlert('Step-up authentication required to continue session.', 'warning');
}

/**
 * Close step-up modal
 */
function closeStepUpModal() {
    document.getElementById('stepupModal').classList.remove('active');
}

/**
 * Handle step-up authentication
 */
async function handleStepUp() {
    try {
        showToast('Performing step-up authentication...', 'success');

        // In a real implementation, this would trigger WebAuthn again
        // For now, we'll just call the API
        const response = await fetch(`${API_BASE}/trust/stepup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                session_id: currentSessionId,
                credential: {} // Would contain actual WebAuthn credential
            })
        });

        if (!response.ok) {
            throw new Error('Step-up authentication failed');
        }

        const result = await response.json();

        showToast('Step-up authentication successful!', 'success');
        closeStepUpModal();

        // Refresh trust score
        updateTrustScore(result.trust_score, 'OK');

    } catch (error) {
        console.error('Step-up error:', error);
        showToast(`Step-up failed: ${error.message}`, 'error');
    }
}

/**
 * Add alert to alerts panel
 */
function addAlert(message, type = 'warning') {
    const container = document.getElementById('alertsContainer');

    // Remove "no alerts" message
    const noAlerts = container.querySelector('.no-alerts');
    if (noAlerts) {
        noAlerts.remove();
    }

    // Create alert element
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = `${new Date().toLocaleTimeString()}: ${message}`;

    container.insertBefore(alert, container.firstChild);

    // Limit to 10 alerts
    while (container.children.length > 10) {
        container.removeChild(container.lastChild);
    }
}

/**
 * Format date
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

// Export functions
window.initDashboard = initDashboard;
window.updateTrustScore = updateTrustScore;
