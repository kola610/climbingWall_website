import type { ChartOptions } from "chart.js"
import type { SensorReading } from "../types/sensor"

/**
 * Returns a Chart.js options object configured for the force-data line charts.
 * Accepts current display data (for tooltip callbacks), the y-axis maximum,
 * and the display window size so the x-axis can be pre-spanned to the full
 * window width even before enough data has arrived to fill it.
 */
export function createChartOptions(
  displayData: SensorReading[],
  yAxisMax: number,
  displaySampleCount: number | "all",
  autoScaleY: boolean,
): ChartOptions<"line"> {
  const firstSample = displayData.length > 0 ? displayData[0].sampleNumber : 0
  const lastSample = displayData.length > 0 ? displayData[displayData.length - 1].sampleNumber : 0

  const xMax =
    displaySampleCount === "all"
      ? undefined
      : Math.max(firstSample + displaySampleCount - 1, lastSample)

  const windowMax = displayData.reduce((maxValue, reading) => {
    const readingMax = Math.max(...reading.values)
    return Math.max(maxValue, readingMax)
  }, 0)

  const autoScaledMax = Math.max(100, Math.ceil((windowMax * 1.2) / 50) * 50)
  const effectiveYAxisMax = autoScaleY ? autoScaledMax : yAxisMax

  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
    
        max: effectiveYAxisMax,
        title: { display: true, text: "Force (N)" },
      },
      x: {
        type: "linear",
        min: firstSample,
        max: xMax,
        title: { display: true, text: "Sample" },
        ticks: {
          maxTicksLimit: 10,
        },
      },
    },
    animation: { duration: 0 },
    plugins: {
      legend: { position: "top" },
      title: { display: false },
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          title: (items) => `Sample: ${items[0]?.parsed?.x ?? ""}`,
        },
      },
    },
    interaction: { mode: "nearest", axis: "x", intersect: false },
  }
}
