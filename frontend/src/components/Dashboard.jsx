import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { trustAPI, authAPI } from '../services/api'
import { useToast } from '../hooks/useToast'
import TrustScoreCard from './TrustScoreCard'
import SessionInfoCard from './SessionInfoCard'
import ActivityCard from './ActivityCard'
import AlertsCard from './AlertsCard'
import StepUpModal from './StepUpModal'
import { useBehavioralCapture } from '../hooks/useBehavioralCapture'
import './Dashboard.css'

const POLL_INTERVAL_MS = 10_000   // poll trust score every 10 s
const TERMINATE_DELAY_MS = 4_000  // delay before auto-logout on termination

function Dashboard() {
    const { token, sessionId, username, logout } = useAuth()
    const { showToast } = useToast()

    const [trustScore, setTrustScore] = useState(100)
    const [trustStatus, setTrustStatus] = useState('OK')
    const [showStepUp, setShowStepUp] = useState(false)
    const [sessionInfo, setSessionInfo] = useState(null)
    const [alerts, setAlerts] = useState([])

    const { stats, updateTrustScore } = useBehavioralCapture(token, sessionId)

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    const addAlert = useCallback((message, type) => {
        setAlerts(prev => [{
            id: Date.now(),
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        }, ...prev].slice(0, 20))
    }, [])

    const handleTerminate = useCallback(() => {
        addAlert('⛔ Session terminated by security policy', 'danger')
        showToast('Session terminated — logging out in 4 seconds', 'error')
        setTimeout(() => logout(), TERMINATE_DELAY_MS)
    }, [addAlert, showToast, logout])

    const applyPolicy = useCallback((action, requireStepup, score, status) => {
        setTrustScore(score ?? trustScore)
        setTrustStatus(status ?? trustStatus)

        if (action === 'terminate') {
            handleTerminate()
        } else if (action === 'stepup' || requireStepup) {
            if (!showStepUp) {
                setShowStepUp(true)
                addAlert('⚠️ Suspicious behaviour — step-up authentication required', 'warning')
                showToast('Re-authentication required', 'warning')
            }
        } else if (action === 'monitor') {
            addAlert(`📊 Trust score in monitoring range (${Math.round(score)})`, 'info')
        }
    }, [trustScore, trustStatus, showStepUp, handleTerminate, addAlert, showToast])

    // -----------------------------------------------------------------------
    // Load session + fetch real alerts from backend on mount
    // -----------------------------------------------------------------------
    const loadSessionInfo = useCallback(async () => {
        try {
            const data = await authAPI.getSession(token)
            setSessionInfo(data)
            setTrustScore(data.trust_score)
            setTrustStatus(data.status)
        } catch (error) {
            console.error('Error loading session info:', error)
        }
    }, [token])

    const fetchAlerts = useCallback(async () => {
        try {
            const data = await trustAPI.getAlerts(token, sessionId)
            // Map backend alerts to local format
            const mapped = data.map(a => ({
                id: a.id,
                message: a.message,
                type: a.severity,
                timestamp: new Date(a.created_at).toLocaleTimeString()
            }))
            setAlerts(mapped)
        } catch (_) {
            // Silently ignore — alerts are supplementary
        }
    }, [token, sessionId])

    useEffect(() => {
        loadSessionInfo()
        fetchAlerts()
        const interval = setInterval(refreshTrustScore, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Periodic trust score poll
    // -----------------------------------------------------------------------
    const refreshTrustScore = async () => {
        try {
            const data = await trustAPI.getTrustScore(token, sessionId)
            applyPolicy(data.action, data.require_stepup, data.trust_score, data.status)
        } catch (error) {
            console.error('Error refreshing trust score:', error)
        }
    }

    // -----------------------------------------------------------------------
    // Real-time updates from behavioral capture batches
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (updateTrustScore.score === null) return

        const { score, status, action, requireStepup } = updateTrustScore
        applyPolicy(action, requireStepup, score, status)

        // Refresh alert list from backend after each batch
        fetchAlerts()
    }, [updateTrustScore]) // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Step-up completed
    // -----------------------------------------------------------------------
    const handleStepUpSuccess = () => {
        setTrustScore(100)
        setTrustStatus('OK')
        setShowStepUp(false)
        addAlert('✅ Step-up authentication successful', 'info')
        showToast('Re-authentication successful!', 'success')
        fetchAlerts()
    }

    return (
        <div className="dashboard">
            <div className="dashboard-grid">
                <TrustScoreCard
                    score={trustScore}
                    status={trustStatus}
                    onRefresh={refreshTrustScore}
                />
                <SessionInfoCard
                    username={username}
                    sessionId={sessionId}
                    sessionInfo={sessionInfo}
                    onLogout={logout}
                />
                <ActivityCard stats={stats} />
                <AlertsCard alerts={alerts} />
            </div>

            {showStepUp && (
                <StepUpModal
                    trustScore={trustScore}
                    token={token}
                    sessionId={sessionId}
                    onSuccess={handleStepUpSuccess}
                    onCancel={logout}   // cancel = forced logout (no trust = no access)
                />
            )}
        </div>
    )
}

export default Dashboard
