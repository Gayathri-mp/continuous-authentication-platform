import { useState, useEffect, useRef, useCallback } from 'react'
import { eventsAPI } from '../services/api'

const BATCH_INTERVAL  = 5000  // ms — how often to flush events to backend
const MOUSE_THROTTLE  = 100   // ms — min time between mouse-move records
const IDLE_TIMEOUT_MS = 30_000 // 30 s without any activity = "idle"

/**
 * Captures behavioral events and sends them in batches to the backend.
 *
 * Robustness guarantees
 * ─────────────────────
 * 1. All listeners are on `document` (global — works regardless of focused element)
 * 2. Empty batches are never sent (early-return guard in sendEventBatch)
 * 3. Buffer is cleared on logout via stopCapture / pauseCapture
 * 4. Capture is paused while StepUpModal is open (pauseCapture / resumeCapture)
 * 5. Idle periods do NOT send empty batches, and do NOT trigger partial batches
 *    with suspiciously low event counts
 * 6. An `isIdle` flag is tracked and exposed so the UI can show an idle indicator
 *
 * Exposes:
 *   stats          – keystroke / mouse / batch counters
 *   updateTrustScore – latest policy result from last batch response
 *   isIdle         – true when user has been inactive for IDLE_TIMEOUT_MS
 *   pauseCapture() – called by Dashboard when StepUpModal opens
 *   resumeCapture()– called by Dashboard after successful step-up
 */
