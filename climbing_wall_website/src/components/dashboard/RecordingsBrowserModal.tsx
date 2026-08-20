import { useEffect, useState } from "react"
import {
  X, FolderOpen, Search, Pencil, Trash2, Download, CheckCircle2, AlertTriangle, Loader2,
} from "lucide-react"

import { Button } from "../ui/button"
import {
  fetchRecentRecordings,
  recordingDownloadUrl,
  type RecordingMeta,
} from "../../utils/recordingApi"

interface RecordingsBrowserModalProps {
  open: boolean
  onClose: () => void
  /** Currently loaded recording, marked in the list. */
  selectedId: string | null
  onSelect: (rec: RecordingMeta) => void
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, label: string) => Promise<void>
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function formatDuration(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`
}

/**
 * Full recordings archive — everything ever saved, with search and management.
 *
 * The tab itself only lists the most recent few so it stays readable; older
 * captures are reachable only from here. Fetches its own list (limit=0) on
 * open, so the tab's recent-5 list is untouched. Same thin-overlay pattern as
 * CalibrationProfilesModal — the project has no Radix Dialog — including the
 * two-step delete.
 */
export function RecordingsBrowserModal({
  open,
  onClose,
  selectedId,
  onSelect,
  onDelete,
  onRename,
}: RecordingsBrowserModalProps) {
  const [query, setQuery] = useState("")
  const [recordings, setRecordings] = useState<RecordingMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // Bumped after a rename or delete to re-read the list from the backend.
  const [reloadToken, setReloadToken] = useState(0)

  // Refetch on every open — a recording saved since the last open must show up.
  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    let cancelled = false
    fetchRecentRecordings(0)
      .then((list) => { if (!cancelled) setRecordings(list) })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load recordings.")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, reloadToken])

  // Reset transient UI each time the modal opens.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setRename(null)
    setConfirmDelete(null)
  }, [open])

  // Close on Escape — but let an open inline form swallow it first.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (rename) setRename(null)
      else if (confirmDelete) setConfirmDelete(null)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose, rename, confirmDelete])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const visible = q ? recordings.filter((r) => r.label.toLowerCase().includes(q)) : recordings

  const commitRename = async () => {
    if (!rename || !rename.value.trim()) return
    const { id, value } = rename
    setRename(null)
    await onRename(id, value.trim())
    setReloadToken((n) => n + 1)
  }

  const commitDelete = async (id: string) => {
    setConfirmDelete(null)
    await onDelete(id)
    setReloadToken((n) => n + 1)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            <h3 className="text-lg font-semibold">All Recordings</h3>
            {recordings.length > 0 && (
              <span className="text-sm text-muted-foreground">({recordings.length})</span>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              placeholder="Search recordings…"
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {loading && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}

          {!loading && visible.length === 0 && !error && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {recordings.length === 0
                ? "No recordings saved yet."
                : `Nothing matches “${query}”.`}
            </p>
          )}

          <div className="space-y-2">
            {visible.map((rec) => {
              const isLoaded = rec.id === selectedId
              const isRenaming = rename?.id === rec.id
              const isConfirmingDelete = confirmDelete === rec.id

              return (
                <div
                  key={rec.id}
                  className={`rounded-lg border p-3 ${isLoaded ? "border-primary bg-primary/5" : "bg-muted/10"}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{rec.label}</span>
                        {isLoaded && (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Loaded
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(rec.created_at)} · {formatDuration(rec.duration_s)} ·{" "}
                        {rec.sample_count.toLocaleString()} samples
                      </p>
                    </div>

                    {!isRenaming && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={isLoaded}
                          title="Plot this recording"
                          onClick={() => {
                            onSelect(rec)
                            onClose()
                          }}
                        >
                          Load
                        </Button>
                        {/* Direct link to the stored CSV — all samples, not the
                            chart preview, which is thinned and may be zoomed. */}
                        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                          <a
                            href={recordingDownloadUrl(rec.id)}
                            download
                            title={`Download all ${rec.sample_count.toLocaleString()} samples`}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Rename"
                          onClick={() => {
                            setRename({ id: rec.id, value: rec.label })
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
                            setConfirmDelete(rec.id)
                            setRename(null)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Inline rename — the display label only; the file keeps its name. */}
                  {isRenaming && (
                    <div className="mt-2 flex items-center gap-2 border-t pt-2">
                      <input
                        autoFocus
                        type="text"
                        value={rename.value}
                        maxLength={80}
                        placeholder="New name"
                        onChange={(e) => setRename({ id: rec.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename()
                          if (e.key === "Escape") setRename(null)
                        }}
                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button size="sm" className="h-7 gap-1" disabled={!rename.value.trim()} onClick={commitRename}>
                        <Pencil className="h-3.5 w-3.5" /> Rename
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => setRename(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}

                  {/* Inline delete confirmation */}
                  {isConfirmingDelete && (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-red-200 pt-2">
                      <span className="text-xs text-red-700">
                        Delete “{rec.label}” permanently? The CSV is removed from disk.
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          className="h-7 gap-1 bg-red-600 text-white hover:bg-red-700"
                          onClick={() => commitDelete(rec.id)}
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
  )
}
