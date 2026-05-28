import { useEffect, useMemo } from "react"
import { Line } from "react-chartjs-2"
import type { ChartOptions } from "chart.js"
import { RefreshCw, Clock, Database, Download, ArrowLeftRight, X } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { Button } from "../../ui/button"
import { buildNormChartData, buildComponentChartData } from "../../../utils/dataProcessing"
import { SENSOR_NAMES, MAGNITUDE_COLORS } from "../../../constants/sensor"
import { useRecentRecordings } from "../../../hooks/useRecentRecordings"
import type { ComparisonDataState } from "../../../hooks/useComparisonData"
import { ComparisonView } from "../comparison/ComparisonView"
import type { RecordingMeta } from "../../../utils/recordingApi"
import { buildCsvContent } from "../../../utils/csvExport"

interface RecentRecordingsTabProps {
  /**
   * Increment this after a successful save to trigger an automatic list
   * refresh and auto-select the newly saved recording.
   */
  refreshTrigger: number
  /** Lifted to SensorDashboard so the selection survives tab switches. */
  compareMode: boolean
  onSetCompareMode: (value: boolean) => void
  comparison: ComparisonDataState
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function formatDuration(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem.toFixed(0)}s`
}

// ─── Recording list card item ─────────────────────────────────────────────────

interface RecordingListItemProps {
  rec: RecordingMeta
  /** Single-view selection highlight */
  isSelected: boolean
  /** "A" or "B" badge shown in compare mode */
  compareBadge?: "A" | "B"
  /** Dim the card when compare slots are full and this isn't one of them */
  dimmed?: boolean
  onClick: () => void
}

function RecordingListItem({
  rec,
  isSelected,
  compareBadge,
  dimmed,
  onClick,
}: RecordingListItemProps) {
  const BADGE_STYLE = {
    A: "bg-blue-500 text-white",
    B: "bg-amber-500 text-white",
  }
  const BORDER_STYLE = {
    A: "border-blue-400 bg-blue-50/60",
    B: "border-amber-400 bg-amber-50/60",
  }

  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-4 py-3 rounded-lg border transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compareBadge
          ? BORDER_STYLE[compareBadge]
          : isSelected
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:bg-muted/50",
        dimmed ? "opacity-40 pointer-events-none" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        {/* A / B badge */}
        {compareBadge && (
          <span
            className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${BADGE_STYLE[compareBadge]}`}
          >
            {compareBadge}
          </span>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm truncate">{rec.label}</p>
            <div className="text-right shrink-0 text-xs text-muted-foreground">
              <p>{formatDuration(rec.duration_s)}</p>
              <p>{rec.sample_count.toLocaleString()} pts</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDate(rec.created_at)}
          </p>
        </div>
      </div>

      {isSelected && !compareBadge && (
        <div className="mt-1.5 h-0.5 w-full rounded bg-primary/40" />
      )}
    </button>
  )
}

// ─── Tab component ────────────────────────────────────────────────────────────

