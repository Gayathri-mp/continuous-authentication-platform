import { useState } from 'react'
import { trustAPI, base64ToArrayBuffer, arrayBufferToBase64, serializeCredential } from '../services/api'
import './StepUpModal.css'

function StepUpModal({ trustScore, token, sessionId, onSuccess, onCancel }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const handleAuth = async () => {
        setLoading(true)
        setError(null)

        try {
            // Phase 1: Get WebAuthn challenge from backend
            const beginData = await trustAPI.stepupBegin(token)
            const options = beginData.options

            // Convert base64url challenge to ArrayBuffer for WebAuthn API
            const publicKeyOptions = {
                ...options,
                challenge: base64ToArrayBuffer(options.challenge),
                allowCredentials: (options.allowCredentials || []).map(cred => ({
                    ...cred,
                    id: base64ToArrayBuffer(cred.id)
                }))
            }

            // Phase 2: Prompt user for authenticator
            const credential = await navigator.credentials.get({
                publicKey: publicKeyOptions
            })

            if (!credential) {
                throw new Error('No credential returned by authenticator')
            }

            // Serialize for JSON transport
            const serialized = serializeCredential(credential)

            // Phase 3: Verify with backend
            await trustAPI.stepupComplete(token, sessionId, serialized)

            onSuccess()

        } catch (err) {
            if (err.name === 'NotAllowedError') {
                setError('Authentication was cancelled or timed out.')
            } else if (err.name === 'SecurityError') {
                setError('Security error — ensure you are on the correct origin.')
            } else {
                setError(err.message || 'Step-up authentication failed.')
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="modal active">
            <div className="modal-content">
                <div className="modal-header">
                    <h3>⚠️ Re-authentication Required</h3>
                </div>

                <div className="modal-body">
                    <p>
                        Your trust score has dropped to <strong>{Math.round(trustScore)}</strong>.
                        Please verify your identity with your security key or biometrics to continue.
                    </p>

                    {error && (
                        <div className="modal-error" role="alert">
                            ❌ {error}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        className="btn btn-primary"
                        onClick={handleAuth}
                        disabled={loading}
                    >
                        {loading ? '🔐 Waiting for authenticator…' : '🔐 Authenticate Now'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={onCancel}
                        disabled={loading}
                    >
                        Logout Instead
                    </button>
                </div>
            </div>
        </div>
    )
}

export default StepUpModal
