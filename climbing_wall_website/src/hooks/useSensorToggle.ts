import { useState, useCallback } from "react"
import { SENSOR_NAMES } from "../constants/sensor"

const ALL_INDICES = SENSOR_NAMES.map((_, i) => i)

/**
 * Manages which sensors are visible. All start active.
 * At least one sensor always remains active.
 */
export function useSensorToggle() {
  const [activeSensors, setActiveSensors] = useState<Set<number>>(
    () => new Set(ALL_INDICES),
  )

  const toggleSensor = useCallback((index: number) => {
    setActiveSensors((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        if (next.size <= 1) return prev
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const visibleIndices = ALL_INDICES.filter((i) => activeSensors.has(i))

  return { activeSensors, toggleSensor, visibleIndices }
}
