# Measuring Pipeline

This describes the full data path from raw sensor lines to displayed Newton forces, stored recordings, and jump height results.

---

## Hardware and sampling rate

4 load cell boards (Left Hand, Right Hand, Left Foot, Right Foot), each measuring 3-axis force via a PhidgetBridge. The bridges plug **directly into the machine running the backend**. The Flask backend reads them ([`backend/phidget_stream.py`](backend/phidget_stream.py)) and broadcasts over a WebSocket (`/api/stream`) at **~100 Hz** (`dataIntervalMs: 10` in [`backend/phidget_config.json`](backend/phidget_config.json)), sending one comma-separated line of 12 floats per sample. The values are **raw voltage ratios** (~1e-6 scale); all calibration to Newtons happens in the frontend.

Board → sensor-group mapping (which serial number is which body part) lives in `phidget_config.json`; reorder `bridgeSerials` there if sensors appear swapped in the GUI.

---

## Stream ingestion (`useBackendStream` → `handleSerialLine`)

[`useBackendStream`](climbing_wall_website/src/hooks/useBackendStream.ts) owns the WebSocket. In [`sensor-dashboard.tsx`](climbing_wall_website/src/components/sensor-dashboard.tsx), every line from the stream is passed to `handleSerialLine(line)`:

```ts
const msg = parseSerialLine(line)
if (msg.type === "sensor") {
  addSensorReadingRef.current?.(msg.values)       // → useSensorData
  calibrationSinkRef.current?.(msg.signedRaw)     // → useCalibration
  tareSinkRef.current?.(msg.signedRaw)            // → useTareOffset
}
```

The three sinks are stable refs updated every render, which avoids stale closures and
breaks the circular dependency between the stream hook and its consumers.

Note the split: the buffer gets **calibrated Newtons**, while the wizard and the tare get
**`signedRaw`** — pre-tare, pre-scale — so their measurements don't depend on whatever
calibration is currently active.

---

## Transform pipeline (`serialParser.ts`)

[`parseSerialLine`](climbing_wall_website/src/utils/serialParser.ts) runs each raw line through a fixed sequence of transforms. The result exposes two arrays:

- **`signedRaw`** — post-sign, pre-tare, pre-scale. Used by the calibration wizard and the tare.
- **`values`** — fully calibrated, **sensor-frame** Newtons (post remap → sign → tare → scale). This is the canonical frame stored and displayed everywhere. The wall-decline angle θ is **not** applied here.

### Step 1 — Parse

Split on `,`, parse 12 floats. Reject the line if any value is `NaN` or non-finite.

### Step 2 — Remap sensor groups

The physical wiring order does not match the GUI order. Groups are reordered:

```
wire group 0 = Left Foot
wire group 1 = Left Hand
wire group 2 = Right Foot
wire group 3 = Right Hand
```

To produce GUI order `[Left Hand, Right Hand, Left Foot, Right Foot]`, groups `[1, 3, 0, 2]` are selected:

```ts
const SENSOR_GROUP_ORDER = [1, 3, 0, 2]
```

### Step 3 — Apply axis signs

Per-channel ±1 sign corrections from `calibration.axisSigns`. These handle boards that are physically mounted inverted. After this step the result is `signedRaw`.

### Step 4 — Apply the runtime tare

Subtract the zero-load reading per channel, from [`getRuntimeOffset()`](climbing_wall_website/src/utils/runtimeOffset.ts). Since these are raw voltage ratios the offsets are tiny (~1e-6).

This is the **volatile tare**, not part of the saved calibration: it is recomputed whenever the user presses **Zero Sensors** (averaging the last ~150 buffered samples), cached in `localStorage["tareOffset"]` so a reload keeps it, and all-zeros until the first zero is taken — readings are simply un-tared before that. It occupies exactly the pipeline slot the old persisted `groundOffsets` did, so the order of operations is unchanged; only the source moved.

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

`addSensorReading(values)` in [`useSensorData`](climbing_wall_website/src/hooks/useSensorData.ts) is called for every processed sample:

1. **No zeroing happens here.** The values arrive already calibrated and tared by `serialParser`, and are stored verbatim.
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
- `buildDisplaySlice` picks the last N samples (user-configurable) and calls `decimate` to reduce them to at most **1000 chart points** by stride, always keeping the newest sample.