export const useBehavioralCapture = (token, sessionId) => {
    const [stats, setStats] = useState({
        keystrokeCount: 0,
        mouseCount: 0,
        batchesSent: 0,
    })

    // Full policy state forwarded from each batch response
    const [updateTrustScore, setUpdateTrustScore] = useState({
        score: null, status: null, action: null, requireStepup: null,
    })

    const [isIdle, setIsIdle] = useState(false)

    const eventBuffer   = useRef([])
    const lastMouseMove = useRef(0)
    const isCapturing   = useRef(false)
    const isPaused      = useRef(false)      // true while step-up modal is open
    const batchInterval = useRef(null)
    const idleTimer     = useRef(null)       // setTimeout handle for idle detection

    // -----------------------------------------------------------------------
    // Idle detection helpers
    // -----------------------------------------------------------------------
    const _resetIdleTimer = useCallback(() => {
        // Clear any existing idle timer
        if (idleTimer.current) clearTimeout(idleTimer.current)
        // If we were idle, mark as active again
        setIsIdle(prev => { if (prev) { console.info('[Capture] User active again') } return false })
        // Arm a new idle timer
        idleTimer.current = setTimeout(() => {
            setIsIdle(true)
            console.info('[Capture] User is idle (no activity for 30 s)')
        }, IDLE_TIMEOUT_MS)
    }, [])

    const _clearIdleTimer = useCallback(() => {
        if (idleTimer.current) {
            clearTimeout(idleTimer.current)
            idleTimer.current = null
        }
    }, [])

    // -----------------------------------------------------------------------
    // Event handlers — stable refs, all on document (global capture)
    // -----------------------------------------------------------------------
    const handleKeyDown = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return
        if (event.target.type === 'password') return

        _resetIdleTimer()
        eventBuffer.current.push({
            type: 'keystroke',
            key: event.key.length === 1 ? event.key : event.code,
            action: 'down',
            timestamp: Date.now() / 1000,
        })
        setStats(prev => ({ ...prev, keystrokeCount: prev.keystrokeCount + 1 }))
    }, [_resetIdleTimer])

    const handleKeyUp = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return
        if (event.target.type === 'password') return

        eventBuffer.current.push({
            type: 'keystroke',
            key: event.key.length === 1 ? event.key : event.code,
            action: 'up',
            timestamp: Date.now() / 1000,
        })
    }, [])

    const handleMouseMove = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return

        const now = Date.now()
        if (now - lastMouseMove.current < MOUSE_THROTTLE) return
        lastMouseMove.current = now

        _resetIdleTimer()
        eventBuffer.current.push({
            type: 'mouse', x: event.clientX, y: event.clientY,
            action: 'move', timestamp: now / 1000,
        })
        setStats(prev => ({ ...prev, mouseCount: prev.mouseCount + 1 }))
    }, [_resetIdleTimer])

    const handleMouseClick = useCallback((event) => {
        if (!isCapturing.current || isPaused.current) return

        _resetIdleTimer()
        eventBuffer.current.push({
            type: 'mouse', x: event.clientX, y: event.clientY,
            action: 'click', timestamp: Date.now() / 1000,
        })
        setStats(prev => ({ ...prev, mouseCount: prev.mouseCount + 1 }))
    }, [_resetIdleTimer])

    // -----------------------------------------------------------------------
    // Batch sender — NEVER sends empty batches
    // -----------------------------------------------------------------------
    const sendEventBatch = useCallback(async () => {
        // Guard 1: nothing to send
        if (eventBuffer.current.length === 0) return
        // Guard 2: paused (step-up) or no credentials
        if (isPaused.current || !token || !sessionId) return
        // Guard 3: user is idle — don't send near-empty "heartbeat" batches
        // (events already buffered before idle kicked in are still flushed
        //  on the NEXT non-idle interval after activity resumes)
        if (isIdle && eventBuffer.current.length < 3) {
            console.debug('[Capture] Skipping near-empty batch during idle')
            return
        }

        const batch = [...eventBuffer.current]
        eventBuffer.current = []   // clear buffer immediately (prevents double-send)

        try {
            const result = await eventsAPI.submitBatch(token, sessionId, batch)

            setStats(prev => ({ ...prev, batchesSent: prev.batchesSent + 1 }))

            if (result.trust_score !== undefined) {
                setUpdateTrustScore({
                    score:         result.trust_score,
                    status:        result.status        ?? null,
                    action:        result.action        ?? null,
                    requireStepup: result.require_stepup ?? null,
                })
            }

            console.debug(
                `[Capture] Batch: ${result.events_processed} events | ` +
                `score: ${result.trust_score} | action: ${result.action ?? 'N/A'}`
            )
        } catch (error) {
            console.error('[Capture] Error sending event batch:', error)
            // Put events back in the buffer so they're not lost entirely
            eventBuffer.current = [...batch, ...eventBuffer.current]
        }
    }, [token, sessionId, isIdle])

    // -----------------------------------------------------------------------
    // Start / stop lifecycle
    // -----------------------------------------------------------------------
    const startCapture = useCallback(() => {
        if (isCapturing.current) return
        isCapturing.current = true
        isPaused.current    = false

        document.addEventListener('keydown',   handleKeyDown)
        document.addEventListener('keyup',     handleKeyUp)
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('click',     handleMouseClick)

        batchInterval.current = setInterval(sendEventBatch, BATCH_INTERVAL)

        // Arm the first idle timer
        _resetIdleTimer()
    }, [handleKeyDown, handleKeyUp, handleMouseMove, handleMouseClick, sendEventBatch, _resetIdleTimer])

    const stopCapture = useCallback(() => {
        if (!isCapturing.current) return
        isCapturing.current = false

        clearInterval(batchInterval.current)
        _clearIdleTimer()
        setIsIdle(false)

        document.removeEventListener('keydown',   handleKeyDown)
        document.removeEventListener('keyup',     handleKeyUp)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('click',     handleMouseClick)

        // Flush any remaining events before stopping (e.g. on logout)
        const remaining = eventBuffer.current.splice(0)
        if (remaining.length > 0 && token && sessionId && !isPaused.current) {
            eventsAPI.submitBatch(token, sessionId, remaining).catch(() => {})
        }
        eventBuffer.current = []  // explicit clear — no stale data after logout
    }, [handleKeyDown, handleKeyUp, handleMouseMove, handleMouseClick, token, sessionId, _clearIdleTimer])

    // -----------------------------------------------------------------------
    // Public pause / resume (called by Dashboard for step-up)
    // -----------------------------------------------------------------------
    const pauseCapture = useCallback(() => {
        isPaused.current    = true
        eventBuffer.current = []   // discard buffered events — not from the authenticated user
        _clearIdleTimer()
        setIsIdle(false)
        console.info('[Capture] Paused (step-up required)')
    }, [_clearIdleTimer])

    const resumeCapture = useCallback(() => {
        isPaused.current = false
        _resetIdleTimer()
        console.info('[Capture] Resumed after step-up')
    }, [_resetIdleTimer])

    // -----------------------------------------------------------------------
    // Mount / unmount
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!token || !sessionId) return
        startCapture()
        return () => stopCapture()
    }, [token, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    return { stats, updateTrustScore, isIdle, pauseCapture, resumeCapture }
}
