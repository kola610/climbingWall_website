import type { SensorReading } from "../types/sensor"

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? ""

/** The Pi streams at ~100 Hz (setDataInterval(10)); the algorithm assumes this. */
export const JUMP_SAMPLING_RATE = 100

export interface JumpResult {
  jumpHeightM: number
  jumpHeightCm: number
}

/**
 * Build per-hand / per-foot summed Newton arrays from a window of calibrated
 * sensor readings and POST them to the backend, which runs the proven
 * numpy/scipy jump-height algorithm (Method A: all computation is computer-side).
 *
 * `values` are in GUI-slot order [Left Hand, Right Hand, Left Foot, Right Foot]
 * × (X, Y, Z), already calibrated to Newtons by serialParser. We sum the two
 * hands and the two feet — this is the physically correct grouping per the
 * empirically-verified wiring (the Pi's old get_hand_foot_forces summed by
 * board side, which mislabeled hands vs. feet).
 */
export async function computeJumpHeight(
  window: SensorReading[],
  massKg: number,
  wallAngleDeg: number,
  samplingRate: number = JUMP_SAMPLING_RATE,
): Promise<JumpResult> {
  // `values` are SENSOR (wall) frame forces — the wall-decline rotation is NOT
  // baked in. This is exactly what the backend jump algorithm expects: it applies
  // the wall-angle projection to global vertical itself (using `wallAngleDeg`),
  // so the forces are corrected for the tilt exactly once. (Before the frame
  // inversion the buffer was world-frame and this double-corrected.)
  const hand: number[][] = []
  const foot: number[][] = []
  for (const { values: v } of window) {
    if (!v || v.length !== 12) continue
    // GUI order: 0-2 Left Hand, 3-5 Right Hand, 6-8 Left Foot, 9-11 Right Foot
    hand.push([v[0] + v[3], v[1] + v[4], v[2] + v[5]])
    foot.push([v[6] + v[9], v[7] + v[10], v[8] + v[11]])
  }

  const response = await fetch(`${BACKEND_BASE_URL}/api/jump`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hand,
      foot,
      mass: massKg,
      wallAngle: wallAngleDeg,
      samplingRate,
    }),
  })

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}))
    throw new Error(errorPayload?.error ?? "Failed to compute jump height.")
  }
  return response.json()
}
