import type { ChartOptions, TooltipItem } from "chart.js"
import type { SensorReading } from "../types/sensor"

/**
 * Behaviour shared by every force chart (live and recorded). Only the scales
 * differ between them, so those stay with each caller.
 *
 * Live charts redraw ~20x/s as new samples stream in. `{ duration: 0 }` keeps
 * Chart.js's animation system running (just at zero length), which still drives
 * the tooltip's opacity fade — and that fade gets retriggered on every redraw,
 * so mid-fade it flickers and sometimes paints at full opacity. Turning
 * animations fully off removes that glitch and the per-frame interpolation cost.
 * The tooltip's own animation is disabled explicitly too, since it is configured
 * separately from the chart's.
 *
 * `normalized` tells Chart.js the x data is strictly ascending and unique
 * (sampleNumber), so it can skip its internal sort and binary-search during
 * hit-testing — a real win for index-mode tooltips over hundreds of points.
 * One shared `interaction` mode for hover + tooltip means a single
 * active-element set is computed per mouse move instead of two.
 */
export const BASE_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  normalized: true,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { position: "top" },
    title: { display: false },
    tooltip: {
      enabled: true,
      animation: false,
      position: "nearest",
      callbacks: {
        title: (items: TooltipItem<"line">[]) =>
          `Sample: ${items[0]?.parsed?.x ?? ""}`,
      },
    },
  },
} satisfies ChartOptions<"line">

/**
 * Options for the LIVE force charts: y capped at the chosen (or auto-scaled)
 * maximum, x pre-spanned to the full display window so the axis doesn't jump
 * while the window is still filling.
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
    ...BASE_CHART_OPTIONS,
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
        ticks: { maxTicksLimit: 10 },
      },
    },
  }
}
