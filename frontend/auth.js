/**
 * WebAuthn Authentication Client
 * Handles registration and login flows
 */

const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : '/api';

// State
let currentToken = null;
let currentSessionId = null;
let currentUsername = null;

/**
 * Initialize authentication UI
 */
function initAuth() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;

            // Update tabs
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`${tab}Form`).classList.add('active');
        });
    });

    // Register button
    document.getElementById('registerBtn').addEventListener('click', handleRegister);

    // Login button
    document.getElementById('loginBtn').addEventListener('click', handleLogin);

    // Check for existing session
    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
        currentToken = savedToken;
        verifySession();
    }
}

/**
 * Handle WebAuthn registration
 */
async function handleRegister() {
    const username = document.getElementById('registerUsername').value.trim();

    if (!username) {
        showToast('Please enter a username', 'error');
        return;
    }

    try {
        showToast('Starting registration...', 'success');

        // Step 1: Begin registration
        const beginResponse = await fetch(`${API_BASE}/auth/register/begin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        if (!beginResponse.ok) {
            const error = await beginResponse.json();
            throw new Error(error.detail || 'Registration failed');
        }

        const { options } = await beginResponse.json();

        // Step 2: Create credential
        showToast('Please use your authenticator...', 'success');

        // Convert challenge from base64
        options.challenge = base64ToArrayBuffer(options.challenge);
        options.user.id = base64ToArrayBuffer(options.user.id);

        const credential = await navigator.credentials.create({
            publicKey: options
        });

        // Step 3: Complete registration
        const credentialData = {
            id: credential.id,
            rawId: arrayBufferToBase64(credential.rawId),
            type: credential.type,
            response: {
                attestationObject: arrayBufferToBase64(credential.response.attestationObject),
                clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON)
            }
        };

        const completeResponse = await fetch(`${API_BASE}/auth/register/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                credential: credentialData
            })
        });

        if (!completeResponse.ok) {
            throw new Error('Registration verification failed');
        }

        const result = await completeResponse.json();
        showToast('Registration successful! Please login.', 'success');

        // Switch to login tab
        document.querySelector('[data-tab="login"]').click();
        document.getElementById('loginUsername').value = username;

    } catch (error) {
        console.error('Registration error:', error);
        showToast(`Registration failed: ${error.message}`, 'error');
    }
}

/**
 * Handle WebAuthn login
 */
async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();

    if (!username) {
        showToast('Please enter a username', 'error');
        return;
    }

    try {
        showToast('Starting login...', 'success');

        // Step 1: Begin authentication
        const beginResponse = await fetch(`${API_BASE}/auth/login/begin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        if (!beginResponse.ok) {
            const error = await beginResponse.json();
            throw new Error(error.detail || 'Login failed');
        }

        const { options } = await beginResponse.json();

        // Step 2: Get credential
        showToast('Please use your authenticator...', 'success');

        // Convert challenge from base64
        options.challenge = base64ToArrayBuffer(options.challenge);
        if (options.allowCredentials) {
            options.allowCredentials = options.allowCredentials.map(cred => ({
                ...cred,
                id: base64ToArrayBuffer(cred.id)
            }));
        }

        const assertion = await navigator.credentials.get({
            publicKey: options
        });

        // Step 3: Complete authentication
        const assertionData = {
            id: assertion.id,
            rawId: arrayBufferToBase64(assertion.rawId),
            type: assertion.type,
            response: {
                authenticatorData: arrayBufferToBase64(assertion.response.authenticatorData),
                clientDataJSON: arrayBufferToBase64(assertion.response.clientDataJSON),
                signature: arrayBufferToBase64(assertion.response.signature),
                userHandle: assertion.response.userHandle ? arrayBufferToBase64(assertion.response.userHandle) : null
            }
        };

        const completeResponse = await fetch(`${API_BASE}/auth/login/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                credential: assertionData
            })
        });

        if (!completeResponse.ok) {
            throw new Error('Authentication verification failed');
        }

        const result = await completeResponse.json();

        // Store session
        currentToken = result.token;
        currentSessionId = result.session_id;
        currentUsername = username;
        localStorage.setItem('authToken', currentToken);

        showToast('Login successful!', 'success');

        // Switch to dashboard
        switchToDashboard();

    } catch (error) {
        console.error('Login error:', error);
        showToast(`Login failed: ${error.message}`, 'error');
    }
}

/**
 * Verify existing session
 */
async function verifySession() {
    try {
        const response = await fetch(`${API_BASE}/auth/session`, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });

        if (response.ok) {
            const session = await response.json();
            currentSessionId = session.session_id;
            currentUsername = session.username;
            switchToDashboard();
        } else {
            localStorage.removeItem('authToken');
            currentToken = null;
        }
    } catch (error) {
        console.error('Session verification error:', error);
        localStorage.removeItem('authToken');
        currentToken = null;
    }
}

/**
 * Switch to dashboard view
 */
function switchToDashboard() {
    document.getElementById('authView').classList.remove('active');
    document.getElementById('dashboardView').classList.add('active');
    document.getElementById('statusBadge').textContent = 'Authenticated';
    document.getElementById('statusBadge').classList.add('authenticated');

    // Initialize dashboard
    if (window.initDashboard) {
        window.initDashboard();
    }

    // Start capture agent
    if (window.startCapture) {
        window.startCapture();
    }
}

/**
 * Logout
 */
async function logout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    }

    // Clear state
    currentToken = null;
    currentSessionId = null;
    currentUsername = null;
    localStorage.removeItem('authToken');

    // Stop capture
    if (window.stopCapture) {
        window.stopCapture();
    }

    // Switch to auth view
    document.getElementById('dashboardView').classList.remove('active');
    document.getElementById('authView').classList.add('active');
    document.getElementById('statusBadge').textContent = 'Not Authenticated';
    document.getElementById('statusBadge').classList.remove('authenticated');

    showToast('Logged out successfully', 'success');
}

/**
 * Utility: Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Utility: ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} active`;

    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initAuth);