export function RecentRecordingsTab({
  refreshTrigger,
  compareMode,
  onSetCompareMode,
  comparison,
}: RecentRecordingsTabProps) {
  const {
    recordings,
    selectedId,
    selectedData,
    listLoading,
    dataLoading,
    error,
    refresh,
    selectRecording,
  } = useRecentRecordings()

  // Load on mount and re-load (selecting newest) whenever a save completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [refreshTrigger])

  const handleToggleCompareMode = () => {
    if (compareMode) {
      comparison.clearAll()
      onSetCompareMode(false)
    } else {
      onSetCompareMode(true)
      // Pre-populate slot A with whatever is currently viewed so the user
      // can immediately pick a second recording to compare against.
      if (selectedId) comparison.toggleId(selectedId)
    }
  }

  // Chart options shared between single-view and comparison charts.
  const chartOptions = useMemo((): ChartOptions<"line"> => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 0,
        title: { display: true, text: "Force (N)" },
        ticks: { maxTicksLimit: 6 },
      },
      x: {
        type: "linear",
        title: { display: true, text: "Sample" },
        ticks: { maxTicksLimit: 10 },
      },
    },
    animation: { duration: 0 },
    plugins: {
      legend: { position: "top" },
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          title: (items) => `Sample: ${items[0]?.parsed?.x ?? ""}`,
        },
      },
    },
    interaction: { mode: "nearest", axis: "x", intersect: false },
  }), [])

  const selectedMeta = recordings.find((r) => r.id === selectedId)

  const handleExportSelected = () => {
    if (!selectedMeta || selectedData.length === 0) return
    const csvContent = buildCsvContent(selectedData)
    if (!csvContent) return

    const safeLabel = selectedMeta.label
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "recording"

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${safeLabel}_${selectedMeta.id}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">

      {/* ── Recording list card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Recent Recordings</CardTitle>
              {recordings.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({recordings.length})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Compare toggle */}
              {recordings.length >= 2 && (
                <Button
                  variant={compareMode ? "default" : "outline"}
                  size="sm"
                  onClick={handleToggleCompareMode}
                  className="h-7 px-2 gap-1.5 text-xs"
                >
                  {compareMode ? (
                    <><X className="h-3 w-3" /> Exit Compare</>
                  ) : (
                    <><ArrowLeftRight className="h-3 w-3" /> Compare</>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={refresh}
                disabled={listLoading}
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3 w-3 ${listLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {compareMode && (
            <p className="text-xs text-muted-foreground mt-1">
              Click recordings to assign them to{" "}
              <span className="font-semibold text-blue-600">A</span> and{" "}
              <span className="font-semibold text-amber-600">B</span>. Click again to remove.
            </p>
          )}
        </CardHeader>

        <CardContent>
          {error && !listLoading && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {!listLoading && recordings.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Database className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No recordings saved yet.</p>
              <p className="text-xs text-muted-foreground">
                Pause a recording and click <strong>Save Recording</strong> above.
              </p>
            </div>
          )}

          {recordings.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {recordings.map((rec) => {
                // Resolve compare badge and dimmed state
                const badge = compareMode
                  ? comparison.slotA?.id === rec.id
                    ? "A" as const
                    : comparison.slotB?.id === rec.id
                      ? "B" as const
                      : undefined
                  : undefined

                const bothFull = !!(comparison.slotA && comparison.slotB)
                const dimmed = compareMode && bothFull && !badge

                return (
                  <RecordingListItem
                    key={rec.id}
                    rec={rec}
                    isSelected={!compareMode && rec.id === selectedId}
                    compareBadge={badge}
                    dimmed={dimmed}
                    onClick={() =>
                      compareMode
                        ? comparison.toggleId(rec.id)
                        : selectRecording(rec.id)
                    }
                  />
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Compare view ── */}
      {compareMode && (
        <ComparisonView
          slotA={comparison.slotA}
          slotB={comparison.slotB}
          metaA={recordings.find((r) => r.id === comparison.slotA?.id) ?? null}
          metaB={recordings.find((r) => r.id === comparison.slotB?.id) ?? null}
          chartOptions={chartOptions}
        />
      )}

      {/* ── Single recording view (only shown when not comparing) ── */}
      {!compareMode && selectedId && (
        <>
          {/* Header row */}
          {selectedMeta && (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground px-1">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  <span className="font-medium text-foreground">
                    {selectedMeta.label}
                  </span>
                  {" · "}
                  {formatDate(selectedMeta.created_at)}
                  {" · "}
                  {formatDuration(selectedMeta.duration_s)}
                  {" · "}
                  {selectedMeta.sample_count.toLocaleString()} samples
                  {selectedMeta.sample_count > 1000 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (showing ~1 000 points)
                    </span>
                  )}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportSelected}
                disabled={dataLoading || selectedData.length === 0}
                className="gap-1.5 shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
          )}

          {dataLoading && (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading chart data…</span>
              </CardContent>
            </Card>
          )}

          {!dataLoading && selectedData.length > 0 && (
            <>
              {/* Overall Force */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Overall Force — All Sensors
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Total force on each sensor (Euclidean magnitude)
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="h-[320px]">
                    <Line data={buildNormChartData(selectedData)} options={chartOptions} />
                  </div>
                </CardContent>
              </Card>

              {/* Force by Direction — 2×2 grid */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Force by Direction — per Sensor
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    X, Y, Z components for each sensor
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {SENSOR_NAMES.map((name, sensorIndex) => (
                      <div key={sensorIndex} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: MAGNITUDE_COLORS[sensorIndex].border }}
                          />
                          <h3 className="text-sm font-semibold">{name}</h3>
                        </div>
                        <div className="h-[220px]">
                          <Line
                            data={buildComponentChartData(selectedData, sensorIndex)}
                            options={chartOptions}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {!dataLoading && selectedData.length === 0 && !error && (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">No data in this recording.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
