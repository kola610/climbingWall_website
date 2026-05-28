import { usePersistedState } from "./usePersistedState"

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

  const handleSampleCountChange = (value: string) => {
    setDisplaySampleCount(value === "all" ? "all" : parseInt(value, 10))
  }

  return {
    displaySampleCount,
    autoScaleY,
    yAxisMax,
    setAutoScaleY,
    setYAxisMax,
    handleSampleCountChange,
  }
}