> `decimate` returns its **input reference unchanged** when no decimation is needed — that is what lets memoised chart components skip work. But with the window set to "all", that input *is* the live mutable buffer, so `buildDisplaySlice` copies in that case. Handing the raw buffer to React state would mean no re-render (same reference) and an array mutating underneath Chart.js.

The buffer is capped at **360 000 samples** (~1 hour at 100 Hz); past that the oldest 36 000 are dropped. `sampleNumber` is absolute, so consumers that track positions by sample number (the jump test) stay correct across trims.

---

## Display coordinate frame

All data is stored in the canonical **sensor (board) frame** (X = along wall / in-plane, Z = board normal). World frame (X = true vertical, Z = out of wall) is a **derived, opt-in, UI-only** view.

In the **live** view the app cannot know the current physical wall angle, so the user must enter the **current wall tilt θ** in a clearly labeled field and **confirm** it (`"Display in world frame using θ = X°?"`). On confirm the world view is *locked* at that angle and shown as a locked badge; an "unlock" / "return to sensor view" action reverts. This is implemented by [`WorldFrameControl`](climbing_wall_website/src/components/dashboard/WorldFrameControl.tsx) in the toolbar.

For a **recording** the tilt is already known — it was captured into `meta.wall_decline_deg` — so the recordings tab shows a plain **Sensor / World** toggle that rotates by that recorded angle directly. There is no manual entry or confirmation, because the angle is a fixed property of the capture (recordings without a stored angle can only be shown in sensor frame).

[`toDisplayFrameReadings(readings, frame, declineDeg)`](climbing_wall_website/src/utils/wallGeometry.ts):

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

1. [`saveRecordingToBackend(allSensorDataRef.current, label)`](climbing_wall_website/src/utils/recordingApi.ts) is called.
2. POSTs to `POST /api/recordings/save` with `{ label, filename, readings, wall_decline_deg }`. `readings` are **sensor-frame** Newtons.
3. Backend writes a **CSV** (`Timestamp, Sample, S1_X … S4_Z`) and a **`.meta.json`** sidecar:
   - `id`, `filename`, `created_at`, `sample_count`, `duration_s`, `label`, `wall_decline_deg`
4. Recordings are always sensor-frame. `wall_decline_deg` is the wall tilt at capture time — **metadata only**, not baked into the values; it drives the recordings tab's Sensor / World toggle (the world view rotates by exactly this recorded angle). It is omitted on older recordings, which can therefore only be shown in sensor frame.

`GET /api/recordings` returns the 5 most recent recordings (newest first).

`GET /api/recordings/<id>/data` returns readings downsampled to at most **1000 points** (evenly spaced) to keep the chart payload small.

---

## Jump test pipeline

### 1. Setup

User enters body weight (kg) and optionally wall angle. These stay in frontend state (persisted in localStorage across reloads).

### 2. Start

`startJumpTest()` records `jumpStartSampleRef` = the **sampleNumber** the window begins at (the last buffered sample + 1).

> By sample *number*, not array index. Sample numbers survive buffer trimming, and "Start Fresh" resets numbering — which makes a stale start unreachable, so the window comes out empty and the backend rejects it with a clear error rather than computing over the wrong data.

### 3. Finish

`finishJumpTest()` in [`useJumpTest`](climbing_wall_website/src/hooks/useJumpTest.ts):

1. Finds the first reading with `sampleNumber >= jumpStartSample` and slices from there.
2. Sums the two hand boards and two foot boards per sample:
   ```
   hand[i] = [LH.X+RH.X, LH.Y+RH.Y, LH.Z+RH.Z]
   foot[i] = [LF.X+RF.X, LF.Y+RF.Y, LF.Z+RF.Z]
   ```
3. POSTs to `POST /api/jump` with `{ hand, foot, mass, wallAngle }`.

> `samplingRate` is deliberately **not** sent. The backend defaults it from the live stream's configured `dataIntervalMs` (`backend/phidget_config.json`), the single source of truth — `dt` enters the double integration squared, so a config change must not be able to silently skew the physics.

### 4. Backend computation (`backend/app.py` — `calculate_jump_height_with_angle`)

The algorithm:

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
