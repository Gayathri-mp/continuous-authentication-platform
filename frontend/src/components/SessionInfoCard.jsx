import './SessionInfoCard.css'

function SessionInfoCard({ username, sessionId, sessionInfo, onLogout }) {
    const formatDate = (dateString) => {
        if (!dateString) return '-'
        return new Date(dateString).toLocaleString()
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
