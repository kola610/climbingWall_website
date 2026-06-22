# Measuring Pipeline

This describes the full data path from raw serial bytes to displayed Newton forces, stored recordings, and jump height results.

---

## Hardware and sampling rate

4 load cell boards (Left Hand, Right Hand, Left Foot, Right Foot), each measuring 3-axis force. The Raspberry Pi streams at **~100 Hz** (`setDataInterval(10)`), sending one comma-separated line of 12 floats per sample. The values are **raw voltage ratios** (~1e-6 scale); all calibration to Newtons happens on the computer, not on the Pi.

---

## Serial ingestion (`useSerialPort` → `handleSerialLine`)

In [`sensor-dashboard.tsx`](climbing_wall_website/src/components/sensor-dashboard.tsx:81), every line from the serial port is passed to `handleSerialLine(line)`:

```ts
const msg = parseSerialLine(line)
if (msg.type === "sensor") {
  addSensorReadingRef.current?.(msg.values)       // → useSensorData
  calibrationSinkRef.current?.(msg.signedRaw)     // → useCalibration
}
```

`addSensorReadingRef` and `calibrationSinkRef` are stable refs updated every render to avoid stale closures.

---

## Transform pipeline (`serialParser.ts`)

[`parseSerialLine`](climbing_wall_website/src/utils/serialParser.ts:100) runs each raw line through a fixed sequence of transforms. The result exposes two arrays:

- **`signedRaw`** — post-sign, pre-offset, pre-scale. Used only by the calibration wizard.
- **`values`** — fully calibrated, world-frame Newtons. Stored and displayed everywhere else.

### Step 1 — Parse

Split on `,`, parse 12 floats. Reject the line if any value is `NaN` or non-finite.

### Step 2 — Remap sensor groups

The Pi's physical wiring does not match the GUI order. Groups are reordered:

```
Pi group 0 = Left Foot
Pi group 1 = Left Hand
Pi group 2 = Right Foot
Pi group 3 = Right Hand
```

To produce GUI order `[Left Hand, Right Hand, Left Foot, Right Foot]`, groups `[1, 3, 0, 2]` are selected:

```ts
const SENSOR_GROUP_ORDER = [1, 3, 0, 2]
```

### Step 3 — Apply axis signs

Per-channel ±1 sign corrections from `calibration.axisSigns`. These handle boards that are physically mounted inverted. After this step the result is `signedRaw`.

### Step 4 — Apply ground offsets

Subtract the zero-load raw reading per channel (`calibration.groundOffsets`). This zeroes the sensor output at rest. Since these are raw voltage ratios, offsets are tiny (~1e-6).

### Step 5 — Apply axis scales

Multiply per channel by `calibration.axisScales` (Newtons per raw-voltage-ratio unit, ~1e6). After this each value is in Newtons in the **sensor frame**:

```
X_sensor = in-plane force (along the wall, positive up-slope)
Z_sensor = normal force (perpendicular to wall surface, positive out toward climber)
Y_sensor = sideways force (positive right) — never rotated
```

### Step 6 — Wall-decline rotation (`applyWallDecline`)

The wall is mounted at angle θ from vertical. The sensor frame is rotated by θ relative to the world frame. [`applyWallDecline`](climbing_wall_website/src/utils/wallGeometry.ts:98) applies a 2D rotation in the X–Z plane for each of the 4 boards:

```
X_world = X_sensor · cos θ − Z_sensor · sin θ   (true vertical, up)
Z_world = X_sensor · sin θ + Z_sensor · cos θ   (true horizontal, out)
Y_world = Y_sensor                               (unchanged)
```

At θ = 0 the rotation is identity. At the default θ = 16°, a climber hanging vertically reads `~−W` on X and `~0` on Z (as expected).

The active θ is a module-level variable in `wallGeometry.ts`, initialised from `localStorage["cw:wallDeclineDeg"]` (default 16°) before React mounts, so `parseSerialLine` always reads the current value.

---

## Data storage (`useSensorData`)

[`addSensorReading(values)`](climbing_wall_website/src/hooks/useSensorData.ts:128) is called for every processed sample:

1. **Tare offset** is applied: `taredValues = values − tareOffsetsRef`. Tare is a simple subtraction of the last known reading, resetting displayed forces to zero (separate from the calibration offset).
2. A `SensorReading` is pushed into `allSensorDataRef` (a mutable ref — no re-render per sample):

```ts
interface SensorReading {
  timestamp: number     // ms since epoch
  sampleNumber: number  // monotonically incrementing
  values: number[]      // 12 world-frame Newtons, GUI-slot order
}
```

3. Every **5 seconds** `allSensorDataRef.current` is auto-saved to **IndexedDB** (`saveSensorData`), so a page reload loses at most 5 s of data.
4. On mount, `loadSensorData()` restores the last session from IndexedDB automatically.

---

## UI sync (`useSensorData`)

Updating React state on every ~100 Hz sample would cause thousands of re-renders per second. Instead:

- A **50 ms interval** (~20 fps) copies a display-window slice of `allSensorDataRef` into React state.
- `buildDisplaySlice` picks the last N samples (user-configurable) and downsamples to at most **1000 chart points** using a stride.

---

## Display coordinate frame

All data is stored in **world frame** (X = vertical, Z = horizontal/out). The user can toggle display to **board frame** (sensor frame, X = along wall, Z = normal).

[`toDisplayFrameReadings(readings, frame, declineDeg)`](climbing_wall_website/src/utils/wallGeometry.ts:131):

