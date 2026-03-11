import './ActivityCard.css'

function ActivityCard({ stats }) {
    return (
        <div className="card activity-card">
            <div className="card-header">
                <h3>Behavioral Activity</h3>
                {stats.isBackend && (
                    <span className="all-tabs-badge" title="Counts include all browser tabs monitored by the extension">
                        🌐 All Tabs
                    </span>
                )}
            </div>
            <div className="activity-stats">
                <div className="stat-item">
                    <div className="stat-icon">KB</div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.keystrokeCount.toLocaleString()}</div>
                        <div className="stat-label">Keystrokes</div>
                    </div>
                </div>
                <div className="stat-item">
                    <div className="stat-icon">MS</div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.mouseCount.toLocaleString()}</div>
                        <div className="stat-label">Mouse Events</div>
                    </div>
                </div>
                <div className="stat-item">
                    <div className="stat-icon">BT</div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.batchesSent}</div>
                        <div className="stat-label">Batches Sent</div>
                    </div>
                </div>
                {stats.totalEvents !== null && (
                    <div className="stat-item stat-total">
                        <div className="stat-icon">∑</div>
                        <div className="stat-content">
                            <div className="stat-value">{stats.totalEvents.toLocaleString()}</div>
                            <div className="stat-label">Total Events</div>
                        </div>
                    </div>
                )}
            </div>
            {stats.isBackend && (
                <div className="all-tabs-note">
                    Counts reflect activity across all monitored browser tabs
                </div>
            )}
        </div>
    )
}

export default ActivityCard
