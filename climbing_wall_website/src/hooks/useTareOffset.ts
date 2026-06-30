import { useCallback, useRef, useState } from "react"
import {
  TARE_WINDOW_SAMPLES,
  TARE_MIN_SAMPLES,
  setRuntimeOffset,
  clearRuntimeOffset,
  getZeroedAt,
} from "../utils/runtimeOffset"

const N_CHANNELS = 12

export interface UseTareOffsetReturn {
  /** Pipe every incoming signed-raw sample here (the dashboard does this). */
  feedSample: (signedRaw: number[]) => void
  /**
   * Compute and install the zero from the buffered window. Instant (averages the
   * last ~TARE_WINDOW_SAMPLES already-streamed samples), so a recording never has
   * to block on zeroing. Returns false if too few samples are buffered yet.
   */
  tare: () => boolean
  /** Drop the current zero, reverting to un-tared readings. */
  clearZero: () => void
  /** Epoch ms when the current zero was computed, or null if never zeroed. */
  zeroedAt: number | null
  /** True once enough samples are buffered for a trustworthy zero. */
  canTare: boolean
}

/**
 * Owns the volatile zero offset (tare) for the live stream.
 *
 * Design — non-blocking by construction:
 *   - The dashboard pipes every `signedRaw` array to `feedSample`, which keeps a
 *     rolling window of the last TARE_WINDOW_SAMPLES samples (signed-raw space —
 *     the same space the offset is subtracted in, so the average is a valid zero
 *     no matter the current scale or offset).
 *   - A recording can start immediately with no zero applied. Whenever the user
 *     taps "Zero", `tare()` averages the buffered window and installs it via
 *     setRuntimeOffset — there is nothing to wait for. The most recent zero stays
 *     in effect until the user re-zeros (or clears it), and is cached in
 *     localStorage so a reload restores it instead of forcing a re-zero.
 *   - `zeroedAt` lets the UI show whether a zero has been taken and how stale it
 *     is; `canTare` gates the action until the stream has produced enough samples.
 *
 * This is intentionally separate from useCalibration: calibration (switches +
 * scales) is persisted hardware data, the zero is volatile and user-driven.
 */
export function useTareOffset(): UseTareOffsetReturn {
  // Rolling ring buffer of recent signed-raw samples, written at full stream rate.
  const bufRef = useRef<number[][]>(
    Array.from({ length: TARE_WINDOW_SAMPLES }, () => new Array(N_CHANNELS).fill(0)),
  )
  const headRef = useRef(0)
  const fillRef = useRef(0)
  // Mirror of canTare so feedSample (a stable callback) can flip it exactly once
  // without reading React state from a stale closure.
  const canTareRef = useRef(false)

  // Seed from the persisted zero so a reload shows the restored zero (and its
  // age) immediately, without waiting to re-tare.
  const [zeroedAt, setZeroedAt] = useState<number | null>(() => getZeroedAt())
  const [canTare, setCanTare] = useState(false)

  const feedSample = useCallback((signedRaw: number[]) => {
    const row = bufRef.current[headRef.current]
    for (let i = 0; i < N_CHANNELS; i++) row[i] = signedRaw[i] ?? 0
    headRef.current = (headRef.current + 1) % TARE_WINDOW_SAMPLES
    if (fillRef.current < TARE_WINDOW_SAMPLES) {
      fillRef.current += 1
      if (!canTareRef.current && fillRef.current >= TARE_MIN_SAMPLES) {
        canTareRef.current = true
        setCanTare(true)
      }
    }
  }, [])

  const tare = useCallback((): boolean => {
    const n = Math.min(fillRef.current, TARE_WINDOW_SAMPLES)
    if (n < TARE_MIN_SAMPLES) return false
    // Buffer entries [0, n) hold the most recent samples (the ring only wraps once
    // full, and a mean is order-independent), so a straight average is correct
    // whether or not the buffer has wrapped.
    const sums = new Array(N_CHANNELS).fill(0)
    const buf = bufRef.current
    for (let k = 0; k < n; k++) {
      const r = buf[k]
      for (let i = 0; i < N_CHANNELS; i++) sums[i] += r[i]
    }
    setZeroedAt(setRuntimeOffset(sums.map((s) => s / n)))
    return true
  }, [])

  const clearZero = useCallback(() => {
    clearRuntimeOffset()
    setZeroedAt(null)
  }, [])

  return { feedSample, tare, clearZero, zeroedAt, canTare }
}
