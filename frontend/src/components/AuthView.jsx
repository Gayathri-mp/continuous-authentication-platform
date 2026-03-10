import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authAPI, base64ToArrayBuffer, arrayBufferToBase64 } from '../services/api'
import { useToast } from '../hooks/useToast'
import './AuthView.css'

function AuthView() {
    const [activeTab, setActiveTab] = useState('login')
    const [loginUsername, setLoginUsername] = useState('')
    const [registerUsername, setRegisterUsername] = useState('')
    const [loading, setLoading] = useState(false)
    const { login } = useAuth()
    const { showToast } = useToast()

    const handleRegister = async (e) => {
        e.preventDefault()
        if (!registerUsername.trim()) {
            showToast('Please enter a username', 'error')
            return
        }

        setLoading(true)
        try {
            showToast('Starting registration...', 'success')

            // Begin registration
            const { options } = await authAPI.registerBegin(registerUsername)

            // Convert challenge from base64
            options.challenge = base64ToArrayBuffer(options.challenge)
            options.user.id = base64ToArrayBuffer(options.user.id)

            showToast('Please use your authenticator...', 'success')

            // Create credential
            const credential = await navigator.credentials.create({
                publicKey: options
            })

            // Complete registration
            const credentialData = {
                id: credential.id,
                rawId: arrayBufferToBase64(credential.rawId),
                type: credential.type,
                response: {
                    attestationObject: arrayBufferToBase64(credential.response.attestationObject),
                    clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON)
                }
            }

            await authAPI.registerComplete(registerUsername, credentialData)

            showToast('Registration successful! Please login.', 'success')
            setActiveTab('login')
            setLoginUsername(registerUsername)

        } catch (error) {
            console.error('Registration error:', error)
            const detail = error.response?.data?.detail || error.message
            showToast(`Registration failed: ${detail}`, 'error')
        } finally {
            setLoading(false)
        }
    }

    const handleLogin = async (e) => {
        e.preventDefault()
        if (!loginUsername.trim()) {
            showToast('Please enter a username', 'error')
            return
        }

        setLoading(true)
        try {
            showToast('Starting login...', 'success')

            // Begin authentication
            const { options } = await authAPI.loginBegin(loginUsername)

            // Convert challenge from base64
            options.challenge = base64ToArrayBuffer(options.challenge)
            if (options.allowCredentials) {
                options.allowCredentials = options.allowCredentials.map(cred => ({
                    ...cred,
                    id: base64ToArrayBuffer(cred.id)
                }))
            }

            showToast('Please use your authenticator...', 'success')

            // Get credential
            const assertion = await navigator.credentials.get({
                publicKey: options
            })

            // Complete authentication
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
            }

            const result = await authAPI.loginComplete(assertionData)

            showToast('Login successful!', 'success')
            await login(result.token, {
                session_id: result.session_id,
                username: loginUsername
            })

        } catch (error) {
            console.error('Login error:', error)
            const detail = error.response?.data?.detail || error.message
            showToast(`Login failed: ${detail}`, 'error')
        } finally {
            setLoading(false)
        }
    }

    const handleDemoLogin = async () => {
        const username = loginUsername || registerUsername || 'demo_user'
        setLoading(true)
        try {
            showToast('Starting demo bypass...', 'success')
            const result = await authAPI.demoLogin(username)
            showToast('Demo access granted!', 'success')
            await login(result.token, {
                session_id: result.session_id,
                username: username
            })
        } catch (error) {
            console.error('Demo login error:', error)
            const detail = error.response?.data?.detail || error.message
            showToast(`Demo login failed: ${detail}`, 'error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-view">
            <div className="auth-card">
                <h2>Welcome</h2>
                <p className="subtitle">
                    Secure passwordless authentication with continuous behavioral monitoring
                </p>

                <div className="auth-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'login' ? 'active' : ''}`}
                        onClick={() => setActiveTab('login')}
                    >
                        Login
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'register' ? 'active' : ''}`}
                        onClick={() => setActiveTab('register')}
                    >
                        Register
                    </button>
                </div>

                {activeTab === 'login' ? (
                    <form onSubmit={handleLogin} className="tab-content">
                        <div className="form-group">
                            <label htmlFor="loginUsername">Username</label>
                            <input
                                type="text"
                                id="loginUsername"
                                value={loginUsername}
                                onChange={(e) => setLoginUsername(e.target.value)}
                                placeholder="Enter your username"
                                autoComplete="username"
                                disabled={loading}
                            />
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Logging in...' : 'LOGIN WITH WEBAUTHN'}
                        </button>
                        <button 
                            type="button" 
                            className="btn btn-secondary" 
                            style={{ marginTop: '1rem', border: '1px dashed var(--primary-color)', opacity: 0.8 }}
                            onClick={handleDemoLogin}
                            disabled={loading}
                        >
                            BYPASS FOR DEMO
                        </button>
                        <p className="help-text">Use security key or use bypass for development testing</p>
                    </form>
                ) : (
                    <form onSubmit={handleRegister} className="tab-content">
                        <div className="form-group">
                            <label htmlFor="registerUsername">Username</label>
                            <input
                                type="text"
                                id="registerUsername"
                                value={registerUsername}
                                onChange={(e) => setRegisterUsername(e.target.value)}
                                placeholder="Choose a username"
                                autoComplete="username"
                                disabled={loading}
                            />
                        </div>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            REGISTER
                            {loading ? 'Registering...' : 'Register with WebAuthn'}
                        </button>
                        <p className="help-text">Register your security key or biometric device</p>
                    </form>
                )}
            </div>
        </div>
    )
}

export default AuthView
