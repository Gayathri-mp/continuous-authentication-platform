import axios from 'axios'

const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : '/api'

const api = axios.create({
    baseURL: API_BASE,
    headers: {
        'Content-Type': 'application/json'
    }
})

// WebAuthn utility functions
export const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
}

export const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Authentication API
export const authAPI = {
    async registerBegin(username) {
        const response = await api.post('/auth/register/begin', { username })
        return response.data
    },

    async registerComplete(username, credential) {
        const response = await api.post('/auth/register/complete', {
            username,
            credential
        })
        return response.data
    },

    async loginBegin(username) {
        const response = await api.post('/auth/login/begin', { username })
        return response.data
    },

    async loginComplete(credential) {
        const response = await api.post('/auth/login/complete', { credential })
        return response.data
    },

    async logout(token) {
        const response = await api.post('/auth/logout', {}, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    },

    async getSession(token) {
        const response = await api.get('/auth/session', {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    }
}

// Events API
export const eventsAPI = {
    async submitBatch(token, sessionId, events) {
        const response = await api.post('/events/batch', {
            session_id: sessionId,
            events
        }, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    },

    async getSessionEvents(token, sessionId, limit = 100) {
        const response = await api.get(`/events/session/${sessionId}`, {
            params: { limit },
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    }
}

// Trust API
export const trustAPI = {
    async getTrustScore(token, sessionId) {
        const response = await api.get(`/trust/score/${sessionId}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    },

    async forceEvaluation(token) {
        const response = await api.post('/trust/evaluate', {}, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    },

    async handleStepUp(token, sessionId, credential) {
        const response = await api.post('/trust/stepup', {
            session_id: sessionId,
            credential
        }, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    }
}

export default api
