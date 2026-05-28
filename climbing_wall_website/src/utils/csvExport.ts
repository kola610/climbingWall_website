import type { SensorReading } from "../types/sensor"
import { SENSOR_NAMES, FORCE_COMPONENTS } from "../constants/sensor"

/**
 * Serialises sensor readings to CSV and triggers a browser download.
 * Uses Blob + object URL to support large datasets without hitting URI limits.
 */
export function buildCsvContent(data: SensorReading[]): string {
  if (data.length === 0) return ""

  const headers =
    "Timestamp,Sample," +
    SENSOR_NAMES.map((sensor) =>
      FORCE_COMPONENTS.map((component) => `${sensor}_${component}`).join(","),
    ).join(",") +
    "\n"

  const rows = data
    .map(
      (r) =>
        `${new Date(r.timestamp).toISOString()},${r.sampleNumber},${r.values.join(",")}`,
    )
    .join("\n")

  return headers + rows
}

export function exportToCsv(data: SensorReading[]): void {
  const csvContent = buildCsvContent(data)
  if (!csvContent) return

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `force_data_${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
