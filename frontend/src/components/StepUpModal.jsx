import './StepUpModal.css'

function StepUpModal({ trustScore, onAuth, onCancel }) {
    return (
        <div className="modal active">
            <div className="modal-content">
                <div className="modal-header">
                    <h3>⚠️ Step-up Authentication Required</h3>
                </div>
                <div className="modal-body">
                    <p>
                        Your trust score has dropped below the threshold. Please re-authenticate to continue.
                    </p>
                    <div className="trust-score-mini">
                        Trust Score: {Math.round(trustScore)}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-primary" onClick={onAuth}>
                        Authenticate
                    </button>
                    <button className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    )
}

export default StepUpModal
