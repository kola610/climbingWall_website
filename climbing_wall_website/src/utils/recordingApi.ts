import type { SensorReading } from "../types/sensor"
import { getWallDeclineDeg } from "./wallGeometry"

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? ""

interface SaveRecordingResponse {
  message: string
  filename: string
  path: string
}

export interface RecordingMeta {
  id: string
  filename: string
  created_at: string   // ISO-8601
  sample_count: number
  duration_s: number
  label: string
  /**
   * Wall tilt angle θ (degrees) the wall was at during this capture. Pure
   * metadata — the stored CSV values are NOT rotated by it. Used to prefill the
   * world-frame view's angle field as a convenience.
   */
  wall_decline_deg?: number
}

export async function saveRecordingToBackend(
  readings: SensorReading[],
  label?: string,
): Promise<SaveRecordingResponse> {
  const trimmed = label?.trim() ?? ""
  const response = await fetch(`${BACKEND_BASE_URL}/api/recordings/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: trimmed,           // human-readable display name (stored as-is)
      filename: trimmed,        // used as filename prefix (backend sanitises it)
      readings,                 // canonical SENSOR-frame Newtons (not rotated)
      // The wall tilt active at capture time — stored as metadata only, so the
      // world-frame view can prefill its angle field. The stored values stay
      // sensor frame regardless of this.
      wall_decline_deg: getWallDeclineDeg(),
    }),
  })
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}))
    throw new Error(errorPayload?.error ?? "Failed to save recording.")
  }
  return response.json()
}

export async function fetchRecentRecordings(): Promise<RecordingMeta[]> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/recordings`)
  if (!response.ok) throw new Error("Failed to load recordings.")
  return response.json()
}

export async function fetchRecordingData(id: string): Promise<SensorReading[]> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/api/recordings/${encodeURIComponent(id)}/data`,
  )
  if (!response.ok) throw new Error("Failed to load recording data.")
  const payload = await response.json()
  return payload.readings as SensorReading[]
}
