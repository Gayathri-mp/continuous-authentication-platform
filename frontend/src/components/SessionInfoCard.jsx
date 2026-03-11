import './SessionInfoCard.css'

function SessionInfoCard({ username, sessionId, sessionInfo, onLogout }) {
    // Backend sends UTC timestamps (sometimes without 'Z' suffix).
    // Append 'Z' if no timezone offset is present so JS parses it as UTC,
    // then toLocaleString() converts to the user's local system timezone.
    const formatDate = (dateString) => {
        if (!dateString) return '-'
        const utcStr = /[Z+\-]\d{2}:?\d{2}$|Z$/.test(dateString)
            ? dateString
            : dateString + 'Z'
        return new Date(utcStr).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        })
    }

    return (
        <div className="card">
            <div className="card-header">
                <h3>Session Information</h3>
            </div>
            <div className="session-info">
                <div className="info-row">
                    <span className="info-label">Username:</span>
                    <span className="info-value">{username || '-'}</span>
                </div>
                <div className="info-row">
                    <span className="info-label">Session ID:</span>
                    <span className="info-value mono">
                        {sessionId ? `${sessionId.substring(0, 16)}...` : '-'}
                    </span>
                </div>
                <div className="info-row">
                    <span className="info-label">Started:</span>
                    <span className="info-value">
                        {formatDate(sessionInfo?.created_at)}
                    </span>
                </div>
                <div className="info-row">
                    <span className="info-label">Expires:</span>
                    <span className="info-value">
                        {formatDate(sessionInfo?.expires_at)}
                    </span>
                </div>
            </div>
            <button className="btn btn-secondary" onClick={onLogout}>
                Logout
            </button>
        </div>
    )
}

export default SessionInfoCard
