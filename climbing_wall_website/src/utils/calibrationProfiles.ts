import type { CalibrationConfig } from "./calibration"

/**
 * Client for the named calibration-profile API (backend/app.py).
 *
 * A profile is a persisted calibration config (axis switches + scales) under a
 * user-given name — the durable library of calibrations. The currently *active*
 * calibration is still the single `/api/calibration` document; "selecting" a
 * profile just restores its config there. Runtime offsets are never part of a
 * profile (they are the volatile tare, see runtimeOffset.ts).
 */

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? ""
const PROFILES_URL = `${BACKEND_BASE_URL}/api/calibration/profiles`

export interface CalibrationProfile extends CalibrationConfig {
  name: string
}

/**
 * True when the active calibration matches the profile's stored config — used to
 * decide whether the active profile has unsaved changes ("Active · modified").
 */
export function configMatchesProfile(
  active: CalibrationConfig,
  profile: CalibrationProfile,
): boolean {
  return (
    active.axisSigns.length === profile.axisSigns.length &&
    active.axisScales.length === profile.axisScales.length &&
    active.axisSigns.every((v, i) => v === profile.axisSigns[i]) &&
    active.axisScales.every((v, i) => v === profile.axisScales[i])
  )
}

/** Throw an Error carrying the backend's message (or a fallback) for a failed response. */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  const payload = await res.json().catch(() => null)
  const message =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : fallback
  throw new Error(message)
}

const body = (name: string, config: CalibrationConfig) =>
  JSON.stringify({ name, axisSigns: config.axisSigns, axisScales: config.axisScales })

export async function fetchProfiles(): Promise<CalibrationProfile[]> {
  const res = await fetch(PROFILES_URL)
  if (!res.ok) await throwApiError(res, "Failed to load calibration profiles.")
  const data = await res.json()
  return (data?.profiles ?? []) as CalibrationProfile[]
}

export async function createProfile(
  name: string,
  config: CalibrationConfig,
): Promise<CalibrationProfile> {
  const res = await fetch(PROFILES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body(name, config),
  })
  if (!res.ok) await throwApiError(res, "Failed to save profile.")
  return res.json()
}

/** Write `config` back to `originalName`, optionally renaming it to `name`. */
export async function updateProfile(
  originalName: string,
  name: string,
  config: CalibrationConfig,
): Promise<CalibrationProfile> {
  const res = await fetch(`${PROFILES_URL}/${encodeURIComponent(originalName)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body(name, config),
  })
  if (!res.ok) await throwApiError(res, "Failed to update profile.")
  return res.json()
}

export async function deleteProfile(name: string): Promise<void> {
  const res = await fetch(`${PROFILES_URL}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  })
  if (!res.ok) await throwApiError(res, "Failed to delete profile.")
}
