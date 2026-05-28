export type ParsedSerialMessage =
  | { type: "sensor"; values: number[] }
  | { type: "jump"; value: number }
  | { type: "unknown" }

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
    return { type: "sensor", values }
  }

  return { type: "unknown" }
}
