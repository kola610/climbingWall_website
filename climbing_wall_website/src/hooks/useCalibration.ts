import { useState, useRef, useCallback, useEffect } from "react"
import {
  type CalibrationConfig,
  getCalibration,
  loadPersistedCalibration,
  persistCalibration,
  defaultCalibration,
} from "../utils/calibration"

/** Samples averaged per capture (~1.5 s at the ~100 Hz stream rate). */
export const DEFAULT_CAPTURE_SAMPLES = 150

/** Abort a capture if no samples arrive within this window (device unplugged). */
const CAPTURE_TIMEOUT_MS = 8000

/** Rolling window (~1 s at ~100 Hz) backing the live swing / stability readout. */
const STABILITY_WINDOW = 100

/** Minimum samples before the live stability readout is considered meaningful. */
const STABILITY_MIN_SAMPLES = 30

/** Result of a capture: the per-channel mean plus the spread that produced it. */
export interface CaptureResult {
  /** Per-channel mean over the capture window (length 12, signed-raw units). */
  avg: number[]
  /**
   * Per-channel standard deviation over the same window (length 12, signed-raw
   * units). A large σ means the load was moving (e.g. a swinging weight) while
   * it was captured, so the averaged value is less trustworthy.
   */
  std: number[]
}

interface CaptureState {
  remaining: number
  count: number
  sums: number[] // running per-channel sums (length 12)
  sumSqs: number[] // running per-channel sums of squares (length 12)
  resolve: (result: CaptureResult) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Finalise a completed capture into per-channel mean + standard deviation. */
function finalizeCapture(cap: CaptureState): CaptureResult {
  const avg = cap.sums.map((s) => s / cap.count)
  const std = cap.sumSqs.map((sq, i) => {
    // Var = E[x²] − E[x]²; clamp at 0 to absorb floating-point noise.
    const variance = sq / cap.count - avg[i] * avg[i]
    return Math.sqrt(Math.max(0, variance))
  })
  return { avg, std }
}

/**
 * Owns the live calibration config plus the sample-capture machinery used by the
 * calibration wizard.
 *
 *  - `config`           : React-state mirror of the active store, for the UI.
 *  - `feedSample`       : the dashboard pipes every incoming `signedRaw` array
 *                         here; it updates the live readout and any in-progress
 *                         capture.
 *  - `captureAxis`      : averages the next N samples for one channel.
 *  - `commitAxis`       : writes a computed offset/scale for one channel and
 *                         persists everywhere (live + localStorage + backend).
 *  - `getLatestSample`  : latest signed-raw array, for the live readout.
 */
export function useCalibration() {
  const [config, setConfig] = useState<CalibrationConfig>(() => getCalibration())

  const latestSampleRef = useRef<number[]>(new Array(12).fill(0))
  const captureRef = useRef<CaptureState | null>(null)

  // Ring buffer of the last STABILITY_WINDOW signed-raw samples, fed at full
  // stream rate so the live "is the weight still swinging?" readout sees the real
  // oscillation (not the 10 Hz UI poll, which would alias a fast swing).
  const stabilityBufRef = useRef<number[][]>(
    Array.from({ length: STABILITY_WINDOW }, () => new Array(12).fill(0)),
  )
  const stabilityHeadRef = useRef(0)
  const stabilityFillRef = useRef(0)

  // Load persisted calibration once on mount, then sync UI state.
  useEffect(() => {
    let cancelled = false
    loadPersistedCalibration().then(() => {
      if (!cancelled) setConfig(getCalibration())
    })
    return () => {
      cancelled = true
      if (captureRef.current) {
        clearTimeout(captureRef.current.timer)
        captureRef.current = null
      }
    }
  }, [])

  const feedSample = useCallback((signedRaw: number[]) => {
    latestSampleRef.current = signedRaw

    // Record into the rolling stability buffer (in-place copy, no allocation).
    const row = stabilityBufRef.current[stabilityHeadRef.current]
    for (let i = 0; i < 12; i++) row[i] = signedRaw[i] ?? 0
    stabilityHeadRef.current = (stabilityHeadRef.current + 1) % STABILITY_WINDOW
    if (stabilityFillRef.current < STABILITY_WINDOW) stabilityFillRef.current += 1

    const cap = captureRef.current
    if (!cap) return
    for (let i = 0; i < cap.sums.length; i++) {
      const v = signedRaw[i] ?? 0
      cap.sums[i] += v
      cap.sumSqs[i] += v * v
    }
    cap.count += 1
    cap.remaining -= 1
    if (cap.remaining <= 0) {
      clearTimeout(cap.timer)
      captureRef.current = null
      cap.resolve(finalizeCapture(cap))
    }
  }, [])

  const getLatestSample = useCallback(() => latestSampleRef.current, [])

  /**
   * Per-channel standard deviation (signed-raw units) over the most recent ~1 s
   * of samples — the live signal for "is the weight still swinging?". Returns
   * null until enough samples have arrived to be meaningful.
   */
  const getRecentStds = useCallback((): number[] | null => {
    const n = Math.min(stabilityFillRef.current, STABILITY_WINDOW)
    if (n < STABILITY_MIN_SAMPLES) return null
    const buf = stabilityBufRef.current
    const sums = new Array(12).fill(0)
    const sumSqs = new Array(12).fill(0)
    for (let k = 0; k < n; k++) {
      const r = buf[k]
      for (let i = 0; i < 12; i++) {
        const v = r[i] ?? 0
        sums[i] += v
        sumSqs[i] += v * v
      }
    }
    return sums.map((s, i) => {
      const mean = s / n
      return Math.sqrt(Math.max(0, sumSqs[i] / n - mean * mean))
    })
  }, [])

  /**
   * Average the next `sampleCount` signed-raw samples across all 12 channels.
   * Returns the full averaged array so a single capture can calibrate multiple
   * channels at once (e.g. a hang that loads both X and Z). Rejects if a capture
   * is already running or no data arrives in time.
   */
  const captureAverages = useCallback(
    (sampleCount: number = DEFAULT_CAPTURE_SAMPLES): Promise<CaptureResult> =>
      new Promise<CaptureResult>((resolve, reject) => {
        if (captureRef.current) {
          reject(new Error("A capture is already in progress."))
          return
        }
        const timer = setTimeout(() => {
          captureRef.current = null
          reject(
            new Error(
              "No sensor data received — is the device connected and streaming?",
            ),
          )
        }, CAPTURE_TIMEOUT_MS)
        captureRef.current = {
          remaining: sampleCount,
          count: 0,
          sums: new Array(12).fill(0),
          sumSqs: new Array(12).fill(0),
          resolve,
          reject,
          timer,
        }
      }),
    [],
  )

  const cancelCapture = useCallback(() => {
    const cap = captureRef.current
    if (cap) {
      clearTimeout(cap.timer)
      captureRef.current = null
      cap.reject(new Error("Capture cancelled."))
    }
  }, [])

  /**
   * Persist freshly computed offset/scale for one or more channels in a single
   * write (e.g. a hang calibrates X and Z together). `idx` is the flat channel
   * index (boardIdx * 3 + axisIdx).
   */
  const commitChannels = useCallback(
    (updates: { idx: number; offset: number; scale: number }[]) => {
      const current = getCalibration()
      const next: CalibrationConfig = {
        axisSigns: [...current.axisSigns],
        groundOffsets: [...current.groundOffsets],
        axisScales: [...current.axisScales],
      }
      for (const u of updates) {
        next.groundOffsets[u.idx] = u.offset
        next.axisScales[u.idx] = u.scale
      }
      persistCalibration(next)
      setConfig(next)
    },
    [],
  )

  const resetToDefaults = useCallback(() => {
    const next = defaultCalibration()
    persistCalibration(next)
    setConfig(next)
  }, [])

  /**
   * Replace the entire active config with `cfg` and persist it everywhere. Used by
   * the calibration wizard's "Exit & discard" to roll back to a snapshot taken when
   * the wizard opened, undoing any axes calibrated during the session.
   */
  const restoreCalibration = useCallback((cfg: CalibrationConfig) => {
    persistCalibration(cfg)
    setConfig(cfg)
  }, [])

  return {
    config,
    feedSample,
    getLatestSample,
    getRecentStds,
    captureAverages,
    cancelCapture,
    commitChannels,
    resetToDefaults,
    restoreCalibration,
  }
}

export type UseCalibrationReturn = ReturnType<typeof useCalibration>
