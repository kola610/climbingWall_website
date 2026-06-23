/**
 * Wall-decline geometry — the single source of truth for the tilt angle θ used to
 * project the X/Z forces from the sensor frame into the world frame.
 *
 * The bouldering wall is mounted with a fixed backward decline of θ degrees from
 * vertical (senkrecht), default 16°. The load cells are rigidly bolted to the
 * wall, so their measurement axes rotate with it:
 *   - the in-plane (up-slope) sensor axis sits θ from true vertical;
 *   - the normal (out-of-wall) sensor axis sits θ from true horizontal.
 * A force applied in the world frame therefore appears in the sensor frame rotated
 * by θ, and is recovered by a single rotation through θ. This replaces the
 * previous independent X and Z derivation (which assumed θ = 0).
 *
 * Coordinate convention (stated explicitly):
 *   Sensor frame (what the per-axis calibration produces, per board):
 *     X_sensor = in-plane force  (along the wall, pointing up-slope)
 *     Z_sensor = normal force    (perpendicular to the wall surface, pointing out)
 *   World frame (after this projection):
 *     X = true VERTICAL, up toward the roof   (a hung weight reads −X)
 *     Z = true HORIZONTAL, out of the wall toward the climber
 *     Y = horizontal sideways (right) — UNCHANGED, never touched here
 *
 * Because the sensor frame is the world frame rotated by θ about the horizontal
 * (Y) axis, the recovery is a plain 2-D rotation by +θ in the X–Z plane:
 *
 *     X_world (vertical)   = X_sensor·cosθ − Z_sensor·sinθ
 *     Z_world (horizontal) = X_sensor·sinθ + Z_sensor·cosθ
 *
 * Notes on signs / direction (see the reference sketch: red = old vertical axis,
 * purple = wall axis at 16° from vertical / 74° from horizontal, overhanging so the
 * top protrudes furthest along the normal): this +θ rotation is the one that
 * CORRECTS the tilt — a purely vertical load resolves to all-X / zero-Z, and a
 * push along the wall normal splits into X = −sinθ, Z = cosθ. θ is a single signed
 * parameter: if the mounted sensor's positive normal points the other way (slab
 * instead of overhang), use a negative θ to flip the rotation direction. The
 * structure (rotation by θ) stays the same either way.
 */

import type { SensorReading } from "../types/sensor"

export const DEFAULT_WALL_DECLINE_DEG = 16
export const WALL_DECLINE_STORAGE_KEY = "cw:wallDeclineDeg"

function readPersistedDeclineDeg(): number {
  try {
    const stored = localStorage.getItem(WALL_DECLINE_STORAGE_KEY)
    if (stored !== null) {
      const v = parseFloat(stored)
      if (Number.isFinite(v)) return v
    }
  } catch {
    // No localStorage (SSR / node) — fall back to the default.
  }
  return DEFAULT_WALL_DECLINE_DEG
}

// Module-level active angle. Initialised from storage so the value is correct
// before React mounts (serialParser reads it on every incoming sample).
let activeDeclineDeg = readPersistedDeclineDeg()

export function getWallDeclineDeg(): number {
  return activeDeclineDeg
}

/** Set the active decline angle (degrees) and persist it. */
export function setWallDeclineDeg(deg: number): void {
  if (!Number.isFinite(deg)) return
  activeDeclineDeg = deg
  try {
    localStorage.setItem(WALL_DECLINE_STORAGE_KEY, String(deg))
  } catch {
    // Quota / unavailable — the in-memory value still updates.
  }
}

/**
 * Rotate one board's (in-plane X, normal Z) sensor force into world (vertical X,
 * horizontal Z) by the decline angle. θ = 0 returns the inputs unchanged.
 */
