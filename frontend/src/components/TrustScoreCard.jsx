import { useEffect, useRef } from 'react'
import './TrustScoreCard.css'

const STATUS_CONFIG = {
    OK:          { label: '✅ All systems normal',              color: '#10b981', ring: 'success' },
    MONITOR:     { label: '⚠️ Monitoring — anomaly detected',   color: '#f59e0b', ring: 'warning' },
    SUSPICIOUS:  { label: '🚨 Suspicious — re-auth required',   color: '#ef4444', ring: 'danger'  },
    CRITICAL:    { label: '🔴 Critical — session at risk',       color: '#ef4444', ring: 'danger'  },
    TERMINATED:  { label: '⛔ Session terminated',               color: '#7f1d1d', ring: 'danger'  },
    EXPIRED:     { label: '⏱️ Session expired',                 color: '#64748b', ring: ''        },
}

const scoreClass = (s) => s < 20 ? 'danger' : s < 40 ? 'danger' : s < 70 ? 'warning' : 'success'

function TrustScoreCard({ score, status, onRefresh }) {
    const prevScore = useRef(score)
    const circleRef = useRef(null)

    const cfg = STATUS_CONFIG[status] ?? { label: '— Unknown', color: '#94a3b8', ring: '' }

    // Flash the circle when the score drops by ≥ 10 points
    useEffect(() => {
        const dropped = prevScore.current - score
        if (dropped >= 10 && circleRef.current) {
            circleRef.current.classList.remove('flash')
            // Force reflow so the animation restarts
            void circleRef.current.offsetWidth
            circleRef.current.classList.add('flash')
        }
        prevScore.current = score
    }, [score])

    const rounded = Math.round(score)

    return (
        <div className="card trust-card">
            <div className="card-header">
                <h3>Trust Score</h3>
                <button className="btn-icon-only" onClick={onRefresh} title="Refresh trust score">
                    🔄
                </button>
            </div>

            <div className="trust-score-display">
                {/* Animated score circle */}
                <div
                    ref={circleRef}
                    className={`trust-score-circle ${scoreClass(score)}`}
                    style={{ '--trust-color': cfg.color }}
                >
                    <div className="trust-score-value">{rounded}</div>
                    <div className="trust-score-label">/ 100</div>
                </div>

                {/* Trust bar */}
                <div className="trust-bar-wrapper">
                    <div
                        className={`trust-bar ${scoreClass(score)}`}
                        style={{ width: `${Math.max(2, rounded)}%` }}
                    />
                </div>

                {/* Status text */}
                <div className="trust-status">
                    <div
                        className={`status-dot ${cfg.ring}`}
                        style={{ background: cfg.color }}
                    />
                    <span className="status-text">{cfg.label}</span>
                </div>
            </div>
        </div>
    )
}

export default TrustScoreCard
