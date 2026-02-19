import { useState, useEffect, useRef } from 'react'
import { eventsAPI } from '../services/api'

const BATCH_INTERVAL = 5000 // 5 seconds
const MOUSE_THROTTLE = 100 // ms

export const useBehavioralCapture = (token, sessionId) => {
    const [stats, setStats] = useState({
        keystrokeCount: 0,
        mouseCount: 0,
        batchesSent: 0
    })
    const [updateTrustScore, setUpdateTrustScore] = useState({ score: null, status: null })

    const eventBuffer = useRef([])
    const lastMouseMove = useRef(0)
    const isCapturing = useRef(false)

    useEffect(() => {
        if (!token || !sessionId) return

        startCapture()
        return () => stopCapture()
    }, [token, sessionId])

    const startCapture = () => {
        if (isCapturing.current) return
        isCapturing.current = true

        // Add event listeners
        document.addEventListener('keydown', handleKeyDown)
        document.addEventListener('keyup', handleKeyUp)
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('click', handleMouseClick)

        // Start batch interval
        const interval = setInterval(sendEventBatch, BATCH_INTERVAL)

        return () => {
            clearInterval(interval)
            stopCapture()
        }
    }

    const stopCapture = () => {
        if (!isCapturing.current) return
        isCapturing.current = false

        document.removeEventListener('keydown', handleKeyDown)
        document.removeEventListener('keyup', handleKeyUp)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('click', handleMouseClick)

        if (eventBuffer.current.length > 0) {
            sendEventBatch()
        }
    }

    const handleKeyDown = (event) => {
        if (!isCapturing.current) return
        if (event.target.type === 'password') return

        eventBuffer.current.push({
            type: 'keystroke',
            key: event.key.length === 1 ? event.key : event.code,
            action: 'down',
            timestamp: Date.now() / 1000
        })

        setStats(prev => ({ ...prev, keystrokeCount: prev.keystrokeCount + 1 }))
    }

    const handleKeyUp = (event) => {
        if (!isCapturing.current) return
        if (event.target.type === 'password') return

        eventBuffer.current.push({
            type: 'keystroke',
            key: event.key.length === 1 ? event.key : event.code,
            action: 'up',
            timestamp: Date.now() / 1000
        })
    }

    const handleMouseMove = (event) => {
        if (!isCapturing.current) return

        const now = Date.now()
        if (now - lastMouseMove.current < MOUSE_THROTTLE) return
        lastMouseMove.current = now

        eventBuffer.current.push({
            type: 'mouse',
            x: event.clientX,
            y: event.clientY,
            action: 'move',
            timestamp: now / 1000
        })

        setStats(prev => ({ ...prev, mouseCount: prev.mouseCount + 1 }))
    }

    const handleMouseClick = (event) => {
        if (!isCapturing.current) return

        eventBuffer.current.push({
            type: 'mouse',
            x: event.clientX,
            y: event.clientY,
            action: 'click',
            timestamp: Date.now() / 1000
        })

        setStats(prev => ({ ...prev, mouseCount: prev.mouseCount + 1 }))
    }

    const sendEventBatch = async () => {
        if (eventBuffer.current.length === 0) return
        if (!token || !sessionId) return

        const batch = [...eventBuffer.current]
        eventBuffer.current = []

        try {
            const result = await eventsAPI.submitBatch(token, sessionId, batch)

            setStats(prev => ({ ...prev, batchesSent: prev.batchesSent + 1 }))

            if (result.trust_score !== undefined) {
                setUpdateTrustScore({ score: result.trust_score, status: result.status })
            }

            console.log(`Batch sent: ${result.events_processed} events, trust score: ${result.trust_score}`)
        } catch (error) {
            console.error('Error sending event batch:', error)
        }
    }

    return { stats, updateTrustScore }
}
