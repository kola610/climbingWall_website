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

/** `limit = 0` returns every saved recording; the default is the recent few. */
export async function fetchRecentRecordings(limit?: number): Promise<RecordingMeta[]> {
  const query = limit === undefined ? "" : `?limit=${limit}`
  const response = await fetch(`${BACKEND_BASE_URL}/api/recordings${query}`)
  if (!response.ok) throw new Error("Failed to load recordings.")
  return response.json()
}

/**
 * Chart data for one recording, downsampled by the backend to ~1000 points.
 *
 * `from`/`to` are optional 0-based row bounds. Passing a narrow window is how
 * zoom gains real resolution: the backend cuts to the window *before* thinning,
 * so a short window comes back at (or near) full sample rate. Without them the
 * whole recording is thinned to the same ~1000 points.
 */
export async function fetchRecordingData(
  id: string,
  from?: number,
  to?: number,
): Promise<SensorReading[]> {
  const params = new URLSearchParams()
  if (from !== undefined) params.set("from", String(Math.round(from)))
  if (to !== undefined) params.set("to", String(Math.round(to)))
  const query = params.toString()

  const response = await fetch(
    `${BACKEND_BASE_URL}/api/recordings/${encodeURIComponent(id)}/data${query ? `?${query}` : ""}`,
  )
  if (!response.ok) throw new Error("Failed to load recording data.")
  const payload = await response.json()
  return payload.readings as SensorReading[]
}

/**
 * Direct link to the stored CSV — every sample, nothing thinned. Used as an
 * anchor href so the browser downloads the real file rather than the frontend
 * re-serialising the downsampled (and possibly zoom-narrowed) chart data it
 * happens to be holding.
 */
export function recordingDownloadUrl(id: string): string {
  return `${BACKEND_BASE_URL}/api/recordings/${encodeURIComponent(id)}/download`
}

export async function deleteRecording(id: string): Promise<void> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/api/recordings/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload?.error ?? "Failed to delete recording.")
  }
}

/** Rename = rewrite the display label only; the file and its id are untouched. */
export async function renameRecording(
  id: string,
  label: string,
): Promise<RecordingMeta> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/api/recordings/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload?.error ?? "Failed to rename recording.")
  }
  return response.json()
}
