import './AlertsCard.css'

const SEVERITY_ICON = {
    danger: '🔴',
    warning: '🟡',
    info: '🔵',
}

const SEVERITY_LABEL = {
    danger: 'Critical',
    warning: 'Warning',
    info: 'Info',
}

function AlertsCard({ alerts }) {
    return (
        <div className="card alerts-card">
            <div className="card-header">
                <h3>Security Alerts</h3>
                {alerts.length > 0 && (
                    <span className="alert-count">{alerts.length}</span>
                )}
            </div>
            <div className="alerts-container">
                {alerts.length === 0 ? (
                    <div className="no-alerts">
                        <span className="no-alerts-icon">✅</span>
                        No security alerts
                    </div>
                ) : (
                    alerts.map(alert => (
                        <div key={alert.id} className={`alert-item alert-${alert.type}`}>
                            <span className="alert-icon" aria-label={SEVERITY_LABEL[alert.type] ?? alert.type}>
                                {SEVERITY_ICON[alert.type] ?? '⚪'}
                            </span>
                            <div className="alert-body">
                                <span className="alert-message">{alert.message}</span>
                                <span className="alert-time">{alert.timestamp}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default AlertsCard
