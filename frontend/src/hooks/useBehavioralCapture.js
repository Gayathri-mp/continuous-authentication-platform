import { useState, useEffect, useRef, useCallback } from 'react'
import { eventsAPI } from '../services/api'

const BATCH_INTERVAL = 5000 // 5 seconds
const MOUSE_THROTTLE = 100  // ms

/**
 * Captures behavioral events and sends them in batches to the backend.
 *
 * Exposes:
 *   - stats           : keystroke/mouse/batch counters
 *   - updateTrustScore: latest policy result from the last batch response
 *   - pauseCapture()  : stop collecting events (called during step-up)
 *   - resumeCapture() : restart collection (called after successful step-up)
 */
export const useBehavioralCapture = (token, sessionId) => {
    const [stats, setStats] = useState({
        keystrokeCount: 0,
        mouseCount: 0,
        batchesSent: 0
    })
    // Full policy state forwarded from each batch response
    const [updateTrustScore, setUpdateTrustScore] = useState({
        score: null,
        status: null,
        action: null,
        requireStepup: null
    })

    const eventBuffer = useRef([])
    const lastMouseMove = useRef(0)
    const isCapturing = useRef(false)
    const isPaused = useRef(false)           // true while step-up modal is open
    const batchIntervalRef = useRef(null)

    // -----------------------------------------------------------------------
    // Event handlers (stable refs — not recreated on every render)
    // -----------------------------------------------------------------------
    const handleKeyDown = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return
        if (event.target.type === 'password') return

        eventBuffer.current.push({
            type: 'keystroke',
            key: event.key.length === 1 ? event.key : event.code,
            action: 'down',
            timestamp: Date.now() / 1000
        })
        setStats(prev => ({ ...prev, keystrokeCount: prev.keystrokeCount + 1 }))
    }, [])

    const handleKeyUp = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return
        if (event.target.type === 'password') return

        eventBuffer.current.push({
            type: 'keystroke',
            key: event.key.length === 1 ? event.key : event.code,
            action: 'up',
            timestamp: Date.now() / 1000
        })
    }, [])

    const handleMouseMove = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return

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
    }, [])

    const handleMouseClick = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return

        eventBuffer.current.push({
            type: 'mouse',
            x: event.clientX,
            y: event.clientY,
            action: 'click',
            timestamp: Date.now() / 1000
        })
        setStats(prev => ({ ...prev, mouseCount: prev.mouseCount + 1 }))
    }, [])

    // -----------------------------------------------------------------------
    // Batch sender
    // -----------------------------------------------------------------------
    const sendEventBatch = useCallback(async () => {
        if (eventBuffer.current.length === 0) return
        if (!token || !sessionId) return
        if (isPaused.current) return          // don't send while paused

        const batch = [...eventBuffer.current]
        eventBuffer.current = []

        try {
            const result = await eventsAPI.submitBatch(token, sessionId, batch)

            setStats(prev => ({ ...prev, batchesSent: prev.batchesSent + 1 }))

            if (result.trust_score !== undefined) {
                setUpdateTrustScore({
                    score: result.trust_score,
                    status: result.status ?? null,
                    action: result.action ?? null,
                    requireStepup: result.require_stepup ?? null
                })
            }

            console.debug(
                `[Capture] Batch: ${result.events_processed} events | score: ${result.trust_score} | action: ${result.action}`
            )
        } catch (error) {
            console.error('[Capture] Error sending event batch:', error)
        }
    }, [token, sessionId])

    // -----------------------------------------------------------------------
    // Start / stop capture lifecycle
    // -----------------------------------------------------------------------
    const startCapture = useCallback(() => {
        if (isCapturing.current) return
        isCapturing.current = true
        isPaused.current = false

        document.addEventListener('keydown', handleKeyDown)
        document.addEventListener('keyup', handleKeyUp)
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('click', handleMouseClick)

        batchIntervalRef.current = setInterval(sendEventBatch, BATCH_INTERVAL)
    }, [handleKeyDown, handleKeyUp, handleMouseMove, handleMouseClick, sendEventBatch])

    const stopCapture = useCallback(() => {
        if (!isCapturing.current) return
        isCapturing.current = false

        clearInterval(batchIntervalRef.current)
        document.removeEventListener('keydown', handleKeyDown)
        document.removeEventListener('keyup', handleKeyUp)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('click', handleMouseClick)

        // Flush remaining events
        if (eventBuffer.current.length > 0) sendEventBatch()
    }, [handleKeyDown, handleKeyUp, handleMouseMove, handleMouseClick, sendEventBatch])

    // -----------------------------------------------------------------------
    // Public pause / resume (called by Dashboard when step-up modal shows)
    // -----------------------------------------------------------------------
    const pauseCapture = useCallback(() => {
        isPaused.current = true
        eventBuffer.current = []  // discard buffered events during suspension
        console.info('[Capture] Paused (step-up required)')
    }, [])

    const resumeCapture = useCallback(() => {
        isPaused.current = false
        console.info('[Capture] Resumed after step-up')
    }, [])

    // -----------------------------------------------------------------------
    // Mount / unmount
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!token || !sessionId) return
        startCapture()
        return () => stopCapture()
    }, [token, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    return { stats, updateTrustScore, pauseCapture, resumeCapture }
}
