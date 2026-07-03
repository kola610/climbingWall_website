import { useEffect, useState } from "react"
import { Button } from "../ui/button"
import {
  X,
  FolderOpen,
  Save,
  Copy,
  Pencil,
  Trash2,
  Check,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import type { CalibrationConfig } from "../../utils/calibration"
import type { CalibrationProfile } from "../../utils/calibrationProfiles"
import type { UseCalibrationProfilesReturn } from "../../hooks/useCalibrationProfiles"

interface CalibrationProfilesModalProps {
  open: boolean
  onClose: () => void
  profilesApi: UseCalibrationProfilesReturn
  /** The current active calibration — what "Save as new" / "Update" captures. */
  activeConfig: CalibrationConfig
}

/** True when the active calibration matches the profile's stored config. */
function configMatches(active: CalibrationConfig, profile: CalibrationProfile): boolean {
  return (
    active.axisSigns.length === profile.axisSigns.length &&
    active.axisScales.length === profile.axisScales.length &&
    active.axisSigns.every((v, i) => v === profile.axisSigns[i]) &&
    active.axisScales.every((v, i) => v === profile.axisScales[i])
  )
}

/**
 * Lightweight profile browser/manager. Save the current calibration as a new
 * profile, or pick one to apply it as the active calibration; per row, load /
 * duplicate / rename / delete (delete is two-step to prevent accidents).
 *
 * Deliberately a thin overlay (no Radix Dialog in the project) layered above the
 * calibration wizard via a higher z-index, so it can be opened from inside the
 * wizard or straight from the toolbar.
 */
export function CalibrationProfilesModal({
  open,
  onClose,
  profilesApi,
  activeConfig,
}: CalibrationProfilesModalProps) {
  const { profiles, activeName, loading, error, setError } = profilesApi

  const [newName, setNewName] = useState("")
  const [rename, setRename] = useState<{ name: string; value: string } | null>(null)
  const [duplicate, setDuplicate] = useState<{ name: string; value: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Reset transient UI each time the modal opens.
  useEffect(() => {
    if (open) {
      setNewName("")
      setRename(null)
      setDuplicate(null)
      setConfirmDelete(null)
      setError(null)
    }
  }, [open, setError])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const activeProfile = profiles.find((p) => p.name === activeName) ?? null
  const activeModified = activeProfile ? !configMatches(activeConfig, activeProfile) : false

  const handleSaveNew = async () => {
    const name = newName.trim()
    if (!name) return
    if (await profilesApi.saveAsNew(name)) setNewName("")
  }

  const handleRename = async () => {
    if (!rename || !rename.value.trim()) return
    const target = profiles.find((p) => p.name === rename.name)
    if (target && (await profilesApi.rename(target, rename.value))) setRename(null)
  }

  const handleDuplicate = async () => {
    if (!duplicate || !duplicate.value.trim()) return
    const target = profiles.find((p) => p.name === duplicate.name)
    if (target && (await profilesApi.duplicate(target, duplicate.value))) setDuplicate(null)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Calibration Profiles</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Save the current calibration ── */}
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="text-sm font-medium">Save current calibration</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveNew()
                }}
                placeholder="New profile name"
                maxLength={80}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button size="sm" className="gap-1.5" disabled={!newName.trim()} onClick={handleSaveNew}>
                <Save className="h-3.5 w-3.5" /> Save as new
              </Button>
            </div>
            {activeProfile && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => profilesApi.saveChangesTo(activeProfile.name)}
              >
                <Save className="h-3.5 w-3.5" />
                Update “{activeProfile.name}”{activeModified ? " (unsaved changes)" : ""}
              </Button>
            )}
          </div>

          {/* ── Saved profiles ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Saved profiles</div>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {!loading && profiles.length === 0 && (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                No saved profiles yet. Save the current calibration above to create one.
              </p>
            )}

            <div className="space-y-2">
              {profiles.map((profile) => {
                const isActive = profile.name === activeName
                const isRenaming = rename?.name === profile.name
                const isDuplicating = duplicate?.name === profile.name
                const isConfirmingDelete = confirmDelete === profile.name
                return (
                  <div key={profile.name} className="rounded-lg border bg-muted/10 p-3">
                    <div className="flex items-center gap-2">
                      {isRenaming ? (
                        <input
                          autoFocus
                          type="text"
                          value={rename.value}
                          maxLength={80}
                          onChange={(e) => setRename({ name: profile.name, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename()
                            if (e.key === "Escape") setRename(null)
                          }}
                          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-sm font-medium">{profile.name}</span>
                          {isActive && (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              <CheckCircle2 className="h-3 w-3" />
                              {activeModified ? "Active · modified" : "Active"}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Per-row actions */}
                      {isRenaming ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button size="sm" className="h-7 gap-1" onClick={handleRename}>
                            <Check className="h-3.5 w-3.5" /> Save
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7" onClick={() => setRename(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7"
                            disabled={isActive && !activeModified}
                            title="Apply this profile as the active calibration"
                            onClick={() => profilesApi.select(profile)}
                          >
                            Load
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Duplicate"
                            onClick={() => {
                              setDuplicate({ name: profile.name, value: `${profile.name} copy` })
                              setConfirmDelete(null)
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Rename"
                            onClick={() => {
                              setRename({ name: profile.name, value: profile.name })
                              setConfirmDelete(null)
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                            title="Delete"
                            onClick={() => {
                              setConfirmDelete(profile.name)
                              setDuplicate(null)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Inline duplicate form */}
                    {isDuplicating && (
                      <div className="mt-2 flex items-center gap-2 border-t pt-2">
                        <input
                          autoFocus
                          type="text"
                          value={duplicate.value}
                          maxLength={80}
                          placeholder="Name for the copy"
                          onChange={(e) => setDuplicate({ name: profile.name, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleDuplicate()
                            if (e.key === "Escape") setDuplicate(null)
                          }}
                          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <Button size="sm" className="h-7 gap-1" disabled={!duplicate.value.trim()} onClick={handleDuplicate}>
                          <Copy className="h-3.5 w-3.5" /> Duplicate
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => setDuplicate(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}

                    {/* Inline delete confirmation */}
                    {isConfirmingDelete && (
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-red-200 pt-2">
                        <span className="text-xs text-red-700">
                          Delete “{profile.name}” permanently?
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            className="h-7 gap-1 bg-red-600 text-white hover:bg-red-700"
                            onClick={async () => {
                              await profilesApi.remove(profile)
                              setConfirmDelete(null)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7" onClick={() => setConfirmDelete(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
