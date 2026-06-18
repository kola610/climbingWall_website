import { getCalibration } from "./calibration"
import { applyWallDecline } from "./wallGeometry"

export type ParsedSerialMessage =
  | { type: "sensor"; values: number[]; signedRaw: number[] }
  | { type: "unknown" }

/**
 * Reorders the 4 incoming sensor groups so each physical sensor lines up with
 * the matching GUI component (SENSOR_NAMES order: Left Hand, Right Hand,
 * Left Foot, Right Foot).
 *
 * As of the Method-A migration the Pi streams RAW voltage ratios (tiny, ~1e-6),
 * not Newtons — ALL calibration now happens here. The transform pipeline below
 * (remap -> sign -> offset -> scale) is structurally unchanged; only the meaning
 * of the stored constants changed (see applyGroundOffsets / applyAxisScales).
 *
 * The device streams the four sensor groups (3 values each). The raw group ->
 * body-part wiring was verified empirically by moving each sensor:
 *   group 0 = Left Foot
 *   group 1 = Left Hand
 *   group 2 = Right Foot
 *   group 3 = Right Hand
 *
 * To feed the GUI slots [Left Hand, Right Hand, Left Foot, Right Foot] we pull
 * from groups [1, 3, 0, 2] respectively.
 *
 * This wiring is fixed hardware routing, so it stays a local constant (it is not
 * part of the runtime-calibratable values).
 */
const SENSOR_GROUP_ORDER = [1, 3, 0, 2] as const

function remapSensorGroups(values: number[]): number[] {
  return SENSOR_GROUP_ORDER.flatMap((srcGroup) =>
    values.slice(srcGroup * 3, srcGroup * 3 + 3),
  )
}

/**
 * Per-axis sign correction, applied AFTER remapSensorGroups so the entries are
 * in GUI-slot order: [Left Hand, Right Hand, Left Foot, Right Foot], each as
 * (X, Y, Z).
 *
 * Convention the hardware should report:
 *   pulling away from the wall (toward the person) = +Z
 *   push to the right                              = +Y
 *   push toward the top                            = +X
 *
 * Signs are part of the calibration config but are not edited by the calibration
 * wizard (they are a fixed convention); they are sourced from the store so the
 * whole transform is driven by one place.
 */
function applyAxisSigns(values: number[]): number[] {
  const { axisSigns } = getCalibration()
  return values.map((v, i) => v * axisSigns[i])
}

/**
 * Ground/zero offset per axis, applied AFTER applyAxisSigns so the entries are in
 * GUI-slot order: [Left Hand, Right Hand, Left Foot, Right Foot], each as (X, Y, Z).
 *
 * Since Method A these are the zero-load RAW voltage ratios the hardware reports
 * when no load is applied (tiny ~1e-6 numbers, in signed-raw space). They are
 * subtracted from every incoming sample (BEFORE the axis scale) so the displayed
 * forces are zero-centred at rest. The calibration wizard sets each axis's offset
 * to the averaged signed-raw reading captured at 0 kg.
 */
function applyGroundOffsets(values: number[]): number[] {
  const { groundOffsets } = getCalibration()
  return values.map((v, i) => v - groundOffsets[i])
}

/**
 * Per-axis scale factor, applied AFTER applyGroundOffsets so the entries are in
 * GUI-slot order: [Left Hand, Right Hand, Left Foot, Right Foot], each as (X, Y, Z).
 *
 * Each scale maps (raw − offset) to a force in Newtons. Since Method A the input
 * is a raw voltage ratio (~1e-6), so these scales are large (Newtons per
 * raw-voltage-ratio unit, ~1e6–1e7). The committed defaults are seeded from the
 * Pi's old per-board gains (gain * 9.81 * 0.001, sign included). The calibration
 * wizard derives it as the least-squares slope of force vs. (raw − offset) over a
 * known-weight sweep (0 / 10 / 20 kg), so a real 100 N load reads ~100 N.
 */
function applyAxisScales(values: number[]): number[] {
  const { axisScales } = getCalibration()
  return values.map((v, i) => v * axisScales[i])
}

/**
 * Parses a single complete serial line into a typed message.
 * Keeps the serial routing logic in one testable place, separate from both
 * the transport layer (useSerialPort) and the domain handlers.
 *
 * For sensor lines we expose two arrays:
 *   - `values`:    the fully-processed forces shown in the GUI.
 *   - `signedRaw`: the post-sign, pre-offset, pre-scale values. The calibration
 *                  wizard averages these so its result is independent of the
 *                  offset/scale currently in effect.
 */
export function parseSerialLine(line: string): ParsedSerialMessage {
  // Jump height is no longer reported over serial (Method A): it is computed on
  // the computer from the calibrated force buffer. Only raw sensor lines arrive.
  const values = line.split(",").map((v) => parseFloat(v.trim()))
  if (
    values.length === 12 &&
    values.every((v) => !isNaN(v) && isFinite(v))
  ) {
    const signedRaw = applyAxisSigns(remapSensorGroups(values))
    // Per-board calibrated forces in the SENSOR frame (X = in-plane, Z = normal).
    const sensorForces = applyAxisScales(applyGroundOffsets(signedRaw))
    return {
      type: "sensor",
      // Rotate each board's X/Z by the wall decline angle into the WORLD frame
      // (X = true vertical/up, Z = true horizontal/out). Y is left untouched.
      values: applyWallDecline(sensorForces),
      signedRaw,
    }
  }

  return { type: "unknown" }
}
