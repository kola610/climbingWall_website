import { useCallback, useEffect, useState } from "react"
import type { UseCalibrationReturn } from "./useCalibration"
import {
  type CalibrationProfile,
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
} from "../utils/calibrationProfiles"

/**
 * localStorage label of the profile the active calibration was last loaded
 * from / saved as. Purely a UI hint (the authoritative active calibration is
 * calibration_settings.json); it lets the "Active" badge survive a reload.
 */
const ACTIVE_PROFILE_KEY = "activeCalibrationProfile"

/**
 * Owns the calibration-profile library and the "which profile is active" label.
 *
 * Separation of concerns:
 *   - useCalibration       : the single ACTIVE calibration (switches + scales),
 *                            applied live and persisted to calibration_settings.json.
 *   - useCalibrationProfiles: the named LIBRARY of calibrations in the backend.
 *
 * Selecting a profile applies its config to the active calibration via
 * `calibration.restoreCalibration` (which persists everywhere immediately).
 * Saving captures the current active `calibration.config` under a name. Offsets
 * are never involved — they are the volatile runtime tare.
 */
export function useCalibrationProfiles(calibration: UseCalibrationReturn) {
  const [profiles, setProfiles] = useState<CalibrationProfile[]>([])
  const [activeName, setActiveNameState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_PROFILE_KEY)
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setActiveName = useCallback((name: string | null) => {
    setActiveNameState(name)
    try {
      if (name) localStorage.setItem(ACTIVE_PROFILE_KEY, name)
      else localStorage.removeItem(ACTIVE_PROFILE_KEY)
    } catch {
      // Non-fatal — the in-memory label still drives the UI this session.
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProfiles(await fetchProfiles())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calibration profiles.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Run a mutating action, surface any error, and report success so callers can
  // clear inline inputs only when the action actually went through.
  const run = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.")
      return false
    }
  }, [])

  /** Save the current active calibration as a brand-new profile. */
  const saveAsNew = useCallback(
    (name: string) =>
      run(async () => {
        await createProfile(name.trim(), calibration.config)
        setActiveName(name.trim())
        await refresh()
      }),
    [run, calibration.config, setActiveName, refresh],
  )

  /** Write the current active calibration back to an existing profile. */
  const saveChangesTo = useCallback(
    (name: string) =>
      run(async () => {
        await updateProfile(name, name, calibration.config)
        setActiveName(name)
        await refresh()
      }),
    [run, calibration.config, setActiveName, refresh],
  )

  /** Make a profile the active calibration. */
  const select = useCallback(
    (profile: CalibrationProfile) =>
      run(async () => {
        calibration.restoreCalibration({
          axisSigns: profile.axisSigns,
          axisScales: profile.axisScales,
        })
        setActiveName(profile.name)
      }),
    [run, calibration, setActiveName],
  )

  /**
   * Clone a profile's settings into a new name (original untouched) and make the
   * copy active, so the user can immediately recalibrate the copy independently.
   */
  const duplicate = useCallback(
    (source: CalibrationProfile, newName: string) =>
      run(async () => {
        const config = { axisSigns: source.axisSigns, axisScales: source.axisScales }
        await createProfile(newName.trim(), config)
        calibration.restoreCalibration(config)
        setActiveName(newName.trim())
        await refresh()
      }),
    [run, calibration, setActiveName, refresh],
  )

  /**
   * Rename a profile, keeping its calibration values untouched. Changing a
   * profile's VALUES is deliberately not offered as raw number entry — the only
   * way to change a calibration is the wizard (load the profile, recalibrate
   * with weights, then save the changes back).
   */
  const rename = useCallback(
    (profile: CalibrationProfile, newName: string) =>
      run(async () => {
        await updateProfile(profile.name, newName.trim(), {
          axisSigns: profile.axisSigns,
          axisScales: profile.axisScales,
        })
        if (activeName === profile.name) setActiveName(newName.trim())
        await refresh()
      }),
    [run, activeName, setActiveName, refresh],
  )

  const remove = useCallback(
    (profile: CalibrationProfile) =>
      run(async () => {
        await deleteProfile(profile.name)
        if (activeName === profile.name) setActiveName(null)
        await refresh()
      }),
    [run, activeName, setActiveName, refresh],
  )

  return {
    profiles,
    activeName,
    loading,
    error,
    setError,
    refresh,
    saveAsNew,
    saveChangesTo,
    select,
    duplicate,
    rename,
    remove,
  }
}

export type UseCalibrationProfilesReturn = ReturnType<typeof useCalibrationProfiles>
