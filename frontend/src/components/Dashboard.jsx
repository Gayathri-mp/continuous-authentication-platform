import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { trustAPI, authAPI, eventsAPI } from '../services/api'
import api from '../services/api'
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
            timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
                timestamp: (() => {
                    const utcStr = /[Z+\-]\d{2}:?\d{2}$|Z$/.test(a.created_at)
                        ? a.created_at
                        : a.created_at + 'Z'
                    return new Date(utcStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                })()
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
    // Demo: Simulate Attack
    // -----------------------------------------------------------------------
    const [attackStatus, setAttackStatus] = useState(null)  // null | 'running' | 'done'
    const [attackWave,   setAttackWave]   = useState(0)     // 1-4 (3 waves + final terminate)

    const simulateAttack = useCallback(async () => {
        if (attackStatus === 'running') return
        setAttackStatus('running')
        setAttackWave(0)
        addAlert('⚠️ Demo: Simulated attack initiated', 'warning')

        try {
            // Waves 1-3: call /demo/simulate-attack — runs the real ML pipeline
            // Each call injects robot-like events and re-scores, driving the
            // trust score progressively lower.
            const waveLabels = [
                'Wave 1 — Mild anomaly',
                'Wave 2 — Moderate attack',
                'Wave 3 — Severe bot burst',
            ]
            for (let i = 0; i < 3; i++) {
                setAttackWave(i + 1)
                addAlert(`🔴 ${waveLabels[i]}`, 'danger')
                const result = await api.post('/demo/simulate-attack', {}, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                const data = result.data
                // Update the UI score live so the examiner can see it dropping
                if (data.trust_score !== undefined) {
                    setTrustScore(data.trust_score)
                    if (data.status) setTrustStatus(data.status)
                    addAlert(`Trust score → ${data.trust_score.toFixed(1)} | Action: ${data.action}`, 'warning')
                }
                if (data.action === 'terminate') {
                    // ML pipeline already terminated — tell extension to force logout all tabs
                    try {
                        window.postMessage({ type: 'YC_FORCE_LOGOUT_REQUEST' }, '*')
                    } catch (_) {}
                    setAttackWave(4)
                    setAttackStatus('done')
                    showToast('Session terminated by trust engine!', 'error')
                    fetchAlerts()
                    setTimeout(() => {
                        setAttackStatus(null)
                        setAttackWave(0)
                    }, 8000)
                    return
                }
                await new Promise(r => setTimeout(r, 1500))
            }

            // Wave 4 (guarantee): call /demo/force-terminate — directly sets
            // trust score to 5 and revokes the session, no matter what the
            // ML scored. Ensures the overlay fires every time during the demo.
            setAttackWave(4)
            addAlert('🚨 Wave 4 — Force terminate (guaranteed)', 'danger')
            const termResult = await api.post('/demo/force-terminate', {}, {
                headers: { Authorization: `Bearer ${token}` },
            })
            const termData = termResult.data
            setTrustScore(termData.trust_score)
            setTrustStatus(termData.status)

            // ★ KEY FIX: Use window.postMessage (not chrome.runtime.sendMessage).
            // chrome.runtime.sendMessage from a web page silently fails unless
            // externally_connectable is configured. window.postMessage goes to the
            // content script (which has extension access), which forwards to background.
            try {
                window.postMessage({ type: 'YC_FORCE_LOGOUT_REQUEST' }, '*')
            } catch (_) {}

            applyPolicy(termData.action, termData.require_stepup, termData.trust_score, termData.status)

            setAttackStatus('done')
            showToast('Session terminated — logging out all tabs!', 'error')
            fetchAlerts()
            setTimeout(() => {
                setAttackStatus(null)
                setAttackWave(0)
            }, 8000)

        } catch (err) {
            console.error('Simulate attack error:', err)
            setAttackStatus(null)
        }
    }, [attackStatus, token, sessionId, addAlert, showToast, fetchAlerts, applyPolicy])

    const resetDemo = useCallback(async () => {
        try {
            await api.post('/demo/reset-trust', {}, {
                headers: { Authorization: `Bearer ${token}` },
            })
            setTrustScore(100)
            setTrustStatus('OK')
            setAttackStatus(null)
            setAttackWave(0)
            addAlert('✅ Demo reset — trust score restored to 100', 'info')
            showToast('Demo reset! Trust score restored.', 'success')
            fetchAlerts()
        } catch (err) {
            showToast('Reset failed — session may have been terminated. Please log in again.', 'error')
        }
    }, [token, addAlert, showToast, fetchAlerts])

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

            {/* ── Demo Attack Panel ───────────────────────────────────────── */}
            <div className="demo-attack-panel">
                <div className="demo-attack-header">
                    <span className="demo-badge">🧪 DEMO</span>
                    <h4>Attack Simulation</h4>
                    <span className="demo-desc">
                        Injects robot-like behavioural events to trigger anomaly detection
                    </span>
                </div>

                <div className="demo-attack-body">
                    <div className="demo-waves">
                        <div className={`demo-wave ${attackWave >= 1 ? 'active' : ''} ${attackStatus === 'done' ? 'done' : ''}`}>
                            <span className="wave-dot"></span>
                            <span>Wave 1: Mild anomaly</span>
                        </div>
                        <div className={`demo-wave ${attackWave >= 2 ? 'active' : ''} ${attackStatus === 'done' ? 'done' : ''}`}>
                            <span className="wave-dot"></span>
                            <span>Wave 2: Moderate attack</span>
                        </div>
                        <div className={`demo-wave ${attackWave >= 3 ? 'active' : ''} ${attackStatus === 'done' ? 'done' : ''}`}>
                            <span className="wave-dot"></span>
                            <span>Wave 3: Severe bot burst</span>
                        </div>
                        <div className={`demo-wave ${attackWave >= 4 ? 'active' : ''} ${attackStatus === 'done' ? 'done' : ''}`}>
                            <span className="wave-dot"></span>
                            <span>Wave 4: Force terminate</span>
                        </div>
                    </div>

                    <div className="demo-btn-group">
                        <button
                            className={`demo-attack-btn ${
                                attackStatus === 'running' ? 'btn-running' :
                                attackStatus === 'done'    ? 'btn-done'    : ''
                            }`}
                            onClick={simulateAttack}
                            disabled={attackStatus === 'running'}
                        >
                            {attackStatus === 'running'
                                ? `⏳ Wave ${attackWave} of 4…`
                                : attackStatus === 'done'
                                ? '✅ Terminated — overlay active on all tabs'
                                : '🔴 Launch Attack Simulation'
                            }
                        </button>
                        <button
                            className="demo-reset-btn"
                            onClick={resetDemo}
                            disabled={attackStatus === 'running'}
                            title="Reset trust score to 100 for another demo run"
                        >
                            ↺ Reset Demo
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Dashboard
