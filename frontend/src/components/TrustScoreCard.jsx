import './TrustScoreCard.css'

function TrustScoreCard({ score, status, onRefresh }) {
    const getScoreClass = () => {
        if (score < 40) return 'danger'
        if (score < 70) return 'warning'
        return 'success'
    }

    const getStatusText = () => {
        switch (status) {
            case 'OK': return 'All systems normal'
            case 'MONITOR': return 'Monitoring for anomalies'
            case 'SUSPICIOUS': return 'Suspicious activity detected'
            case 'CRITICAL': return 'Critical - Session at risk'
            default: return 'Unknown status'
        }
    }

    const getStatusColor = () => {
        switch (status) {
            case 'OK': return '#10b981'
            case 'MONITOR': return '#f59e0b'
            case 'SUSPICIOUS': return '#ef4444'
            case 'CRITICAL': return '#ef4444'
            default: return '#94a3b8'
        }
    }

    return (
        <div className="card trust-card">
            <div className="card-header">
                <h3>Trust Score</h3>
                <button className="btn-icon-only" onClick={onRefresh} title="Refresh">
                    🔄
                </button>
            </div>
            <div className="trust-score-display">
                <div className={`trust-score-circle ${getScoreClass()}`}>
                    <div className="trust-score-value">{Math.round(score)}</div>
                    <div className="trust-score-label">Trust Level</div>
                </div>
                <div className="trust-status">
                    <div
                        className="status-indicator"
                        style={{ background: getStatusColor() }}
                    />
                    <span>{getStatusText()}</span>
                </div>
            </div>
        </div>
    )
}

export default TrustScoreCard
