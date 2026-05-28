import { useState, useRef, useMemo } from "react"
import { Line } from "react-chartjs-2"
import type { Chart as ChartJS, ChartOptions } from "chart.js"
import { RefreshCw, AlertTriangle } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { Button } from "../../ui/button"
import {
  buildNormChartData,
  buildSingleSensorComparisonData,
} from "../../../utils/dataProcessing"
import { SENSOR_NAMES, MAGNITUDE_COLORS } from "../../../constants/sensor"
import type { ComparisonSlot } from "../../../hooks/useComparisonData"
import type { RecordingMeta } from "../../../utils/recordingApi"

interface ComparisonViewProps {
  slotA: ComparisonSlot | null
  slotB: ComparisonSlot | null
  metaA: RecordingMeta | null
  metaB: RecordingMeta | null
  chartOptions: ChartOptions<"line">
}

type CompareMode = "overlay" | "stacked"
type ChartSide = "A" | "B"

// ─── Synchronized crosshair plugin ──────────────────────────────────────────
//
// Each stacked chart gets its own plugin instance. Both instances share one
// `crosshairDataX` ref (stored as a data value, not a pixel) so that hovering
// on either chart draws the marker on both at exactly the same position — even
// if the two charts have slightly different inner widths.
//
// We use plain objects { current } instead of React refs so that the plugin
// factories can be created outside of components without any React dependency.
//
function makeCrosshairPlugin(
  side: ChartSide,
  markerA: { current: number | null },
  markerB: { current: number | null },
  setMarkerA: (x: number | null) => void,
  setMarkerB: (x: number | null) => void,
  hoverA: { current: number | null },
  hoverB: { current: number | null },
  activeSide: { current: ChartSide | null },
  peerRef: { current: ChartJS<"line"> | null },
) {
  const clearPeerTooltip = () => {
    const peer = peerRef.current as unknown as {
      setActiveElements?: (elements: Array<{ datasetIndex: number; index: number }>) => void
      tooltip?: {
        setActiveElements?: (
          elements: Array<{ datasetIndex: number; index: number }>,
          position: { x: number; y: number },
        ) => void
      }
      update?: (mode?: string) => void
    } | null
    if (!peer) return
    peer.setActiveElements?.([])
    peer.tooltip?.setActiveElements?.([], { x: 0, y: 0 })
    peer.update?.("none")
  }

  const syncPeerTooltipAtX = (xValue: number | null) => {
    const peer = peerRef.current as unknown as {
      data?: {
        datasets?: Array<{ data?: Array<{ x: number; y: number }> }>
      }
      scales?: {
        x?: { getPixelForValue: (v: number) => number; left: number; right: number }
        y?: { top: number; bottom: number }
      }
      setActiveElements?: (elements: Array<{ datasetIndex: number; index: number }>) => void
      tooltip?: {
        setActiveElements?: (
          elements: Array<{ datasetIndex: number; index: number }>,
          position: { x: number; y: number },
        ) => void
      }
      update?: (mode?: string) => void
    } | null
    if (!peer || xValue == null) {
      clearPeerTooltip()
      return
    }
    const datasets = peer.data?.datasets ?? []
    if (datasets.length === 0) return
    const firstSeries = datasets[0]?.data ?? []
    if (!Array.isArray(firstSeries) || firstSeries.length === 0) {
      clearPeerTooltip()
      return
    }

    // Find nearest sample index on the peer chart.
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < firstSeries.length; i++) {
      const pt = firstSeries[i]
      const d = Math.abs((pt?.x ?? 0) - xValue)
      if (d < nearestDistance) {
        nearestDistance = d
        nearestIndex = i
      }
    }
    if (nearestIndex < 0) {
      clearPeerTooltip()
      return
    }

    const xScale = peer.scales?.x
    const yScale = peer.scales?.y
    if (!xScale || !yScale) return
    const xAt = firstSeries[nearestIndex]?.x
    if (typeof xAt !== "number") {
      clearPeerTooltip()
      return
    }
    const px = xScale.getPixelForValue(xAt)
    if (px < xScale.left || px > xScale.right) {
      clearPeerTooltip()
      return
    }

    const activeElements = datasets.map((_, datasetIndex) => ({
      datasetIndex,
      index: nearestIndex,
    }))
    const pos = { x: px, y: (yScale.top + yScale.bottom) / 2 }
    peer.setActiveElements?.(activeElements)
    peer.tooltip?.setActiveElements?.(activeElements, pos)
    peer.update?.("none")
  }

  return {
    id: `syncedCrosshair${side}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterEvent(chart: any, args: any) {
      const ev = args.event as { type: string; x: number | null }
      if ((ev.type === "mousemove" || ev.type === "click") && ev.x != null) {
        const val: number | undefined = chart.scales?.x?.getValueForPixel(ev.x)
        const xVal = val !== undefined ? val : null

        if (ev.type === "click" && xVal != null) {
          if (side === "A") setMarkerA(xVal)
          else setMarkerB(xVal)
        }

        activeSide.current = side
        if (side === "A") {
          hoverA.current = xVal
          if (xVal == null) {
            hoverB.current = null
          } else if (markerA.current != null && markerB.current != null) {
            hoverB.current = markerB.current + (xVal - markerA.current)
          } else {
            hoverB.current = xVal
          }
        } else {
          hoverB.current = xVal
          if (xVal == null) {
            hoverA.current = null
          } else if (markerA.current != null && markerB.current != null) {
            hoverA.current = markerA.current + (xVal - markerB.current)
          } else {
            hoverA.current = xVal
          }
        }
        syncPeerTooltipAtX(side === "A" ? hoverB.current : hoverA.current)
      } else if (ev.type === "mouseout") {
        activeSide.current = null
        hoverA.current = null
        hoverB.current = null
        clearPeerTooltip()
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDraw(chart: any) {
      const xScale = chart.scales?.x
      const yScale = chart.scales?.y
      if (!xScale || !yScale) return
      const ctx = chart.ctx as CanvasRenderingContext2D
      const markerX = side === "A" ? markerA.current : markerB.current
      const hoverX = side === "A" ? hoverA.current : hoverB.current

      // Draw persistent marker (solid red) that defines snippet alignment start.
      if (markerX != null) {
        const markerPx: number = xScale.getPixelForValue(markerX)
        if (markerPx >= xScale.left && markerPx <= xScale.right) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(markerPx, yScale.top)
          ctx.lineTo(markerPx, yScale.bottom)
          ctx.strokeStyle = "rgba(220, 38, 38, 0.95)"
          ctx.lineWidth = 2.5
          ctx.setLineDash([])
          ctx.stroke()
          ctx.restore()
        }
      }

      // Draw transient hover cursor (dashed red) aligned by marker offsets.
      if (hoverX != null) {
        const hoverPx: number = xScale.getPixelForValue(hoverX)
        if (hoverPx >= xScale.left && hoverPx <= xScale.right) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(hoverPx, yScale.top)
          ctx.lineTo(hoverPx, yScale.bottom)
          ctx.strokeStyle = "rgba(239, 68, 68, 0.9)"
          ctx.lineWidth = 2
          ctx.setLineDash([4, 2])
          ctx.stroke()
          ctx.restore()
        }
      }
    },
  }
}

// ─── Small reusable pieces ────────────────────────────────────────────────────

function SlotBadge({ slot, color }: { slot: "A" | "B"; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold text-white shrink-0"
      style={{ backgroundColor: color }}
    >
      {slot}
    </span>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-12 gap-2">
      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Loading recording data…</span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ComparisonView({
  slotA,
  slotB,
  metaA,
  metaB,
  chartOptions,
}: ComparisonViewProps) {
  const [mode, setMode] = useState<CompareMode>("overlay")

  const [markerA, setMarkerA] = useState<number | null>(null)
  const [markerB, setMarkerB] = useState<number | null>(null)

  const markerARef = useRef<number | null>(null)
  const markerBRef = useRef<number | null>(null)
  markerARef.current = markerA
  markerBRef.current = markerB

  // Shared hover positions in data-space (A and B can differ when markers are set).
  const hoverARef = useRef<number | null>(null)
  const hoverBRef = useRef<number | null>(null)
  const activeSideRef = useRef<ChartSide | null>(null)
  // Chart instance refs — populated by react-chartjs-2 once mounted.
  const chartRefA = useRef<ChartJS<"line">>(null)
  const chartRefB = useRef<ChartJS<"line">>(null)

  // Each chart's plugin points its peerRef at the OTHER chart instance so
  // hovering on A triggers a redraw on B and vice-versa.
  // useMemo with an empty dep-array means the plugin objects are created once
  // and reused; they read `.current` on the refs at call time, so they always
  // see the latest chart instance even if React remounts the chart.
  const pluginA = useMemo(
    () => makeCrosshairPlugin(
      "A",
      markerARef,
      markerBRef,
      setMarkerA,
      setMarkerB,
      hoverARef,
      hoverBRef,
      activeSideRef,
      chartRefB,
    ),
    [],
  )
  const pluginB = useMemo(
    () => makeCrosshairPlugin(
      "B",
      markerARef,
      markerBRef,
      setMarkerA,
      setMarkerB,
      hoverARef,
      hoverBRef,
      activeSideRef,
      chartRefA,
    ),
    [],
  )

  if (!slotA && !slotB) return null

  const loadingA = slotA?.loading ?? false
  const loadingB = slotB?.loading ?? false
  const readyA = !!slotA && !loadingA && slotA.data.length > 0
  const readyB = !!slotB && !loadingB && slotB.data.length > 0
  const canCompare = readyA && readyB

  const labelA = metaA?.label ?? "Recording A"
  const labelB = metaB?.label ?? "Recording B"

  const lengthMismatch =
    canCompare && slotA!.data.length !== slotB!.data.length

  return (
    <div className="space-y-4">

      {/* ── Control bar ── */}
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">

        {/* A / B labels */}
        <div className="flex items-center gap-3 flex-wrap">
          {slotA && (
            <div className="flex items-center gap-1.5 text-sm">
              <SlotBadge slot="A" color="#3b82f6" />
              <span className="font-medium text-foreground max-w-[160px] truncate">{labelA}</span>
            </div>
          )}
          {slotA && slotB && (
            <span className="text-muted-foreground text-sm select-none">vs</span>
          )}
          {slotB && (
            <div className="flex items-center gap-1.5 text-sm">
              <SlotBadge slot="B" color="#f59e0b" />
              <span className="font-medium text-foreground max-w-[160px] truncate">{labelB}</span>
            </div>
          )}
          {slotA && !slotB && (
            <span className="text-sm text-muted-foreground italic">
              Select a second recording to compare
            </span>
          )}
        </div>

        {/* Mode toggle — only shown once both slots are ready */}
        {canCompare && (
          <div className="flex items-center rounded-md border overflow-hidden text-sm">
            <button
              onClick={() => setMode("overlay")}
              className={`px-3 py-1.5 transition-colors ${
                mode === "overlay"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Overlay
            </button>
            <button
              onClick={() => setMode("stacked")}
              className={`px-3 py-1.5 border-l transition-colors ${
                mode === "stacked"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Stacked
            </button>
          </div>
        )}
      </div>

      {/* ── Length mismatch notice ── */}
      {lengthMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Recordings differ in length ({slotA!.data.length.toLocaleString()} vs{" "}
            {slotB!.data.length.toLocaleString()} samples) — each line ends at its
            own recording length.
          </span>
        </div>
      )}

      {/* ── Loading ── */}
      {(loadingA || loadingB) && (
        <Card><CardContent><LoadingRow /></CardContent></Card>
      )}

      {/* ── Only A loaded (no B yet) — show a single norm chart as preview ── */}
      {readyA && !slotB && !loadingA && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <SlotBadge slot="A" color="#3b82f6" />
              <CardTitle className="text-sm font-semibold">{labelA} — Overall Force</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <Line data={buildNormChartData(slotA!.data)} options={chartOptions} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Overlay mode: 2×2 grid, one card per sensor, two lines each ── */}
      {canCompare && mode === "overlay" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Force Comparison — per Sensor
            </CardTitle>
            <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap mt-0.5">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-0.5 bg-current" />
                <SlotBadge slot="A" color="#3b82f6" />
                <span>Solid — {labelA}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-6 h-0.5"
                  style={{ background: "repeating-linear-gradient(90deg,currentColor 0,currentColor 6px,transparent 6px,transparent 9px)" }}
                />
                <SlotBadge slot="B" color="#f59e0b" />
                <span>Dashed — {labelB}</span>
              </span>
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {SENSOR_NAMES.map((name, idx) => (
                <div key={idx} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: MAGNITUDE_COLORS[idx].border }}
                      />
                      <h3 className="text-sm font-semibold">{name}</h3>
                    </div>
                    {/* Mini colour key so each panel is self-contained */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block w-4 h-0.5 rounded"
                          style={{ backgroundColor: MAGNITUDE_COLORS[idx].border }}
                        />
                        A
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block w-4 h-0.5 rounded"
                          style={{ backgroundColor: MAGNITUDE_COLORS[idx].borderB }}
                        />
                        B
                      </span>
                    </div>
                  </div>
                  <div className="h-[200px]">
                    <Line
                      data={buildSingleSensorComparisonData(
                        slotA!.data,
                        slotB!.data,
                        idx,
                        labelA,
                        labelB,
                      )}
                      options={chartOptions}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stacked mode: two full-height norm charts with synced crosshair ── */}
      {canCompare && mode === "stacked" && (
        <>
          <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Click each chart to place a <span className="text-red-600 font-medium">red start marker</span>.
              Hover then compares snippets from those marker positions.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setMarkerA(null); setMarkerB(null) }}
            >
              Clear markers
            </Button>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <SlotBadge slot="A" color="#3b82f6" />
                <CardTitle className="text-sm font-semibold">
                  {labelA} — Overall Force
                </CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">
                Marker A: {markerA != null ? Math.round(markerA) : "not set"} ·
                {" "}Marker B: {markerB != null ? Math.round(markerB) : "not set"}
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <Line
                  ref={chartRefA}
                  data={buildNormChartData(slotA!.data)}
                  options={chartOptions}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  plugins={[pluginA as any]}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <SlotBadge slot="B" color="#f59e0b" />
                <CardTitle className="text-sm font-semibold">
                  {labelB} — Overall Force
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <Line
                  ref={chartRefB}
                  data={buildNormChartData(slotB!.data)}
                  options={chartOptions}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  plugins={[pluginB as any]}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
