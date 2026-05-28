export interface SensorReading {
  timestamp: number
  sampleNumber: number
  values: number[] // 12 values: 4 sensors × (x, y, z)
}
