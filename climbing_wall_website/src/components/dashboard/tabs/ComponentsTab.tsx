import { useState, useEffect, useCallback, useMemo, memo } from "react"
import { Line } from "react-chartjs-2"
import type { ChartOptions } from "chart.js"
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { Button } from "../../ui/button"
import { buildComponentChartData } from "../../../utils/dataProcessing"
import { SENSOR_NAMES, MAGNITUDE_COLORS } from "../../../constants/sensor"
import { Maximize2, X } from "lucide-react"
import { SensorToggleBar } from "../SensorToggleBar"
import { useSensorToggle } from "../../../hooks/useSensorToggle"
import type { SensorReading } from "../../../types/sensor"

interface ComponentsTabProps {
  displayData: SensorReading[]
  displaySampleCount: number | "all"
  totalSamples: number
  chartOptions: ChartOptions<"line">
}

/**
 * Total points budget shared across all visible per-sensor charts.
 *
 * The Overall Force tab renders a single canvas of ~1000 points and stays
 * smooth. This tab renders one canvas per visible sensor (×3 components each),
 * so to keep the combined per-frame render cost in the same ballpark we split
 * one ~1000-point budget across the visible charts. With 4 sensors visible
 * each chart gets ~250 points; with 1 visible it keeps the full ~1000.
 */
const TOTAL_POINT_BUDGET = 1000

/**
 * Evenly subsamples readings down to `maxPoints` (keeping the last point) so
 * each per-sensor chart renders a bounded number of points regardless of how
 * many samples the display window holds. Returns the same array reference when
 * no decimation is needed so memoised consumers can skip work.
 */
function decimateReadings(
  data: SensorReading[],
  maxPoints: number,
): SensorReading[] {
  if (data.length <= maxPoints) return data
  const stride = Math.ceil(data.length / maxPoints)
  const out: SensorReading[] = []
  for (let i = 0; i < data.length; i += stride) out.push(data[i])
  const last = data[data.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/**
 * A single per-sensor X/Y/Z chart. Memoised so it only re-renders (and re-runs
 * the smoothing + Chart.js update) when its own inputs actually change — e.g.
 * expanding a different sensor no longer forces every other chart to rebuild.
 */
const SensorComponentChart = memo(function SensorComponentChart({
  data,
  sensorIndex,
  options,
  height,
}: {
  data: SensorReading[]
  sensorIndex: number
  options: ChartOptions<"line">
  height: number
}) {
  const chartData = useMemo(
    () => buildComponentChartData(data, sensorIndex),
    [data, sensorIndex],
  )
  return (
    <div
      className="transition-[height] duration-300 ease-in-out"
      style={{ height }}
    >
      <Line data={chartData} options={options} />
    </div>
  )
})

/**
 * Shows one chart per sensor, breaking the force into X, Y, Z directions.
 *
 * A <SensorToggleBar /> in the header controls which sensors are visible.
 * The grid adapts to the number of active sensors.
 */
export function ComponentsTab({
  displayData,
  displaySampleCount,
  totalSamples,
  chartOptions,
}: ComponentsTabProps) {
  const [expandedSensor, setExpandedSensor] = useState<number | null>(null)
  const { activeSensors, toggleSensor, visibleIndices } = useSensorToggle()

  const windowLabel =
    displaySampleCount === "all" ? "all data" : `last ${displaySampleCount / 100}s`

  const closeOverlay = useCallback(() => setExpandedSensor(null), [])

  useEffect(() => {
    if (expandedSensor === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expandedSensor, closeOverlay])

  const visibleCount = visibleIndices.length

  // Share one point budget across the visible charts so the combined render
  // cost stays close to the (smooth) single-chart Overall Force tab. Recomputed
  // only when the data or the number of visible charts changes.
  const perChartBudget = Math.max(
    200,
    Math.floor(TOTAL_POINT_BUDGET / Math.max(1, visibleCount)),
  )
  const gridChartData = useMemo(
    () => decimateReadings(displayData, perChartBudget),
    [displayData, perChartBudget],
  )

  // The expanded overlay is a single chart, so it can afford the full budget.
  const expandedChartData = useMemo(
    () => decimateReadings(displayData, TOTAL_POINT_BUDGET),
    [displayData],
  )

  const gridCols =
    visibleCount === 1
      ? "grid-cols-1"
      : visibleCount === 2
        ? "grid-cols-1 md:grid-cols-2"
        : visibleCount === 3
          ? "grid-cols-1 md:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2"

  const chartHeight = visibleCount <= 2 ? 340 : 250



// comment this out to hide the sensor toggle bar
// {false && <SensorToggleBar activeSensors={activeSensors} onToggle={toggleSensor} />}  !!!
  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-row items-center justify-between">
            <CardTitle>Force by Direction — per Sensor</CardTitle>
            <div className="text-xs text-muted-foreground text-right shrink-0 ml-4">
              Showing {windowLabel}
              <br />
              {displayData.length} of {totalSamples} points
            </div>
          </div>

          {displayData.length > 0 && (
            <div className="mt-3">
               {true && <SensorToggleBar activeSensors={activeSensors} onToggle={toggleSensor} />}  
               
            </div>
          )}
        </CardHeader>
        <CardContent>
          {displayData.length > 0 ? (
            <div className={`grid ${gridCols} gap-6`}>
              {visibleIndices.map((index) => {
                const name = SENSOR_NAMES[index]
                const color = MAGNITUDE_COLORS[index].border

                return (
                  <div
                    key={index}
                    className="border rounded-lg p-4 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <h3 className="text-base font-semibold">{name}</h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpandedSensor(index)}
                        aria-label={`Expand ${name} chart`}
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <SensorComponentChart
                      data={gridChartData}
                      sensorIndex={index}
                      options={chartOptions}
                      height={chartHeight}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <p className="text-muted-foreground">No data yet.</p>
              <p className="text-sm text-muted-foreground">
                Press <strong>Start Recording</strong> above to begin.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {expandedSensor !== null && displayData.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200"
          onClick={closeOverlay}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          <div
            className={[
              "relative z-10 w-[90vw] max-w-4xl",
              "rounded-xl border bg-card text-card-foreground shadow-2xl",
              "p-6 animate-in zoom-in-95 fade-in duration-200",
            ].join(" ")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: MAGNITUDE_COLORS[expandedSensor].border }}
                />
                <h3 className="text-lg font-semibold">
                  {SENSOR_NAMES[expandedSensor]}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={closeOverlay}
                aria-label="Close expanded chart"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[60vh] max-h-[500px]">
              <Line
                data={buildComponentChartData(expandedChartData, expandedSensor)}
                options={chartOptions}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
