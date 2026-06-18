import { useState, useCallback } from "react"
import { usePersistedState } from "./usePersistedState"
import { getWallDeclineDeg, setWallDeclineDeg } from "../utils/wallGeometry"

/**
 * Manages the user-controlled display settings that affect chart rendering.
 * All values are persisted to localStorage so they survive page reloads.
 */
export function useDisplaySettings() {
  const [displaySampleCount, setDisplaySampleCount] = usePersistedState<number | "all">(
    "cw:displaySampleCount", 500,
  )
  const [autoScaleY, setAutoScaleY] = usePersistedState("cw:autoScaleY", false)
  const [yAxisMax, setYAxisMax] = usePersistedState("cw:yAxisMax", 1023)

  // Wall decline angle θ used to project X/Z into the world frame. The module
  // store in wallGeometry (read by serialParser on every sample, and persisted)
  // is the source of truth; this React state mirrors it for the settings input.
  const [wallDeclineDeg, setWallDeclineDegState] = useState<number>(() => getWallDeclineDeg())

  const handleSampleCountChange = (value: string) => {
    setDisplaySampleCount(value === "all" ? "all" : parseInt(value, 10))
  }

  const handleWallDeclineChange = useCallback((deg: number) => {
    setWallDeclineDeg(deg) // updates + persists the value serialParser reads
    setWallDeclineDegState(deg)
  }, [])

  return {
    displaySampleCount,
    autoScaleY,
    yAxisMax,
    wallDeclineDeg,
    setAutoScaleY,
    setYAxisMax,
    handleSampleCountChange,
    handleWallDeclineChange,
  }
}
