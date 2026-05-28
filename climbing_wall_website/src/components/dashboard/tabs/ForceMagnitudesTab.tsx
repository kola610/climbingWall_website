import { Line } from "react-chartjs-2"
import type { ChartOptions } from "chart.js"
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"
import { buildNormChartData } from "../../../utils/dataProcessing"
import type { SensorReading } from "../../../types/sensor"

interface ForceMagnitudesTabProps {
  displayData: SensorReading[]
  displaySampleCount: number | "all"
  totalSamples: number
  chartOptions: ChartOptions<"line">
}

/**
 * Shows the total force magnitude for each sensor as a single overlaid chart.
 * Each line = one sensor; value = combined force regardless of direction.
 */
export function ForceMagnitudesTab({
  displayData,
  displaySampleCount,
  totalSamples,
  chartOptions,
}: ForceMagnitudesTabProps) {
  const windowLabel =
    displaySampleCount === "all" ? "all data" : `last ${displaySampleCount / 100}s`

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>Overall Force — All Sensors</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Total force on each sensor (combined from all directions)
          </p>
        </div>
        <div className="text-xs text-muted-foreground text-right shrink-0 ml-4">
          Showing {windowLabel}
          <br />
          {displayData.length} of {totalSamples} points
        </div>
      </CardHeader>
      <CardContent>
        {displayData.length > 0 ? (
          <div className="h-[420px]">
            <Line data={buildNormChartData(displayData)} options={chartOptions} />
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
  )
}
