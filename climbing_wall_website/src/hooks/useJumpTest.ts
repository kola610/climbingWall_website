import { useState, useEffect, useCallback } from "react"
import { usePersistedState } from "./usePersistedState"

interface JumpTestDeps {
  isConnected: boolean
  sendCommand: (cmd: string) => Promise<void>
  mockModeActive: React.MutableRefObject<boolean>
  setError: (err: string | null) => void
}

/**
 * Manages the complete jump-test feature including:
 *  - Jump test state machine (idle → waiting → completed).
 *  - Countdown timer during a live test.
 *  - Body-weight and wall-angle configuration (input, validation, sending).
 *  - `handleJumpMessage` — called by the serial line dispatcher when the
 *    device reports a "jump: N" result.
 */
export function useJumpTest({
  isConnected,
  sendCommand,
  mockModeActive,
  setError,
}: JumpTestDeps) {
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

  /** Called by the serial dispatcher when a "jump: N" line is received. */
  const handleJumpMessage = useCallback((value: number) => {
    setJumpNumber(value)
    setJumpTestStatus("completed")
    setJumpTestActive(false)
  }, [])

  const startJumpTest = useCallback(async () => {
    if (!isConnected && !mockModeActive.current) {
      setError("Connect to a device first")
      return
    }
    setJumpNumber(null)
    setJumpTestStatus("waiting")
    setJumpTestActive(true)
    setCountdown(10)
    setTimerActive(true)

    if (isConnected) {
      try {
        await sendCommand("start_jump\n")
      } catch (err) {
        console.error("Error starting jump test:", err)
        setError("Failed to start jump test. Please try again.")
        setJumpTestStatus("idle")
        setJumpTestActive(false)
      }
    }
    // In mock mode the user clicks "Finish Jump" to trigger the mock result.
  }, [isConnected, sendCommand, mockModeActive, setError])

  const finishJumpTest = useCallback(async () => {
    if (!jumpTestActive) {
      setError("No jump test is currently active")
      return
    }

    if (isConnected) {
      try {
        await sendCommand("stop_jump\n")
      } catch (err) {
        console.error("Error finishing jump test:", err)
        setError("Failed to finish jump test. Please try again.")
      }
    } else if (mockModeActive.current) {
      setTimeout(() => {
        const mockValue = Math.floor(Math.random() * 100) + 20
        setJumpNumber(mockValue)
        setJumpTestStatus("completed")
        setJumpTestActive(false)
      }, 500)
    }
  }, [jumpTestActive, isConnected, sendCommand, mockModeActive, setError])

  const sendBodyWeight = useCallback(async () => {
    if (!bodyWeight || isNaN(Number(bodyWeight))) {
      setError("Please enter a valid body weight")
      return
    }
    const weight = Number(bodyWeight)
    if (weight <= 0 || weight > 500) {
      setError("Please enter a valid body weight between 1 and 500 kg")
      return
    }
    if (!isConnected && !mockModeActive.current) {
      setError("Connect to a device first")
      return
    }
    if (isConnected) {
      try {
        await sendCommand(`mass:${weight}\n`)
      } catch (err) {
        console.error("Error sending body weight:", err)
        setError("Failed to send body weight. Please try again.")
        return
      }
    }
    setBodyWeightSubmitted(weight)
    setError(null)
  }, [bodyWeight, isConnected, sendCommand, mockModeActive, setError])

  const sendWallAngle = useCallback(async () => {
    if (!wallAngle || isNaN(Number(wallAngle))) {
      setError("Please enter a valid wall angle")
      return
    }
    const angle = Number(wallAngle)
    if (angle < 0 || angle > 90) {
      setError("Please enter a valid wall angle between 0 and 90 degrees")
      return
    }
    if (!isConnected && !mockModeActive.current) {
      setError("Connect to a device first")
      return
    }
    if (isConnected) {
      try {
        await sendCommand(`angle:${angle}\n`)
      } catch (err) {
        console.error("Error sending wall angle:", err)
        setError("Failed to send wall angle. Please try again.")
        return
      }
    }
    setWallAngleSubmitted(angle)
    setError(null)
  }, [wallAngle, isConnected, sendCommand, mockModeActive, setError])

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
    handleJumpMessage,
    startJumpTest,
    finishJumpTest,
    sendBodyWeight,
    sendWallAngle,
    reset,
  }
}
