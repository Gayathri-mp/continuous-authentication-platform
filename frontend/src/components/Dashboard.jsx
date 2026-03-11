import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { trustAPI, authAPI, eventsAPI } from '../services/api'
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

    const { stats, updateTrustScore, isIdle, pauseCapture, resumeCapture } = useBehavioralCapture(token, sessionId)

    // Backend event totals — updated every 5 s, reflects ALL tabs (incl. extension)
    const [backendStats, setBackendStats] = useState(null)
    const backendPollRef = useRef(null)

    const fetchBackendStats = useCallback(async () => {
        if (!token || !sessionId) return
        try {
            const data = await eventsAPI.getSessionEvents(token, sessionId, 1000)
            setBackendStats({
                keystrokeCount: data.keystroke_events ?? 0,
                mouseCount:     data.mouse_events ?? 0,
                totalEvents:    data.total_events ?? 0,
            })
        } catch (_) { /* supplementary — silently ignore */ }
    }, [token, sessionId])

    // Merged stats: use backend totals for keyboard/mouse (cross-tab),
    // keep local batchesSent (only meaningful per-tab anyway)
    const mergedStats = {
        keystrokeCount: backendStats?.keystrokeCount ?? stats.keystrokeCount,
        mouseCount:     backendStats?.mouseCount     ?? stats.mouseCount,
        batchesSent:    stats.batchesSent,
        totalEvents:    backendStats?.totalEvents    ?? null,
        isBackend:      backendStats !== null,
    }

    // -----------------------------------------------------------------------
    // Derived state
    // -----------------------------------------------------------------------
    const isMonitoring = trustStatus === 'MONITOR'

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
        addAlert('Session terminated by security policy', 'danger')
        showToast('Session terminated — logging out in 4 seconds', 'error')
        setTimeout(() => logout(), TERMINATE_DELAY_MS)
    }, [addAlert, showToast, logout])

    const applyPolicy = useCallback((action, requireStepup, score, status) => {
        if (score !== null && score !== undefined) setTrustScore(score)
        if (status) setTrustStatus(status)

        if (action === 'terminate') {
            handleTerminate()
        } else if (action === 'stepup' || requireStepup) {
            if (!showStepUp) {
                setShowStepUp(true)
                pauseCapture()  // pause event collection while step-up is pending
                addAlert('Suspicious behaviour detected — step-up authentication required', 'warning')
                showToast('Re-authentication required (30s timeout)', 'warning')
            }
        } else if (action === 'monitor') {
            addAlert(`Trust score in monitoring range (${Math.round(score)})`, 'info')
        }
    }, [showStepUp, handleTerminate, pauseCapture, addAlert, showToast])

    // -----------------------------------------------------------------------
    // Session load + alert fetch
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
            const mapped = data.map(a => ({
                id: a.id,
                message: a.message,
                type: a.severity,
                timestamp: new Date(a.created_at).toLocaleTimeString()
            }))
            setAlerts(mapped)
        } catch (_) { /* supplementary — silently ignore */ }
    }, [token, sessionId])

    useEffect(() => {
        loadSessionInfo()
        fetchAlerts()
        fetchBackendStats()
        const trustInterval = setInterval(refreshTrustScore, POLL_INTERVAL_MS)
        // Poll backend event counts every 5 s (so the dashboard reflects all tabs)
        backendPollRef.current = setInterval(fetchBackendStats, 5000)
        return () => {
            clearInterval(trustInterval)
            clearInterval(backendPollRef.current)
        }
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
    // React to behavioral capture batch results
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (updateTrustScore.score === null) return
        const { score, status, action, requireStepup } = updateTrustScore
        applyPolicy(action, requireStepup, score, status)
        fetchAlerts()
    }, [updateTrustScore]) // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Step-up completed
    // -----------------------------------------------------------------------
    const handleStepUpSuccess = () => {
        setTrustScore(100)
        setTrustStatus('OK')
        setShowStepUp(false)
        resumeCapture()   // restart behavioral capture
        addAlert('Step-up authentication successful', 'info')
        showToast('Re-authentication successful!', 'success')
        fetchAlerts()
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <div className="dashboard">
            {/* MONITOR warning banner */}
            {isMonitoring && !showStepUp && (
                <div className="monitor-banner" role="alert">
                    Anomalous behaviour detected — monitoring session (trust score: {Math.round(trustScore)})
                    {isIdle && <span className="idle-badge"> · Idle</span>}
                </div>
            )}
            {/* Idle-only indicator (only show when not in MONITOR/STEPUP) */}
            {isIdle && !isMonitoring && !showStepUp && (
                <div className="idle-banner" role="status">
                    Session idle — behavioral capture paused until you interact
                </div>
            )}

            {/* Main grid — pointer-events disabled while step-up is pending */}
            <div className={`dashboard-grid ${showStepUp ? 'dashboard-locked' : ''}`}>
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
                <ActivityCard stats={mergedStats} />
                <AlertsCard alerts={alerts} />
            </div>

            {showStepUp && (
                <StepUpModal
                    trustScore={trustScore}
                    token={token}
                    sessionId={sessionId}
                    onSuccess={handleStepUpSuccess}
                    onCancel={logout}
                />
            )}
        </div>
    )
}

export default Dashboard
