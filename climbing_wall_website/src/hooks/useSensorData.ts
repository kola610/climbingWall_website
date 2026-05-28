import { useState, useRef, useEffect, useCallback } from "react"
import type { SensorReading } from "../types/sensor"
import { saveSensorData, loadSensorData, clearSensorData } from "../utils/sensorStorage"

// Cap points fed to Chart.js so render cost stays bounded regardless of
// buffer size or `displaySampleCount`. Buffer keeps full resolution.
const MAX_DISPLAY_POINTS = 1000

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
  sendCommand: (cmd: string) => Promise<void>
  mockModeActive: React.MutableRefObject<boolean>
}

interface DisplaySettings {
  displaySampleCount: number | "all"
}

/**
 * Manages the full sensor data pipeline:
 *  - High-frequency ingestion into a mutable ref buffer (no re-renders per sample).
 *  - Tare / calibration via captured offset values.
 *  - Throttled UI sync (~20 fps) from the buffer to React state.
 *  - Mock data generation when no hardware is connected.
 *
 * Display-window logic (how many samples to show, auto-scale) is driven by
 * the `DisplaySettings` params so this hook stays decoupled from the settings UI.
 */
export function useSensorData(
  { isConnected, sendCommand, mockModeActive }: ConnectionDeps,
  { displaySampleCount }: DisplaySettings,
) {
  const [isCollecting, setIsCollecting] = useState(false)
  const [totalSamples, setTotalSamples] = useState(0)
  const [displayData, setDisplayData] = useState<SensorReading[]>([])
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null)

  // --- mutable refs (never trigger re-renders) ---
  const isCollectingRef = useRef(false)
  const sampleCounterRef = useRef(0)
  const allSensorDataRef = useRef<SensorReading[]>([])
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoSaveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mockDataIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tareOffsetsRef = useRef<number[]>(new Array(12).fill(0))

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
    const taredValues = values.map((v, i) => v - tareOffsetsRef.current[i])
    allSensorDataRef.current.push({
      timestamp: Date.now(),
      sampleNumber: sample,
      values: taredValues,
    })
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
      const mockValues = Array.from({ length: 12 }, () =>
        Math.floor(Math.random() * 1023),
      )
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

  const calibrateDevice = useCallback(async () => {
    const latestData = allSensorDataRef.current
    if (latestData.length > 0) {
      tareOffsetsRef.current = [...latestData[latestData.length - 1].values]
    } else {
      tareOffsetsRef.current = new Array(12).fill(0)
    }

    if (isConnected) {
      try {
        await sendCommand("calibrate\n")
      } catch (err) {
        console.error("Calibration error:", err)
        return
      }
    }

    setCalibrationMessage("System calibrated — all force values tared to zero.")
    setTimeout(() => setCalibrationMessage(null), 3000)
  }, [isConnected, sendCommand])

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
    calibrationMessage,
    allSensorDataRef,
    addSensorReading,
    toggleDataCollection,
    startFreshCollection,
    calibrateDevice,
    stopCollection,
  }
}
