import { getCalibration } from "./calibration"
import { getRuntimeOffset } from "./runtimeOffset"

export type ParsedSerialMessage =
  | { type: "sensor"; values: number[]; signedRaw: number[] }
  | { type: "unknown" }

/**
 * Hardware wiring: the device streams four sensor groups of 3 values each, in
 * the order (verified empirically by loading each sensor):
 *   group 0 = Left Foot, 1 = Left Hand, 2 = Right Foot, 3 = Right Hand
 *
 * The GUI slots are [Left Hand, Right Hand, Left Foot, Right Foot], so we pull
 * from groups [1, 3, 0, 2]. Fixed routing, hence a local constant rather than
 * part of the runtime-calibratable values.
 */
const SENSOR_GROUP_ORDER = [1, 3, 0, 2] as const

function remapSensorGroups(values: number[]): number[] {
  return SENSOR_GROUP_ORDER.flatMap((srcGroup) =>
    values.slice(srcGroup * 3, srcGroup * 3 + 3),
  )
}

/**
 * Per-axis sign correction. Establishes the convention the hardware should
 * report, in GUI-slot order:
 *   pulling away from the wall (toward the person) = +Z
 *   push to the right                              = +Y
 *   push toward the top                            = +X
 */
function applyAxisSigns(values: number[]): number[] {
  const { axisSigns } = getCalibration()
  return values.map((v, i) => v * axisSigns[i])
}

/**
 * Zero-load offset in signed-raw space (tiny ~1e-6 voltage ratios), subtracted
 * before the scale so forces read zero at rest. This is the volatile runtime
 * tare (see runtimeOffset.ts) set by "Zero Sensors" — not persisted calibration.
 * All-zeros until the user tares, i.e. readings are simply un-tared.
 */
function applyRuntimeOffset(values: number[]): number[] {
  const offset = getRuntimeOffset()
  return values.map((v, i) => v - offset[i])
}

/**
 * Per-axis scale mapping (raw − offset) to Newtons. The input is a raw voltage
 * ratio (~1e-6), so these are large (~1e6–1e7 N per raw unit). The wizard
 * derives each as the least-squares slope of force vs. (raw − offset) over a
 * known-weight sweep, so a real 100 N load reads ~100 N.
 */
function applyAxisScales(values: number[]): number[] {
  const { axisScales } = getCalibration()
  return values.map((v, i) => v * axisScales[i])
}

/**
 * Parses one complete serial line (12 comma-separated raw voltage ratios).
 *
 * Exposes two arrays:
 *   - `values`:    fully-processed SENSOR-frame forces (remap → sign → offset →
 *                  scale). This is the canonical frame stored everywhere (live
 *                  buffer, IndexedDB, backend CSV). The wall-decline angle θ is
 *                  NOT applied — world-frame display is an opt-in, UI-only
 *                  rotation done at render time (see wallGeometry).
 *   - `signedRaw`: post-sign, pre-offset, pre-scale. The calibration wizard and
 *                  the tare average these, so their results are independent of
 *                  the offset/scale currently in effect.
 */
export function parseSerialLine(line: string): ParsedSerialMessage {
  const values = line.split(",").map((v) => parseFloat(v.trim()))
  if (values.length === 12 && values.every((v) => !isNaN(v) && isFinite(v))) {
    const signedRaw = applyAxisSigns(remapSensorGroups(values))
    return {
      type: "sensor",
      values: applyAxisScales(applyRuntimeOffset(signedRaw)),
      signedRaw,
    }
  }

  return { type: "unknown" }
}
