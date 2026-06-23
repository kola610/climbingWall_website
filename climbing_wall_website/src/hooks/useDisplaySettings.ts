import { useState, useCallback } from "react"
import { usePersistedState } from "./usePersistedState"
import { getWallDeclineDeg, setWallDeclineDeg } from "../utils/wallGeometry"
import type { CoordinateFrame } from "../utils/wallGeometry"

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

  // World-frame display is an explicit, opt-in, UI-only rotation. By default the
  // charts show the canonical SENSOR frame (no rotation). To see world frame the
  // user enters the current wall tilt and confirms it, which "locks" the world
  // view at that angle. The stored buffer is never modified.
  const [worldViewLocked, setWorldViewLocked] = usePersistedState(
    "cw:worldViewLocked", false,
  )
  const [worldViewAngleDeg, setWorldViewAngleDeg] = usePersistedState(
    "cw:worldViewAngleDeg", getWallDeclineDeg(),
  )

  // Derived display frame: sensor (default / identity) or world (rotated by the
  // confirmed angle).
  const coordinateFrame: CoordinateFrame = worldViewLocked ? "world" : "sensor"

  // Wall decline angle θ — the physical wall lean used by the calibration wizard
  // (hang split) and persisted (cw:wallDeclineDeg). Since the frame inversion it
  // no longer modifies stored values; it is metadata + the prefill convenience
  // for the live world-view angle field. The module store in wallGeometry is the
  // source of truth; this React state mirrors it for the settings input.
  const [wallDeclineDeg, setWallDeclineDegState] = useState<number>(() => getWallDeclineDeg())

  const handleSampleCountChange = (value: string) => {
    setDisplaySampleCount(value === "all" ? "all" : parseInt(value, 10))
  }

  const handleWallDeclineChange = useCallback((deg: number) => {
    setWallDeclineDeg(deg) // updates + persists the calibration angle
    setWallDeclineDegState(deg)
  }, [])

  // Lock the world view at a confirmed angle (after the user's confirmation).
  const lockWorldView = useCallback((angleDeg: number) => {
    setWorldViewAngleDeg(angleDeg)
    setWorldViewLocked(true)
  }, [setWorldViewAngleDeg, setWorldViewLocked])

  // Return to the default sensor-frame view.
  const unlockWorldView = useCallback(() => {
    setWorldViewLocked(false)
  }, [setWorldViewLocked])

  return {
    displaySampleCount,
    autoScaleY,
    yAxisMax,
    wallDeclineDeg,
    coordinateFrame,
    worldViewLocked,
    worldViewAngleDeg,
    lockWorldView,
    unlockWorldView,
    setAutoScaleY,
    setYAxisMax,
    handleSampleCountChange,
    handleWallDeclineChange,
  }
}
