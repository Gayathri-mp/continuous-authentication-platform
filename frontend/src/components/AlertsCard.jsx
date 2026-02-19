import './AlertsCard.css'

function AlertsCard({ alerts }) {
    return (
        <div className="card alerts-card">
            <div className="card-header">
                <h3>Security Alerts</h3>
            </div>
            <div className="alerts-container">
                {alerts.length === 0 ? (
                    <div className="no-alerts">No security alerts</div>
                ) : (
                    alerts.map(alert => (
                        <div key={alert.id} className={`alert ${alert.type}`}>
                            {alert.timestamp}: {alert.message}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default AlertsCard
