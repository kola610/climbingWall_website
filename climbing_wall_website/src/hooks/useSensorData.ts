import { useState, useRef, useEffect, useCallback } from "react"
import type { SensorReading } from "../types/sensor"
import { saveSensorData, loadSensorData, clearSensorData } from "../utils/sensorStorage"

// Cap points fed to Chart.js so render cost stays bounded regardless of
// buffer size or `displaySampleCount`. Buffer keeps full resolution.
const MAX_DISPLAY_POINTS = 1000

// Bound the in-memory buffer (~1 hour at the ~100 Hz stream rate). Data is
// buffered continuously while connected, so without a cap an all-day session
// grows without limit — and the 5-second IndexedDB auto-save re-serializes the
// whole buffer each time. Once over the cap the oldest chunk is dropped;
// `sampleNumber` is absolute, so sample-number-based consumers (the jump test)
// stay correct across trims, and display/save always use the newest samples.
const MAX_BUFFER_SAMPLES = 360_000
const TRIM_CHUNK_SAMPLES = 36_000

function buildDisplaySlice(
  data: SensorReading[],
  count: number | "all",
): SensorReading[] {
  const window = count === "all" ? data : data.slice(-count)
  if (window.length <= MAX_DISPLAY_POINTS) return [...window]
  const stride = Math.ceil(window.length / MAX_DISPLAY_POINTS)
  const out: SensorReading[] = []
  for (let i = 0; i < window.length; i += stride) out.push(window[i])
  const last = window[window.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

interface ConnectionDeps {
  isConnected: boolean
  mockModeActive: React.MutableRefObject<boolean>
}

interface DisplaySettings {
  displaySampleCount: number | "all"
}

/**
 * Manages the full sensor data pipeline:
 *  - High-frequency ingestion into a mutable ref buffer (no re-renders per sample).
 *  - Throttled UI sync (~20 fps) from the buffer to React state.
 *  - Mock data generation when no hardware is connected.
 *
 * Zeroing/tare is NOT done here: incoming `values` are already calibrated and
 * zero-subtracted upstream in serialParser (sign → runtime offset → scale), so
 * this hook stores them verbatim. The runtime offset is owned by useTareOffset.
 *
 * Display-window logic (how many samples to show, auto-scale) is driven by
 * the `DisplaySettings` params so this hook stays decoupled from the settings UI.
 */
export function useSensorData(
  { isConnected, mockModeActive }: ConnectionDeps,
  { displaySampleCount }: DisplaySettings,
) {
  const [isCollecting, setIsCollecting] = useState(false)
  const [totalSamples, setTotalSamples] = useState(0)
  const [displayData, setDisplayData] = useState<SensorReading[]>([])

  // --- mutable refs (never trigger re-renders) ---
  const isCollectingRef = useRef(false)
  const sampleCounterRef = useRef(0)
  const allSensorDataRef = useRef<SensorReading[]>([])
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoSaveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mockDataIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Mirrors of the display-settings props — kept current so interval callbacks
  // always read the latest values without stale-closure issues.
  const displaySampleCountRef = useRef(displaySampleCount)

  useEffect(() => { displaySampleCountRef.current = displaySampleCount }, [displaySampleCount])

  // Restore previous recording from IndexedDB on first mount.
  // Note: no didRestore guard — allSensorDataRef.current.length === 0 is the
  // safe idempotency check that also works under React Strict Mode double-invoke.
  useEffect(() => {
    loadSensorData().then((restored) => {
      if (restored.length > 0 && allSensorDataRef.current.length === 0) {
        allSensorDataRef.current = restored
        sampleCounterRef.current = restored[restored.length - 1].sampleNumber + 1
        setDisplayData(buildDisplaySlice(restored, displaySampleCountRef.current))
        setTotalSamples(restored.length)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-slice display window when the sample-count setting changes while idle.
  useEffect(() => {
    if (!isCollecting && allSensorDataRef.current.length > 0) {
      setDisplayData(buildDisplaySlice(allSensorDataRef.current, displaySampleCount))
    }
  }, [displaySampleCount, isCollecting])

  // Throttled UI sync at ~20 fps while collecting; final sync on stop.
  // Also runs a 5-second auto-save to IndexedDB so a page reload while
  // recording loses at most 5 seconds of data.
  useEffect(() => {
    if (!isCollecting) {
      if (allSensorDataRef.current.length > 0) {
        const data = allSensorDataRef.current
        setDisplayData(buildDisplaySlice(data, displaySampleCountRef.current))
        setTotalSamples(data.length)
      }
      return
    }

    syncIntervalRef.current = setInterval(() => {
      const data = allSensorDataRef.current
      setDisplayData(buildDisplaySlice(data, displaySampleCountRef.current))
      setTotalSamples(data.length)
    }, 50)

    autoSaveIntervalRef.current = setInterval(() => {
      if (allSensorDataRef.current.length > 0) {
        saveSensorData(allSensorDataRef.current)
      }
    }, 5000)

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current)
        syncIntervalRef.current = null
      }
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current)
        autoSaveIntervalRef.current = null
      }
    }
  }, [isCollecting])

  // --- core data operations ---

  const addSensorReading = useCallback((values: number[]) => {
    const sample = sampleCounterRef.current++
    const buf = allSensorDataRef.current
    buf.push({
      timestamp: Date.now(),
      sampleNumber: sample,
      values,
    })
    if (buf.length > MAX_BUFFER_SAMPLES) {
      buf.splice(0, TRIM_CHUNK_SAMPLES)
    }
  }, [])

  const stopMockData = useCallback(() => {
    if (mockDataIntervalRef.current) {
      clearInterval(mockDataIntervalRef.current)
      mockDataIntervalRef.current = null
    }
  }, [])

  const startMockData = useCallback(() => {
    stopMockData()
    mockDataIntervalRef.current = setInterval(() => {
      if (!isCollectingRef.current) {
        stopMockData()
        return
      }
      // Method A: the real pipeline turns tiny raw voltage ratios (~1e-6) into
      // Newtons via a per-channel scale (~1e6). Mock mode bypasses the serial
      // parser, so we generate raw-voltage-ratio-scale values and apply a
      // representative scale here to keep charts in a sensible Newton range
      // (gentle per-channel sine + noise so the lines look alive).
      const MOCK_SCALE = 3_000_000 // representative N per raw-voltage-ratio unit
      const t = Date.now() / 1000
      const mockValues = Array.from({ length: 12 }, (_, i) => {
        const rawRatio =
          (Math.sin(t * 1.5 + i) * 0.5 + (Math.random() - 0.5)) * 2e-5
        return rawRatio * MOCK_SCALE
      })
      addSensorReading(mockValues)
    }, 10)
  }, [addSensorReading, stopMockData])

  const stopCollection = useCallback(() => {
    isCollectingRef.current = false
    setIsCollecting(false)
    stopMockData()
    saveSensorData(allSensorDataRef.current)
  }, [stopMockData])

  /**
   * Pause / resume the current recording session without losing any data.
   * Sample numbers continue from where they left off when resuming.
   */
  const toggleDataCollection = useCallback(() => {
    if (isCollectingRef.current) {
      stopCollection()
      return
    }
    // Resume — just restart ingestion, keep the existing buffer.
    isCollectingRef.current = true
    setIsCollecting(true)
    if (!isConnected) {
      mockModeActive.current = true
      startMockData()
    }
  }, [isConnected, mockModeActive, startMockData, stopCollection])

  /**
   * Discard all existing data and start a brand-new recording session.
   */
  const startFreshCollection = useCallback(() => {
    sampleCounterRef.current = 0
    allSensorDataRef.current = []
    clearSensorData()
    setTotalSamples(0)
    setDisplayData([])
    isCollectingRef.current = true
    setIsCollecting(true)
    if (!isConnected) {
      mockModeActive.current = true
      startMockData()
    }
  }, [isConnected, mockModeActive, startMockData])

  // Cleanup on unmount — persist whatever we have so nothing is lost.
  useEffect(() => {
    return () => {
      isCollectingRef.current = false
      stopMockData()
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
      if (allSensorDataRef.current.length > 0) {
        saveSensorData(allSensorDataRef.current)
      }
    }
  }, [stopMockData])

  return {
    isCollecting,
    isCollectingRef,
    totalSamples,
    displayData,
    allSensorDataRef,
    addSensorReading,
    toggleDataCollection,
    startFreshCollection,
    stopCollection,
  }
}
