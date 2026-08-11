import defaultSettings from "../config/calibration_settings.json"

/**
 * Runtime calibration store: the per-axis sign and scale values `serialParser`
 * applies to every sample, live-updatable by the in-app wizard.
 *
 * Sources of truth, in priority order at startup (see `loadPersistedCalibration`):
 *   1. backend file  (GET /api/calibration → src/config/calibration_settings.json)
 *   2. localStorage  (works in expo / offline mode with no backend)
 *   3. the committed JSON import below (the build-time default)
 *
 * Both arrays are length-12, in GUI-slot order
 * [Left Hand, Right Hand, Left Foot, Right Foot] × (X, Y, Z).
 *
 * The zero offset is deliberately NOT here — it is the volatile runtime tare
 * (runtimeOffset.ts), keeping this to the two things that genuinely belong with
 * the hardware.
 */
export interface CalibrationConfig {
  axisSigns: number[]
  axisScales: number[]
}

/** Standard gravity — converts a calibration mass (kg) to a force (N). */
export const GRAVITY = 9.80665

export const CALIBRATION_STORAGE_KEY = "calibration"

/**
 * Force coordinate convention enforced across all four boards:
 *   +X → up (toward the top of the wall)
 *   +Y → to the right
 *   +Z → along the wall normal, out of the wall (toward the climber)
 *
 * Sign of the applied Y load during calibration, per board (GUI-slot order:
 * [Left Hand, Right Hand, Left Foot, Right Foot]). The LEFT-side boards are
 * pulled to the LEFT → −Y, so the fitted scale flips and a rightward force then
 * reads +Y uniformly across all four.
 *
 * X and Z are not listed: since the single-hang method their applied directions
 * are derived from the wall decline θ (−cosθ and +sinθ, see
 * computeHangCalibration), not from a table.
 */
export const Y_FORCE_DIRECTION_PER_BOARD: number[] = [-1, 1, -1, 1]

function clone(cfg: CalibrationConfig): CalibrationConfig {
  return {
    axisSigns: [...cfg.axisSigns],
    axisScales: [...cfg.axisScales],
  }
}

/** Built-in defaults, deep-cloned so the imported JSON object is never mutated. */
export function defaultCalibration(): CalibrationConfig {
  return clone(defaultSettings as CalibrationConfig)
}

// Module-level active config. Read by `serialParser.ts` at call time.
let active: CalibrationConfig = defaultCalibration()

export function getCalibration(): CalibrationConfig {
  return active
}

export function setCalibration(cfg: CalibrationConfig): void {
  active = clone(cfg)
}

/**
 * Flat channel indices (board*3 + axis) whose scale still equals the built-in
 * default — i.e. axes never individually calibrated. The wizard warns on these
 * before finishing. A calibrated axis always carries a computed scale that
 * differs from the seed, so exact equality is a reliable "untouched" test.
 */
export function findDefaultChannels(config: CalibrationConfig): number[] {
  const def = defaultCalibration()
  const out: number[] = []
  for (let i = 0; i < 12; i++) {
    if (config.axisScales[i] === def.axisScales[i]) {
      out.push(i)
    }
  }
  return out
}

/**
 * Derive an axis's zero offset and scale from a 0/10/20-kg (etc.) sweep.
 *
 * `rawsPerStep[k]` is the averaged signed-raw reading captured with
 * `weightsKg[k]` applied. The offset is the zero-load reading; the scale is the
 * least-squares slope of force vs. (raw − offset) through the origin, so
 * `(raw − offset) * scale ≈ force_N`.
 */
export function computeAxisCalibration(
  rawsPerStep: number[],
  weightsKg: number[],
  forceDirection: number = 1,
): { offset: number; scale: number } {
  const offset = rawsPerStep[0] ?? 0
  let num = 0
  let den = 0
  for (let k = 0; k < rawsPerStep.length; k++) {
    const x = rawsPerStep[k] - offset
    // `forceDirection` is the sign of the applied load in convention coordinates
    // (see CALIBRATION_FORCE_DIRECTION): −1 when the weight is pulled in the
    // −axis direction (e.g. Y on a left board), so the fitted scale flips and a
    // +convention force reads positive.
    const f = forceDirection * (weightsKg[k] ?? 0) * GRAVITY
    num += x * f
    den += x * x
  }
  // Near-zero denominator → the sensor channel didn't respond at all (raws
  // identical across weights); avoid div-by-0 and leave scale at 1 so the caller
  // can flag it. The threshold must sit far below a legitimate Σx²: raw voltage
  // ratios are ~1e-5, so a real calibration has Σx² ~1e-10 (and the weak normal
  // axis in a hang is smaller still), hence 1e-20 rather than 1e-9.
  const scale = Math.abs(den) < 1e-20 ? 1 : num / den
  return { offset, scale }
}

