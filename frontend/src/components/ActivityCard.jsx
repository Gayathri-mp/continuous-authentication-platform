import './ActivityCard.css'

function ActivityCard({ stats }) {
    return (
        <div className="card activity-card">
            <div className="card-header">
                <h3>Behavioral Activity</h3>
            </div>
            <div className="activity-stats">
                <div className="stat-item">
                    <div className="stat-icon">⌨️</div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.keystrokeCount}</div>
                        <div className="stat-label">Keystrokes</div>
                    </div>
                </div>
                <div className="stat-item">
                    <div className="stat-icon">🖱️</div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.mouseCount}</div>
                        <div className="stat-label">Mouse Events</div>
                    </div>
                </div>
                <div className="stat-item">
                    <div className="stat-icon">📊</div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.batchesSent}</div>
                        <div className="stat-label">Batches Sent</div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ActivityCard
