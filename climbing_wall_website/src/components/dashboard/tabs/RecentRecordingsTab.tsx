import { useEffect, useMemo, useState } from "react"
import { Line } from "react-chartjs-2"
import type { ChartOptions } from "chart.js"
import {
  RefreshCw, Clock, Database, Download, ArrowLeftRight, X,
  FolderOpen, Search, ZoomOut,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { Button } from "../../ui/button"
import { Slider } from "../../ui/slider"
import { buildNormChartData, buildComponentChartData } from "../../../utils/dataProcessing"
import { SENSOR_NAMES, MAGNITUDE_COLORS } from "../../../constants/sensor"
import { useRecentRecordings } from "../../../hooks/useRecentRecordings"
import type { ComparisonDataState } from "../../../hooks/useComparisonData"
import { ComparisonView } from "../comparison/ComparisonView"
import { RecordingsBrowserModal } from "../RecordingsBrowserModal"
import { recordingDownloadUrl, type RecordingMeta } from "../../../utils/recordingApi"
import { BASE_CHART_OPTIONS } from "../../../utils/chartOptions"
import { toDisplayFrameReadings } from "../../../utils/wallGeometry"

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
    sampleWindow,
    listLoading,
    dataLoading,
    error,
    refresh,
    selectRecording,
    loadWindow,
    removeRecording,
    relabelRecording,
  } = useRecentRecordings()

  // World-frame view for the recordings tab. Default is the canonical sensor
  // frame; the world view rotates by the wall tilt that was recorded WITH this
  // capture (meta.wall_decline_deg) — the user does not pick the angle, it is a
  // known property of the recording. The transformation is UI-only.
  const [worldView, setWorldView] = useState(false)

  // The list above only holds the recent few; older captures are picked here.
  const [browserOpen, setBrowserOpen] = useState(false)

  // Load on mount and re-load (selecting newest) whenever a save completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [refreshTrigger])

  // Reset to the sensor view whenever the selected recording changes.
  useEffect(() => { setWorldView(false) }, [selectedId])

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
  // The norm charts plot Euclidean magnitudes (always ≥ 0), so anchoring the
  // y-axis at 0 is desirable; the top is left unset so Chart.js auto-scales it
  // to the largest value.
  const chartOptions = useMemo((): ChartOptions<"line"> => ({
    ...BASE_CHART_OPTIONS,
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
  }), [])

  // Options for the per-sensor X/Y/Z direction charts. These plot raw force
  // components, which can be negative, so the y-axis must NOT be floored at 0 —
  // otherwise negative excursions get clipped and become invisible. Leaving both
  // min and max unset lets Chart.js auto-scale to fit the full range in either
  // direction.
  const componentChartOptions = useMemo((): ChartOptions<"line"> => ({
    ...chartOptions,
    scales: {
      ...chartOptions.scales,
      y: {
        title: { display: true, text: "Force (N)" },
        ticks: { maxTicksLimit: 6 },
      },
    },
  }), [chartOptions])

  const selectedMeta = recordings.find((r) => r.id === selectedId)

  // The grid stays the five most recent, always. Loading an older capture from
  // the archive modal adds its metadata to `recordings` so the header and the
  // compare labels resolve — but it must not push a recent capture out of the
  // list, so everything render-facing goes through `listed`.
  const listed = useMemo(
    () =>
      [...recordings]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5),
    [recordings],
  )

  // ── Zoom window ──
  // The range is row positions into the recording. Committed on release rather
  // than on every drag step: each fetch re-reads the whole CSV on the backend,
  // so a live-updating slider would fire hundreds of full-file reads.
  const totalRows = selectedMeta?.sample_count ?? 0
  const [range, setRange] = useState<[number, number]>([0, 0])

  useEffect(() => { setRange([0, totalRows]) }, [selectedId, totalRows])

  // Pointless below the cap, where nothing is thinned in the first place.
  const zoomable = totalRows > 1000
  const windowRows = sampleWindow ? sampleWindow.to - sampleWindow.from : totalRows
  // How much of the loaded window actually made it onto the chart.
  const shownRatio =
    selectedData.length > 0 && windowRows > selectedData.length
      ? Math.round(windowRows / selectedData.length)
      : 1

  // The recording is stored in the canonical sensor frame. The world view is a
  // display-only rotation by the tilt angle recorded with this capture (meta).
  // Older recordings without a stored angle can only be shown in sensor frame.
  const recordingAngle = selectedMeta?.wall_decline_deg
  const hasRecordedAngle =
    typeof recordingAngle === "number" && Number.isFinite(recordingAngle)
  const coordinateFrame = worldView && hasRecordedAngle ? "world" : "sensor"
  const selectedDataForCharts = useMemo(
    () => toDisplayFrameReadings(selectedData, coordinateFrame, recordingAngle ?? 0),
    [selectedData, coordinateFrame, recordingAngle],
  )

  return (
    <div className="space-y-4">

      {/* ── Recording list card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Recent Recordings</CardTitle>
              {listed.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({listed.length})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBrowserOpen(true)}
                className="h-7 px-2 gap-1.5 text-xs"
                title="Browse every saved recording, not just the recent ones"
              >
                <FolderOpen className="h-3 w-3" />
                Browse All
              </Button>

              {/* Compare toggle */}
              {listed.length >= 2 && (
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

          {!listLoading && listed.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Database className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No recordings saved yet.</p>
              <p className="text-xs text-muted-foreground">
                Pause a recording and click <strong>Save Recording</strong> above.
              </p>
            </div>
          )}

          {listed.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {listed.map((rec) => {
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

      {/* ── Full archive picker ── */}
      <RecordingsBrowserModal
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        selectedId={compareMode ? null : selectedId}
        onDelete={removeRecording}
        onRename={relabelRecording}
        onSelect={(rec) => {
          // Fold the pick into the recent list so it stays visible/selectable,
          // then load it — in compare mode it takes an A/B slot instead.
          selectRecording(rec.id, rec)
          if (compareMode) comparison.toggleId(rec.id)
        }}
      />

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
                  {selectedData.length > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {shownRatio > 1
                        ? `(plotting 1 in ${shownRatio})`
                        : "(plotting every sample)"}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Sensor / World toggle. The world angle is taken straight from
                    the recording's stored tilt (meta.wall_decline_deg) — not a
                    manual entry — since the angle is a known property of the
                    capture. Only shown when the recording carries a tilt angle. */}
                {hasRecordedAngle && (
                  <div
                    className="flex h-9 items-center overflow-hidden rounded-md border text-sm"
                    title={`World view rotates by the wall tilt recorded with this capture (θ = ${recordingAngle}°).`}
                  >
                    <button
                      onClick={() => setWorldView(false)}
                      className={`h-full px-3 transition-colors ${
                        !worldView
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Sensor
                    </button>
                    <button
                      onClick={() => setWorldView(true)}
                      className={`h-full border-l px-3 transition-colors ${
                        worldView
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      World · {recordingAngle}°
                    </button>
                  </div>
                )}
                {/* A plain link to the stored file — NOT a re-serialisation of
                    `selectedData`, which is downsampled for charting and narrowed
                    further while zoomed. Exporting that would silently hand over
                    ~1000 points of the real recording. */}
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a
                    href={recordingDownloadUrl(selectedMeta.id)}
                    download
                    title={`Download all ${selectedMeta.sample_count.toLocaleString()} samples`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* ── Zoom window ──
              Narrowing the range re-fetches that slice from the backend, which
              downsamples the SLICE to ~1000 points. So this buys real detail,
              unlike a client-side zoom that would only magnify the dots already
              drawn. */}
          {zoomable && (
            <Card>
              <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Search className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">Zoom</span>
                  <span className="tabular-nums">
                    {range[0].toLocaleString()} – {range[1].toLocaleString()}
                  </span>
                </div>

                <Slider
                  value={range}
                  min={0}
                  max={totalRows}
                  step={Math.max(1, Math.round(totalRows / 500))}
                  minStepsBetweenThumbs={1}
                  onValueChange={(v) => setRange([v[0], v[1]] as [number, number])}
                  onValueCommit={(v) => loadWindow({ from: v[0], to: v[1] })}
                  disabled={dataLoading}
                  className="flex-1"
                />

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 text-xs"
                  disabled={!sampleWindow || dataLoading}
                  onClick={() => {
                    setRange([0, totalRows])
                    loadWindow(null)
                  }}
                >
                  <ZoomOut className="h-3 w-3" />
                  Whole recording
                </Button>
              </CardContent>
            </Card>
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
                    <Line data={buildNormChartData(selectedDataForCharts)} options={chartOptions} />
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
                    X, Y, Z components for each sensor —{" "}
                    {coordinateFrame === "world" ? (
                      <span className="font-medium text-foreground">
                        World coordinates (vertical / out-of-wall), rotated by the
                        recorded tilt θ = {recordingAngle}° at display time
                      </span>
                    ) : (
                      <span className="font-medium text-foreground">
                        Sensor (board) axes — raw stored frame
                      </span>
                    )}
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
                            data={buildComponentChartData(selectedDataForCharts, sensorIndex)}
                            options={componentChartOptions}
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
