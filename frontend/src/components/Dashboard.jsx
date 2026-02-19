import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { trustAPI } from '../services/api'
import { useToast } from '../hooks/useToast'
import TrustScoreCard from './TrustScoreCard'
import SessionInfoCard from './SessionInfoCard'
import ActivityCard from './ActivityCard'
import AlertsCard from './AlertsCard'
import StepUpModal from './StepUpModal'
import { useBehavioralCapture } from '../hooks/useBehavioralCapture'
import './Dashboard.css'

function Dashboard() {
    const { token, sessionId, username, logout } = useAuth()
    const { showToast } = useToast()
    const [trustScore, setTrustScore] = useState(100)
    const [trustStatus, setTrustStatus] = useState('OK')
    const [showStepUp, setShowStepUp] = useState(false)
    const [sessionInfo, setSessionInfo] = useState(null)
    const [alerts, setAlerts] = useState([])

    const { stats, updateTrustScore } = useBehavioralCapture(token, sessionId)

    useEffect(() => {
        loadSessionInfo()
        const interval = setInterval(refreshTrustScore, 10000) // Every 10 seconds
        return () => clearInterval(interval)
    }, [])

    const loadSessionInfo = async () => {
        try {
            const response = await fetch(`http://localhost:8000/auth/session`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (response.ok) {
                const data = await response.json()
                setSessionInfo(data)
                setTrustScore(data.trust_score)
                setTrustStatus(data.status)
            }
        } catch (error) {
            console.error('Error loading session info:', error)
        }
    }

    const refreshTrustScore = async () => {
        try {
            const data = await trustAPI.getTrustScore(token, sessionId)
            setTrustScore(data.trust_score)
            setTrustStatus(data.status)

            if (data.require_stepup) {
                setShowStepUp(true)
                addAlert('Step-up authentication required', 'warning')
            }
        } catch (error) {
            console.error('Error refreshing trust score:', error)
        }
    }

    const handleStepUp = async () => {
        try {
            await trustAPI.handleStepUp(token, sessionId, {})
            setTrustScore(100)
            setTrustStatus('OK')
            setShowStepUp(false)
            showToast('Step-up authentication successful!', 'success')
        } catch (error) {
            showToast(`Step-up failed: ${error.message}`, 'error')
        }
    }

    const addAlert = (message, type) => {
        const newAlert = {
            id: Date.now(),
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        }
        setAlerts(prev => [newAlert, ...prev].slice(0, 10))
    }

    // Update trust score from behavioral capture
    useEffect(() => {
        if (updateTrustScore.score !== null) {
            setTrustScore(updateTrustScore.score)
            setTrustStatus(updateTrustScore.status)

            if (updateTrustScore.status === 'SUSPICIOUS') {
                addAlert('Suspicious behavior detected', 'warning')
            } else if (updateTrustScore.status === 'CRITICAL') {
                addAlert('Critical trust level', 'danger')
            }
        }
    }, [updateTrustScore])

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
                    onAuth={handleStepUp}
                    onCancel={() => setShowStepUp(false)}
                />
            )}
        </div>
    )
}

export default Dashboard