export function rotateSensorToWorldXZ(
  xSensor: number,
  zSensor: number,
  declineDeg: number,
): [number, number] {
  const t = (declineDeg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const xWorld = xSensor * c - zSensor * s // true vertical (up)
  const zWorld = xSensor * s + zSensor * c // true horizontal (out)
  return [xWorld, zWorld]
}

/**
 * Apply the wall-decline rotation to a length-12 force array in GUI-slot order
 * ([Left Hand, Right Hand, Left Foot, Right Foot] × (X, Y, Z)). For each board it
 * rotates X (index 0) and Z (index 2) together; Y (index 1) is left untouched.
 */
export function applyWallDecline(
  values: number[],
  declineDeg: number = activeDeclineDeg,
): number[] {
  const out = [...values]
  for (let b = 0; b < 4; b++) {
    const xi = b * 3
    const zi = b * 3 + 2
    const [xw, zw] = rotateSensorToWorldXZ(values[xi], values[zi], declineDeg)
    out[xi] = xw
    out[zi] = zw
  }
  return out
}

/**
 * Coordinate system the forces are displayed in.
 *   "sensor" — raw sensor/board axes (X = along the wall / in-plane, Z = board
 *              normal). This is the canonical frame everything is STORED in; it
 *              is the default display and applies no rotation.
 *   "world"  — tilt-corrected (X = true vertical, Z = out of wall). A DERIVED,
 *              opt-in view produced by rotating the stored sensor frame by θ at
 *              render time. The stored buffer is never modified.
 */
export type CoordinateFrame = "sensor" | "world"

/**
 * Re-express stored (sensor-frame) readings in the requested display frame.
 *
 * Sensor is the canonical stored frame, so it is returned unchanged (same array
 * reference, so memoised consumers can skip work). World frame is derived by
 * applying the wall-decline rotation by +θ — purely at the display layer, never
 * touching the stored buffer. `declineDeg` is the tilt angle the user has entered
 * and confirmed for the world view (live) or the angle chosen for a recording.
 */
export function toDisplayFrameReadings(
  readings: SensorReading[],
  frame: CoordinateFrame,
  declineDeg: number,
): SensorReading[] {
  if (frame === "sensor") return readings
  return readings.map((r) => ({
    ...r,
    values: applyWallDecline(r.values, declineDeg),
  }))
}

/**
 * Sanity checks for the rotation model (the task's required assertions). Pure and
 * dependency-free so it can run in the browser (dev console) or under node.
 */
export function wallDeclineSelfCheck(): { name: string; ok: boolean; detail: string }[] {
  const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps
  const results: { name: string; ok: boolean; detail: string }[] = []

  // 1. θ = 0 reproduces the old mapping exactly (identity: X stays X, Z stays Z).
  {
    const [x, z] = rotateSensorToWorldXZ(3.5, -7.25, 0)
    results.push({
      name: "θ=0 is identity (in-plane→X, normal→Z)",
      ok: approx(x, 3.5) && approx(z, -7.25),
      detail: `X=${x}, Z=${z}`,
    })
  }

  // 2. Pure vertical world load → all on the vertical axis (X), ~0 horizontal (Z).
  //    A unit vertical load projects onto the tilted sensor axes as (cosθ, −sinθ).
  {
    const th = 16
    const t = (th * Math.PI) / 180
    const [x, z] = rotateSensorToWorldXZ(Math.cos(t), -Math.sin(t), th)
    results.push({
      name: "pure vertical load → X≈1 (vertical), Z≈0 (horizontal)",
      ok: approx(x, 1) && approx(z, 0),
      detail: `X=${x.toFixed(6)}, Z=${z.toFixed(6)}`,
    })
  }

  // 3. Pure push along the wall normal → correct split for θ: X=−sinθ, Z=cosθ.
  {
    const th = 16
    const t = (th * Math.PI) / 180
    const [x, z] = rotateSensorToWorldXZ(0, 1, th)
    results.push({
      name: "pure normal push → X≈−sinθ (vertical), Z≈cosθ (horizontal)",
      ok: approx(x, -Math.sin(t)) && approx(z, Math.cos(t)),
      detail: `X=${x.toFixed(4)} (exp ${(-Math.sin(t)).toFixed(4)}), Z=${z.toFixed(4)} (exp ${Math.cos(t).toFixed(4)})`,
    })
  }

  return results
}
