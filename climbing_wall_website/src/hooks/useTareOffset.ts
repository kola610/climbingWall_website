import { useCallback, useRef, useState } from "react"
import {
  TARE_WINDOW_SAMPLES,
  TARE_MIN_SAMPLES,
  setRuntimeOffset,
  clearRuntimeOffset,
  getZeroedAt,
} from "../utils/runtimeOffset"
import { useChannelRing } from "./useChannelRing"

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
 * Non-blocking by construction: a recording can start with no zero applied, and
 * whenever the user taps "Zero" the buffered window is averaged and installed —
 * there is nothing to wait for. The zero stays in effect until re-zeroed or
 * cleared, and is cached in localStorage so a reload restores it.
 *
 * Deliberately separate from useCalibration: calibration (switches + scales) is
 * persisted hardware data; the zero is volatile and user-driven.
 */
export function useTareOffset(): UseTareOffsetReturn {
  const ring = useChannelRing(TARE_WINDOW_SAMPLES)
  // Mirror of canTare so feedSample (a stable callback) can flip it exactly once
  // without reading React state from a stale closure.
  const canTareRef = useRef(false)

  // Seed from the persisted zero so a reload shows the restored zero (and its
  // age) immediately, without waiting to re-tare.
  const [zeroedAt, setZeroedAt] = useState<number | null>(() => getZeroedAt())
  const [canTare, setCanTare] = useState(false)

  const feedSample = useCallback(
    (signedRaw: number[]) => {
      ring.feed(signedRaw)
      if (!canTareRef.current && ring.filled() >= TARE_MIN_SAMPLES) {
        canTareRef.current = true
        setCanTare(true)
      }
    },
    [ring],
  )

  const tare = useCallback((): boolean => {
    const avg = ring.mean(TARE_MIN_SAMPLES)
    if (!avg) return false
    setZeroedAt(setRuntimeOffset(avg))
    return true
  }, [ring])

  const clearZero = useCallback(() => {
    clearRuntimeOffset()
    setZeroedAt(null)
  }, [])

  return { feedSample, tare, clearZero, zeroedAt, canTare }
}
