import type { SensorReading } from "../types/sensor"
import {
  FORCE_COMPONENTS,
  SENSOR_NAMES,
  COMPONENT_COLORS,
  MAGNITUDE_COLORS,
} from "../constants/sensor"

/**
 * Evenly subsamples readings down to `maxPoints`, always keeping the last one so
 * a chart's right edge is the newest sample. Returns the SAME array reference
 * when no decimation is needed, so memoised consumers can skip work — callers
 * holding a mutable buffer must copy it themselves.
 */
export function decimate(
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

/** Euclidean magnitude ‖F‖ = √(X²+Y²+Z²) of one sensor within a reading. */
export function sensorNorm(reading: SensorReading, sensorIndex: number): number {
  const fx = reading.values[sensorIndex * 3]
  const fy = reading.values[sensorIndex * 3 + 1]
  const fz = reading.values[sensorIndex * 3 + 2]
  return Math.sqrt(fx * fx + fy * fy + fz * fz)
}

/**
 * Simple moving-average filter — smooths out quantization stair-steps.
 */
export function smoothData(data: number[], windowSize = 5): number[] {
  const half = Math.floor(windowSize / 2)
  return data.map((_, i) => {
    const start = Math.max(0, i - half)
    const end = Math.min(data.length, i + half + 1)
    let sum = 0
    for (let j = start; j < end; j++) sum += data[j]
    return sum / (end - start)
  })
}

/**
 * Builds Chart.js dataset for all three force components (X, Y, Z) of a
 * single sensor.
 */
export function buildComponentChartData(
  displayData: SensorReading[],
  sensorIndex: number,
) {
  const smoothedByComponent = FORCE_COMPONENTS.map((_, idx) =>
    smoothData(displayData.map((r) => r.values[sensorIndex * 3 + idx])),
  )

  return {
    datasets: FORCE_COMPONENTS.map((component, idx) => ({
      label: `${component} Force`,
      data: smoothedByComponent[idx].map((y, i) => ({
        x: displayData[i].sampleNumber,
        y,
      })),
      borderColor: COMPONENT_COLORS[idx].border,
      backgroundColor: COMPONENT_COLORS[idx].background,
      tension: 0.4,
      pointRadius: 0,
    })),
  }
}

/**
 * Builds Chart.js datasets comparing a single sensor across two recordings.
 *
 * Recording A → solid line  (same sensor colour, full opacity)
 * Recording B → dashed line (same colour, slightly thinner)
 *
 * The two datasets share the sensor colour so it is immediately obvious
 * which sensor is being compared; the solid/dashed style differentiates
 * the recording. Both x-axes use the original sampleNumber so recordings
 * of different lengths just end at their own natural extent.
 */
export function buildSingleSensorComparisonData(
  dataA: SensorReading[],
  dataB: SensorReading[],
  sensorIndex: number,
  labelA: string,
  labelB: string,
) {
  // A uses the sensor's primary colour (solid); B uses a darker contrasting
  // shade (dashed) so both lines are clearly visible even on light backgrounds.
  const colorA = MAGNITUDE_COLORS[sensorIndex].border
  const colorB = MAGNITUDE_COLORS[sensorIndex].borderB
  const norm = (r: SensorReading) => sensorNorm(r, sensorIndex)
  const smoothedA = dataA.length ? smoothData(dataA.map(norm)) : []
  const smoothedB = dataB.length ? smoothData(dataB.map(norm)) : []

  return {
    datasets: [
      {
        label: `A — ${labelA}`,
        data: smoothedA.map((y, i) => ({ x: dataA[i].sampleNumber, y })),
        borderColor: colorA,
        backgroundColor: "transparent",
        borderWidth: 2.5,
        borderDash: [] as number[],
        tension: 0.4,
        pointRadius: 0,
      },
      {
        label: `B — ${labelB}`,
        data: smoothedB.map((y, i) => ({ x: dataB[i].sampleNumber, y })),
        borderColor: colorB,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 3] as number[],
        tension: 0.4,
        pointRadius: 0,
      },
    ],
  }
}

/**
 * Builds Chart.js dataset for the Euclidean norm ||F|| = √(X²+Y²+Z²) of
 * every sensor, overlaid on a single chart.
 */
export function buildNormChartData(displayData: SensorReading[]) {
  return {
    datasets: SENSOR_NAMES.map((sensor, sensorIndex) => {
      const smoothed = smoothData(
        displayData.map((r) => sensorNorm(r, sensorIndex)),
      )
      return {
        label: sensor,
        data: smoothed.map((y, i) => ({
          x: displayData[i].sampleNumber,
          y,
        })),
        borderColor: MAGNITUDE_COLORS[sensorIndex].border,
        backgroundColor: MAGNITUDE_COLORS[sensorIndex].background,
        tension: 0.4,
        pointRadius: 0,
      }
    }),
  }
}
