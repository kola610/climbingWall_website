export type ParsedSerialMessage =
  | { type: "sensor"; values: number[] }
  | { type: "jump"; value: number }
  | { type: "unknown" }

/**
 * Reorders the 4 incoming sensor groups so each physical sensor lines up with
 * the matching GUI component (SENSOR_NAMES order: Left Hand, Right Hand,
 * Left Foot, Right Foot).
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
 * Right Hand already matches this convention; the others need axes inverted:
 *   Left Hand  -> flip X, Y
 *   Left Foot  -> flip X, Y, Z
 *   Right Foot -> flip Y
 */
const SENSOR_AXIS_SIGNS = [
  -1, -1,  1, // Left Hand:  flip X, Y
   1,  1,  1, // Right Hand: unchanged
  -1, -1, -1, // Left Foot:  flip X, Y, Z
   1, -1,  1, // Right Foot: flip Y
] as const

function applyAxisSigns(values: number[]): number[] {
  return values.map((v, i) => v * SENSOR_AXIS_SIGNS[i])
}

/**
 * Hardcoded ground/zero offset per axis, applied AFTER applyAxisSigns so the
 * entries are in GUI-slot order: [Left Hand, Right Hand, Left Foot, Right Foot],
 * each as (X, Y, Z).
 *
 * These are the resting "ground" force values the hardware reports when no load
 * is applied. They are subtracted from every incoming sample (BEFORE the axis
 * scale) so the displayed forces are zero-centred at rest. Recalibrated from a
 * fresh resting capture: each value = previous_offset + residual / axis_scale,
 * so that (raw - offset) * scale = 0 at rest while leaving the scales untouched.
 *   Left Hand:  X -69.900,   Y  74.670,  Z 142.295
 *   Right Hand: X -157.414,  Y -27.388,  Z  18.695
 *   Left Foot:  X -340.014,  Y -56.506,  Z 150.334
 *   Right Foot: X -1354.482, Y -57.776,  Z  51.283
 */
const SENSOR_GROUND_OFFSETS = [
  -69.900,   74.670,  142.295, // Left Hand
  -157.414, -27.388,   18.695, // Right Hand
  -340.014, -56.506,  150.334, // Left Foot
  -1354.482, -57.776,  51.283, // Right Foot
] as const

function applyGroundOffsets(values: number[]): number[] {
  return values.map((v, i) => v - SENSOR_GROUND_OFFSETS[i])
}

/**
 * Per-axis scale factor, applied AFTER applyGroundOffsets so the entries are in
 * GUI-slot order: [Left Hand, Right Hand, Left Foot, Right Foot], each as
 * (X, Y, Z).
 *
 * Several X channels are mis-scaled relative to reality, so each is corrected
 * to make a real 100 N change display as ~100 N:
 *   Left Hand  X: 100 N reads as ~33 N  -> multiply by 3.3
 *   Left Foot  X: 100 N reads as ~180 N -> divide by 1.8
 *   Right Foot X: 100 N reads as ~700 N -> divide by 7
 * All other axes are left unchanged.
 */
const SENSOR_AXIS_SCALES = [
  3.3, 1, 26/45,     // Left Hand:  multiply X by 3.3
  1, 1, 26/43,       // Right Hand
  1 / 1.8, 1, 26/55, // Left Foot:  divide X by 1.8
  1 / 7, 1, 26/70,   // Right Foot: divide X by 7
] as const

function applyAxisScales(values: number[]): number[] {
  return values.map((v, i) => v * SENSOR_AXIS_SCALES[i])
}

/**
 * Parses a single complete serial line into a typed message.
 * Keeps the serial routing logic in one testable place, separate from both
 * the transport layer (useSerialPort) and the domain handlers.
 */
export function parseSerialLine(line: string): ParsedSerialMessage {
  const jumpMatch = line.match(/jump:\s+(\d+)/i)
  if (jumpMatch) {
    return { type: "jump", value: parseInt(jumpMatch[1], 10) }
  }

  const values = line.split(",").map((v) => parseFloat(v.trim()))
  if (
    values.length === 12 &&
    values.every((v) => !isNaN(v) && isFinite(v))
  ) {
    return {
      type: "sensor",
      values: applyAxisScales(
        applyGroundOffsets(applyAxisSigns(remapSensorGroups(values))),
      ),
    }
  }

  return { type: "unknown" }
}
