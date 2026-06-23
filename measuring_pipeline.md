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
- **`values`** — fully calibrated, **sensor-frame** Newtons (post remap → sign → offset → scale). This is the canonical frame stored and displayed everywhere. The wall-decline angle θ is **not** applied here.

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

Multiply per channel by `calibration.axisScales` (Newtons per raw-voltage-ratio unit, ~1e6). After this each value is in Newtons in the **sensor frame** — and this is the final, canonical output of the pipeline:

```
X_sensor = in-plane force (along the wall, positive up-slope)
Z_sensor = normal force (perpendicular to wall surface, positive out toward climber)
Y_sensor = sideways force (positive right)
```

> **No rotation at ingestion.** The wall-decline angle θ is **not** applied in the pipeline. The sensor frame is what gets stored in the live buffer, IndexedDB, and the backend CSV. World-frame X/Z is an opt-in, UI-only rotation applied at render time (see [Display coordinate frame](#display-coordinate-frame)).

---

## Data storage (`useSensorData`)

[`addSensorReading(values)`](climbing_wall_website/src/hooks/useSensorData.ts:128) is called for every processed sample:

1. **Tare offset** is applied: `taredValues = values − tareOffsetsRef`. Tare is a simple subtraction of the last known reading, resetting displayed forces to zero (separate from the calibration offset).
2. A `SensorReading` is pushed into `allSensorDataRef` (a mutable ref — no re-render per sample):

```ts
interface SensorReading {
  timestamp: number     // ms since epoch
  sampleNumber: number  // monotonically incrementing
  values: number[]      // 12 sensor-frame Newtons, GUI-slot order
}
```

> **IndexedDB note:** the store version was bumped (v1 → v2) when the canonical frame switched from world to sensor. The upgrade drops any pre-v2 (world-frame) buffer so stale data is never reinterpreted as sensor frame.

3. Every **5 seconds** `allSensorDataRef.current` is auto-saved to **IndexedDB** (`saveSensorData`), so a page reload loses at most 5 s of data.
4. On mount, `loadSensorData()` restores the last session from IndexedDB automatically.

---

## UI sync (`useSensorData`)

Updating React state on every ~100 Hz sample would cause thousands of re-renders per second. Instead:

- A **50 ms interval** (~20 fps) copies a display-window slice of `allSensorDataRef` into React state.
- `buildDisplaySlice` picks the last N samples (user-configurable) and downsamples to at most **1000 chart points** using a stride.

---

## Display coordinate frame

All data is stored in the canonical **sensor (board) frame** (X = along wall / in-plane, Z = board normal). World frame (X = true vertical, Z = out of wall) is a **derived, opt-in, UI-only** view.

In the **live** view the app cannot know the current physical wall angle, so the user must enter the **current wall tilt θ** in a clearly labeled field and **confirm** it (`"Display in world frame using θ = X°?"`). On confirm the world view is *locked* at that angle and shown as a locked badge; an "unlock" / "return to sensor view" action reverts. This is implemented by [`WorldFrameControl`](climbing_wall_website/src/components/dashboard/WorldFrameControl.tsx) in the toolbar.

For a **recording** the tilt is already known — it was captured into `meta.wall_decline_deg` — so the recordings tab shows a plain **Sensor / World** toggle that rotates by that recorded angle directly. There is no manual entry or confirmation, because the angle is a fixed property of the capture (recordings without a stored angle can only be shown in sensor frame).

[`toDisplayFrameReadings(readings, frame, declineDeg)`](climbing_wall_website/src/utils/wallGeometry.ts:131):

- `"sensor"` → returns the same array (no copy, memoised consumers skip work) — the default
- `"world"` → applies `applyWallDecline(values, +θ)` to rotate sensor → world

```
X_world = X_sensor · cos θ − Z_sensor · sin θ   (true vertical, up)
Z_world = X_sensor · sin θ + Z_sensor · cos θ   (true horizontal, out)
Y_world = Y_sensor                               (unchanged)
```

This only changes what the charts show; the stored buffer is always sensor frame. At θ = 16°, a climber hanging vertically reads `~−W` on X and `~0` on Z in the world view.

---

## Charts

### Overall Force (Force Magnitudes tab)

Euclidean norm per sensor: `||F|| = √(X² + Y² + Z²)`. Rotation-invariant, so the sensor-vs-world view has no effect here.

### Force by Direction (Components tab)

Per-sensor X, Y, Z time series in the selected coordinate frame. X is purple, Y is slate, Z is gold.

Both chart types apply a **5-sample moving average** (`smoothData`) to reduce quantization stair-stepping before rendering.

---

## Recording to disk

When the user clicks Save:

1. [`saveRecordingToBackend(allSensorDataRef.current, label)`](climbing_wall_website/src/utils/recordingApi.ts:27) is called.
2. POSTs to `POST /api/recordings/save` with `{ label, filename, readings, wall_decline_deg }`. `readings` are **sensor-frame** Newtons.
3. Backend writes a **CSV** (`Timestamp, Sample, S1_X … S4_Z`) and a **`.meta.json`** sidecar:
   - `id`, `filename`, `created_at`, `sample_count`, `duration_s`, `label`, `frame`, `wall_decline_deg`
4. `frame` is `"sensor"` for new recordings (the CSV holds raw sensor-frame values). `wall_decline_deg` is the wall tilt at capture time — **metadata only**, not baked into the values; it drives the recordings tab's Sensor / World toggle (the world view rotates by exactly this recorded angle).

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

1. **Global Z projection**: the hand/foot sums are **sensor (wall) frame** (the buffer is never pre-rotated), which is exactly what this step expects — it transforms them to a global vertical component using the wall angle, correcting for the tilt exactly once:
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
| [`src/utils/serialParser.ts`](climbing_wall_website/src/utils/serialParser.ts) | Full transform pipeline: remap → sign → offset → scale (output is sensor frame; **no** rotation) |
| [`src/utils/wallGeometry.ts`](climbing_wall_website/src/utils/wallGeometry.ts) | Sensor→world rotation helpers (display-only), `toDisplayFrameReadings` |
| [`src/components/dashboard/WorldFrameControl.tsx`](climbing_wall_website/src/components/dashboard/WorldFrameControl.tsx) | Opt-in world-frame view control (angle entry + confirm + lock) |
| [`src/hooks/useSensorData.ts`](climbing_wall_website/src/hooks/useSensorData.ts) | Buffer, tare, UI sync, IndexedDB persistence, mock data |
| [`src/hooks/useJumpTest.ts`](climbing_wall_website/src/hooks/useJumpTest.ts) | Jump state machine, window slicing, backend call |
| [`src/utils/jumpApi.ts`](climbing_wall_website/src/utils/jumpApi.ts) | Hand/foot summation, `POST /api/jump` |
| [`src/utils/recordingApi.ts`](climbing_wall_website/src/utils/recordingApi.ts) | `POST /api/recordings/save`, `GET /api/recordings` |
| [`src/utils/dataProcessing.ts`](climbing_wall_website/src/utils/dataProcessing.ts) | `smoothData`, `buildNormChartData`, `buildComponentChartData` |
| [`src/components/sensor-dashboard.tsx`](climbing_wall_website/src/components/sensor-dashboard.tsx) | Top-level orchestrator: wires serial → parser → hooks → UI |
| [`backend/app.py`](backend/app.py) | `POST /api/jump` jump height algorithm, recording save/load |
