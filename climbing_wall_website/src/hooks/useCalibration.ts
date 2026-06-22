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

interface CaptureState {
  remaining: number
  count: number
  sums: number[] // running per-channel sums (length 12)
  resolve: (avg: number[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
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
    const cap = captureRef.current
    if (!cap) return
    for (let i = 0; i < cap.sums.length; i++) cap.sums[i] += signedRaw[i] ?? 0
    cap.count += 1
    cap.remaining -= 1
    if (cap.remaining <= 0) {
      clearTimeout(cap.timer)
      captureRef.current = null
      cap.resolve(cap.sums.map((s) => s / cap.count))
    }
  }, [])

  const getLatestSample = useCallback(() => latestSampleRef.current, [])

  /**
   * Average the next `sampleCount` signed-raw samples across all 12 channels.
   * Returns the full averaged array so a single capture can calibrate multiple
   * channels at once (e.g. a hang that loads both X and Z). Rejects if a capture
   * is already running or no data arrives in time.
   */
  const captureAverages = useCallback(
    (sampleCount: number = DEFAULT_CAPTURE_SAMPLES): Promise<number[]> =>
      new Promise<number[]>((resolve, reject) => {
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
    captureAverages,
    cancelCapture,
    commitChannels,
    resetToDefaults,
    restoreCalibration,
  }
}

export type UseCalibrationReturn = ReturnType<typeof useCalibration>