/**
 * Single-hang calibration of the X (in-plane) and Z (normal) axes of one board.
 *
 * On a wall declined by θ, hanging a known weight W (a pure vertical, gravity
 * load) loads the board's two axes at once: the up-slope (in-plane) axis sees
 * W·cosθ and the normal (out-of-wall) axis sees W·sinθ. So a single 0/10/20-kg
 * hang sweep calibrates BOTH axes — no separate horizontal pull-out for Z.
 *
 * The applied-load directions in convention coordinates (folded into the fit via
 * `forceDirection`, see CALIBRATION_FORCE_DIRECTION):
 *   in-plane (X): −cosθ  → a hung weight is down-slope, so after the wallGeometry
 *                          rotation it reads −X (a climber hanging is negative).
 *   normal   (Z): +sinθ  → makes a pure vertical hang rotate to X = −W, Z = 0.
 * After the rotation by the same θ (wallGeometry.applyWallDecline) the result is
 * world-frame X (vertical) and Z (horizontal).
 *
 * Requires a tilted wall: at θ = 0 the hang puts no load on the normal axis
 * (sinθ = 0), so Z cannot be calibrated this way — the caller should guard.
 *
 * `rawsXPerStep` / `rawsZPerStep` are the averaged signed-raw readings of the
 * board's X and Z channels at each weight in `weightsKg` (step 0 = 0 kg = offset).
 */
export function computeHangCalibration(
  rawsXPerStep: number[],
  rawsZPerStep: number[],
  weightsKg: number[],
  declineDeg: number,
): { x: { offset: number; scale: number }; z: { offset: number; scale: number } } {
  const t = (declineDeg * Math.PI) / 180
  const x = computeAxisCalibration(rawsXPerStep, weightsKg, -Math.cos(t))
  const z = computeAxisCalibration(rawsZPerStep, weightsKg, Math.sin(t))
  return { x, z }
}

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? ""

function isValidConfig(value: unknown): value is CalibrationConfig {
  if (typeof value !== "object" || value === null) return false
  const cfg = value as Record<string, unknown>
  return (["axisSigns", "axisScales"] as const).every(
    (key) =>
      Array.isArray(cfg[key]) &&
      (cfg[key] as unknown[]).length === 12 &&
      (cfg[key] as unknown[]).every((n) => typeof n === "number" && isFinite(n)),
  )
}

/**
 * Load the persisted calibration into the active store on startup.
 * Tries the backend file first (authoritative, kept in sync on save), then
 * localStorage, then leaves the built-in defaults in place. Always resolves.
 */
export async function loadPersistedCalibration(): Promise<CalibrationConfig> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/calibration`)
    if (res.ok) {
      const data = await res.json()
      if (isValidConfig(data)) {
        setCalibration(data)
        return getCalibration()
      }
    }
  } catch {
    // Backend unreachable (expo / offline) — fall through to localStorage.
  }

  try {
    const stored = localStorage.getItem(CALIBRATION_STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      if (isValidConfig(data)) {
        setCalibration(data)
        return getCalibration()
      }
    }
  } catch {
    // Corrupt / unavailable storage — keep defaults.
  }

  return getCalibration()
}

/**
 * Persist a calibration everywhere: live store, localStorage (for offline
 * reloads), and the backend JSON file (best-effort, so a missing backend never
 * blocks calibration in expo mode).
 */
export async function persistCalibration(cfg: CalibrationConfig): Promise<void> {
  setCalibration(cfg)

  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    // Quota / unavailable — the in-memory store still has the value.
  }

  try {
    await fetch(`${BACKEND_BASE_URL}/api/calibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    })
  } catch {
    // Backend unreachable — fine, localStorage + live store still updated.
  }
}