- `"world"` → returns the same array (no copy, memoised consumers skip work)
- `"board"` → applies `applyWallDecline(values, -θ)` to undo the rotation

This only changes what the charts show; the stored buffer is always world-frame.

---

## Charts

### Overall Force (Force Magnitudes tab)

Euclidean norm per sensor: `||F|| = √(X² + Y² + Z²)`. Rotation-invariant, so the "world vs board" toggle has no effect here.

### Force by Direction (Components tab)

Per-sensor X, Y, Z time series in the selected coordinate frame. X is purple, Y is slate, Z is gold.

Both chart types apply a **5-sample moving average** (`smoothData`) to reduce quantization stair-stepping before rendering.

---

## Recording to disk

When the user clicks Save:

1. [`saveRecordingToBackend(allSensorDataRef.current, label)`](climbing_wall_website/src/utils/recordingApi.ts:27) is called.
2. POSTs to `POST /api/recordings/save` with `{ label, filename, readings, wall_decline_deg }`.
3. Backend writes a **CSV** (`Timestamp, Sample, S1_X … S4_Z`) and a **`.meta.json`** sidecar:
   - `id`, `filename`, `created_at`, `sample_count`, `duration_s`, `label`, `wall_decline_deg`
4. `wall_decline_deg` is the θ active at capture time, so the recording can be displayed in raw board coordinates exactly even if the live θ later changes.

`GET /api/recordings` returns the 5 most recent recordings (newest first).

`GET /api/recordings/<id>/data` returns readings downsampled to at most **1000 points** (evenly spaced) to keep the chart payload small.

---

## Jump test pipeline

### 1. Setup

User enters body weight (kg) and optionally wall angle. These stay in frontend state (persisted in localStorage across reloads).

### 2. Start

[`startJumpTest()`](climbing_wall_website/src/hooks/useJumpTest.ts:55) records `jumpStartIndexRef = allSensorDataRef.current.length` — the index marking the beginning of the jump window in the live buffer.

### 3. Finish

[`finishJumpTest()`](climbing_wall_website/src/hooks/useJumpTest.ts:76):

1. Slices `allSensorDataRef.current.slice(jumpStartIndex)` — all samples during the jump.
2. Sums the two hand boards and two foot boards per sample:
   ```
   hand[i] = [LH.X+RH.X, LH.Y+RH.Y, LH.Z+RH.Z]
   foot[i] = [LF.X+RF.X, LF.Y+RF.Y, LF.Z+RF.Z]
   ```
3. POSTs to `POST /api/jump` with `{ hand, foot, mass, wallAngle, samplingRate }`.

### 4. Backend computation (`backend/app.py` — `calculate_jump_height_with_angle`)

The algorithm (ported from the Pi's `demonstration.py`, Method A):

1. **Global Z projection**: transforms wall-frame forces to a global vertical component using the wall angle:
   ```python
   foot_global_z = foot[:,2]*cos(θ) + foot[:,1]*sin(θ)
   ```
2. **Net force / acceleration**: subtracts the mean weight force from the first ~1 s (still period) to get net force, then divides by mass.
3. **Baseline correction**: removes any residual DC offset in acceleration.
4. **Jump start detection**: finds the first significant upward slope in foot force before the peak acceleration, zeroing acceleration before that point.
5. **Double integration**: `acceleration → velocity → position` via `cumulative_trapezoid`, each baseline-corrected.
6. **Takeoff detection**: finds the first zero-crossing of total force after the acceleration peak (when both feet and hands leave the wall).
7. **Jump height**: `peak_position − position_at_takeoff`, corrected back to wall-perpendicular by `× cos(θ)`.

Returns `{ jumpHeightM, jumpHeightCm }`.

---

## Mock mode

When no hardware is connected and data collection starts, `useSensorData` generates synthetic values:

```ts
const rawRatio = (sin(t*1.5 + i)*0.5 + noise) * 2e-5
return rawRatio * 3_000_000  // representative N per raw-voltage-ratio unit
```

This bypasses `serialParser` entirely. Mock jump results return a random height (20–120 cm).

---

## Key files

| File | Role |
|---|---|
| [`src/utils/serialParser.ts`](climbing_wall_website/src/utils/serialParser.ts) | Full transform pipeline: remap → sign → offset → scale → wall rotation |
| [`src/utils/wallGeometry.ts`](climbing_wall_website/src/utils/wallGeometry.ts) | Wall-decline rotation (sensor↔world frame), `toDisplayFrameReadings` |
| [`src/hooks/useSensorData.ts`](climbing_wall_website/src/hooks/useSensorData.ts) | Buffer, tare, UI sync, IndexedDB persistence, mock data |
| [`src/hooks/useJumpTest.ts`](climbing_wall_website/src/hooks/useJumpTest.ts) | Jump state machine, window slicing, backend call |
| [`src/utils/jumpApi.ts`](climbing_wall_website/src/utils/jumpApi.ts) | Hand/foot summation, `POST /api/jump` |
| [`src/utils/recordingApi.ts`](climbing_wall_website/src/utils/recordingApi.ts) | `POST /api/recordings/save`, `GET /api/recordings` |
| [`src/utils/dataProcessing.ts`](climbing_wall_website/src/utils/dataProcessing.ts) | `smoothData`, `buildNormChartData`, `buildComponentChartData` |
| [`src/components/sensor-dashboard.tsx`](climbing_wall_website/src/components/sensor-dashboard.tsx) | Top-level orchestrator: wires serial → parser → hooks → UI |
| [`backend/app.py`](backend/app.py) | `POST /api/jump` jump height algorithm, recording save/load |
