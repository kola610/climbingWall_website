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
    return { type: "sensor", values: applyAxisSigns(remapSensorGroups(values)) }
  }

  return { type: "unknown" }
}
