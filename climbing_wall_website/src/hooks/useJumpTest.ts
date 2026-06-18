import { useState, useEffect, useCallback, useRef } from "react"
import { usePersistedState } from "./usePersistedState"
import type { SensorReading } from "../types/sensor"
import { computeJumpHeight } from "../utils/jumpApi"

interface JumpTestDeps {
  isConnected: boolean
  mockModeActive: React.MutableRefObject<boolean>
  setError: (err: string | null) => void
  /** Live buffer of calibrated (Newton) sensor readings, in GUI-slot order. */
  allSensorDataRef: React.MutableRefObject<SensorReading[]>
}

/**
 * Manages the complete jump-test feature including:
 *  - Jump test state machine (idle → waiting → completed).
 *  - Countdown timer during a live test.
 *  - Body-weight and wall-angle configuration (input + validation).
 *  - Jump-height computation (Method A): on finish, the jump-window slice of the
 *    calibrated force buffer is POSTed to the backend, which runs the
 *    numpy/scipy algorithm and returns the height. Nothing is sent to the Pi.
 */
export function useJumpTest({
  isConnected,
  mockModeActive,
  setError,
  allSensorDataRef,
}: JumpTestDeps) {
  // Index into allSensorDataRef marking the start of the current jump window.
  const jumpStartIndexRef = useRef(0)
  // Transient test state — not persisted (a running test cannot survive a reload)
  const [jumpTestActive, setJumpTestActive] = useState(false)
  const [jumpTestStatus, setJumpTestStatus] = useState<"idle" | "waiting" | "completed">("idle")
  const [countdown, setCountdown] = useState(10)
  const [timerActive, setTimerActive] = useState(false)

  // Persisted values — survive page reload so the professor doesn't retype them
  const [jumpNumber, setJumpNumber] = usePersistedState<number | null>("cw:jumpNumber", null)
  const [bodyWeight, setBodyWeight] = usePersistedState("cw:bodyWeight", "")
  const [bodyWeightSubmitted, setBodyWeightSubmitted] = usePersistedState<number | null>("cw:bodyWeightSubmitted", null)
  const [wallAngle, setWallAngle] = usePersistedState("cw:wallAngle", "")
  const [wallAngleSubmitted, setWallAngleSubmitted] = usePersistedState<number | null>("cw:wallAngleSubmitted", null)

  // Countdown timer driven by state so it survives re-renders cleanly.
  useEffect(() => {
    if (!timerActive) return
    if (countdown === 0) {
      setTimerActive(false)
      return
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown, timerActive])

  const startJumpTest = useCallback(async () => {
    if (!isConnected && !mockModeActive.current) {
      setError("Connect to a device first")
      return
    }
    // Real jump-height computation needs the climber's mass; mock mode does not.
    if (isConnected && bodyWeightSubmitted === null) {
      setError("Enter and submit a body weight before starting a jump test")
      return
    }
    setJumpNumber(null)
    setJumpTestStatus("waiting")
    setJumpTestActive(true)
    setCountdown(10)
    setTimerActive(true)
    // Mark where this jump window begins in the live force buffer. Real serial
    // data is always buffered while connected, so the window is [start, finish].
    jumpStartIndexRef.current = allSensorDataRef.current.length
    // In mock mode the user clicks "Finish Jump" to trigger a mock result.
  }, [isConnected, mockModeActive, setError, bodyWeightSubmitted, allSensorDataRef])

  const finishJumpTest = useCallback(async () => {
    if (!jumpTestActive) {
      setError("No jump test is currently active")
      return
    }

    if (isConnected) {
      const window = allSensorDataRef.current.slice(jumpStartIndexRef.current)
      const mass = bodyWeightSubmitted ?? 0
      const angle = wallAngleSubmitted ?? 0
      try {
        const result = await computeJumpHeight(window, mass, angle)
        setJumpNumber(result.jumpHeightCm)
        setJumpTestStatus("completed")
        setJumpTestActive(false)
        setError(null)
      } catch (err) {
        console.error("Error computing jump height:", err)
        setError(
          err instanceof Error
            ? `Failed to compute jump height: ${err.message}`
            : "Failed to compute jump height. Please try again.",
        )
        setJumpTestStatus("idle")
        setJumpTestActive(false)
      }
    } else if (mockModeActive.current) {
      setTimeout(() => {
        const mockValue = Math.floor(Math.random() * 100) + 20
        setJumpNumber(mockValue)
        setJumpTestStatus("completed")
        setJumpTestActive(false)
      }, 500)
    }
  }, [
    jumpTestActive,
    isConnected,
    mockModeActive,
    setError,
    allSensorDataRef,
    bodyWeightSubmitted,
    wallAngleSubmitted,
  ])

  // Body weight and wall angle are no longer sent to the Pi (Method A) — they
  // are kept as frontend state and passed to the backend at jump-finish time.
  const sendBodyWeight = useCallback(() => {
    if (!bodyWeight || isNaN(Number(bodyWeight))) {
      setError("Please enter a valid body weight")
      return
    }
    const weight = Number(bodyWeight)
    if (weight <= 0 || weight > 500) {
      setError("Please enter a valid body weight between 1 and 500 kg")
      return
    }
    setBodyWeightSubmitted(weight)
    setError(null)
  }, [bodyWeight, setBodyWeightSubmitted, setError])

  const sendWallAngle = useCallback(() => {
    if (!wallAngle || isNaN(Number(wallAngle))) {
      setError("Please enter a valid wall angle")
      return
    }
    const angle = Number(wallAngle)
    if (angle < 0 || angle > 90) {
      setError("Please enter a valid wall angle between 0 and 90 degrees")
      return
    }
    setWallAngleSubmitted(angle)
    setError(null)
  }, [wallAngle, setWallAngleSubmitted, setError])

  const reset = useCallback(() => {
    setJumpTestActive(false)
    setJumpTestStatus("idle")
    setTimerActive(false)
  }, [])

  return {
    jumpNumber,
    jumpTestActive,
    jumpTestStatus,
    countdown,
    bodyWeight,
    bodyWeightSubmitted,
    wallAngle,
    wallAngleSubmitted,
    setBodyWeight,
    setWallAngle,
    startJumpTest,
    finishJumpTest,
    sendBodyWeight,
    sendWallAngle,
    reset,
  }
}
