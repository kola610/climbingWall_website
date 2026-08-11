import type { SensorReading } from "../types/sensor"

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? ""

export interface JumpResult {
  jumpHeightM: number
  jumpHeightCm: number
}

/**
 * Sum a window of calibrated readings into per-hand / per-foot Newton arrays and
 * POST them to the backend's numpy/scipy jump-height algorithm.
 *
 * `values` are in GUI-slot order [Left Hand, Right Hand, Left Foot, Right Foot]
 * × (X, Y, Z), already calibrated to Newtons by serialParser, in the SENSOR
 * (wall) frame — the wall-decline rotation is NOT baked in. That is what the
 * backend expects: it applies the wall-angle projection itself (using
 * `wallAngleDeg`), so the tilt is corrected exactly once.
 */
export async function computeJumpHeight(
  window: SensorReading[],
  massKg: number,
  wallAngleDeg: number,
): Promise<JumpResult> {
  const hand: number[][] = []
  const foot: number[][] = []
  for (const { values: v } of window) {
    if (!v || v.length !== 12) continue
    // GUI order: 0-2 Left Hand, 3-5 Right Hand, 6-8 Left Foot, 9-11 Right Foot
    hand.push([v[0] + v[3], v[1] + v[4], v[2] + v[5]])
    foot.push([v[6] + v[9], v[7] + v[10], v[8] + v[11]])
  }

  // samplingRate is deliberately NOT sent: the backend defaults it from the
  // live stream's configured data interval (backend/phidget_config.json), the
  // single source of truth — so a config change can't silently skew the physics.
  const response = await fetch(`${BACKEND_BASE_URL}/api/jump`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hand,
      foot,
      mass: massKg,
      wallAngle: wallAngleDeg,
    }),
  })

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}))
    throw new Error(errorPayload?.error ?? "Failed to compute jump height.")
  }
  return response.json()
}
