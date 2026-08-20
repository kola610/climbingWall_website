# Architecture

Every source file and what its exported functions do. For the *flow* between them see
[measuring_pipeline.md](measuring_pipeline.md); for setup see [README.md](README.md).

Conventions used throughout:

- **GUI-slot order** — every length-12 array is `[Left Hand, Right Hand, Left Foot, Right Foot] × (X, Y, Z)`. Flat channel index = `board * 3 + axis`.
- **signedRaw** — a sample after axis-sign correction but *before* tare and scale. Tiny (~1e-6). What the calibration wizard and the tare consume.
- **values** — a sample fully calibrated to Newtons, in the sensor frame. What everything else consumes.

---

## Backend (`backend/`)

### `app.py` — Flask API and jump-height physics

| Function | Does |
|---|---|
| `calculate_jump_height_with_angle(foot, hand, mass, rate, angle)` | The jump algorithm. Projects wall-frame forces to global vertical, subtracts body weight, double-integrates acceleration → velocity → position, finds takeoff, returns height in metres. |
| `_safe_filename_part(value)` | Strips a user-supplied name to `[A-Za-z0-9_-]`, max 80 chars. |
| `_write_meta(csv_path, label, count, duration, decline)` | Writes the `.meta.json` sidecar next to a recording CSV. |
| `_read_or_generate_meta(csv_path)` | Reads the sidecar; if absent, derives metadata by reading the CSV (for pre-sidecar recordings) and writes it back, so the listing endpoint doesn't re-parse every CSV on every call. |
| `_recording_path(recording_id)` | The one place an id becomes a path. Strips everything outside `[A-Za-z0-9_-]`, so no handler can be walked out of `saved_recordings/`. |
| `_slice_and_downsample(rows, frm, to)` | Cuts to a `[from, to)` **row-position** window (not Sample numbers), then thins to ≤1000 points. Clamps reversed/out-of-range bounds instead of erroring — a range slider drags through those states constantly. |
| `_calib_config_error(payload)` | Returns an error string if `axisSigns`/`axisScales` aren't both arrays of 12 numbers, else `None`. Used by both the calibration and profile endpoints. |
| `_read_profiles()` / `_write_profiles(p)` | Load/save `calibration_profiles.json` (a JSON list). |

**Endpoints**

| Method | Path | Does |
|---|---|---|
| `WS` | `/api/stream` | Live sensor stream. One line of 12 comma-separated raw ratios per sample. Sends `"ping"` when idle so dead sockets are detected. |
| `GET` | `/api/phidgets/status` | Attach state of the 4 boards. Also boots the Phidget channels on first call. |
| `POST` | `/api/jump` | `{hand, foot, mass, wallAngle}` → `{jumpHeightM, jumpHeightCm}`. Sampling rate defaults from `phidget_config.json`. |
| `GET` | `/api/calibration` | The active `calibration_settings.json`. |
| `POST` | `/api/calibration` | Overwrite it (validated). |
| `GET` | `/api/calibration/profiles` | All named profiles. |
| `POST` | `/api/calibration/profiles` | Create one. `409` if the name exists. |
| `PUT`/`DELETE` | `/api/calibration/profiles/<name>` | Update (optionally rename) or delete. |
| `POST` | `/api/recordings/save` | Write a recording CSV + meta sidecar. |
| `GET` | `/api/recordings` | Newest first. `?limit=N` caps the list, `limit=0` returns all. Defaults to 5. |
| `GET` | `/api/recordings/<id>/data` | Readings, evenly downsampled to ≤1000 points. `?from=&to=` windows first, *then* downsamples — that ordering is what makes zoom add real resolution rather than magnifying the same dots. |
| `GET` | `/api/recordings/<id>/download` | The stored CSV verbatim, every sample, as an attachment. Deliberately not downsampled: an export is the file that was written at save time. |
| `PUT`/`DELETE` | `/api/recordings/<id>` | Rename or delete. Rename touches only the sidecar's `label`; the CSV filename and therefore the id stay stable. |
| `GET` | `/` , `/api/hello` | Health checks. |

> The active calibration is written **into the frontend source tree**
> (`climbing_wall_website/src/config/calibration_settings.json`) so the committed file
> doubles as the build-time default. `vite.config.ts` ignores it in its watcher.

### `phidget_stream.py` — hardware reader

`PhidgetStreamer`, instantiated once as the module-level `streamer` that `app.py` imports.

| Member | Does |
|---|---|
| `ensure_started()` | Idempotently opens the 12 channels and starts the broadcast thread. |
| `_open_channels()` | Opens each `VoltageRatioInput` non-blocking, so the backend runs with hardware unplugged and attaches whenever it appears. On detach a channel is forced to `0.0` — a frozen last reading is indistinguishable from a real constant force. |
| `add_client()` / `remove_client(q)` | Per-client bounded queue. A slow client drops its own samples rather than stalling others. |
| `_broadcast_loop()` | Fixed-interval fan-out of the current 12 values to every client queue. |
| `status()` | Per-board attach counts + the loaded config. Backs `/api/phidgets/status`. |

Which physical board is which body part is set by `bridgeSerials` in
`phidget_config.json` (list index = sensor group). **If sensors appear swapped in the
GUI, reorder that list — do not change code.**

### `board_diagnostic.py` — standalone forensic tool

Not imported by the app. Answers "is this board's problem calibration, or is it
mechanical?" from a recording of known-magnitude pulls:

```bash
python3 backend/board_diagnostic.py <recording.csv> [--kg 10] [--board RF]
```

Its core argument: a *calibration* fault can only rescale each axis independently, so
if no per-axis scaling can reproduce the known applied magnitudes, recalibrating will
never fix that board. `identify_scales()` fingerprints which calibration produced a CSV
by noise uniformity, since the capture-time scales may no longer be on disk.

---

## Frontend (`climbing_wall_website/src/`)

### Entry

| File | Does |
|---|---|
| `main.tsx` | React root. |
| `App.tsx` | Page shell. Runs `wallDeclineSelfCheck()` in DEV and logs failures. |
| `types/sensor.ts` | `SensorReading { timestamp, sampleNumber, values[12] }`. |
| `constants/sensor.ts` | `SENSOR_NAMES`, `FORCE_COMPONENTS`, chart colours, time-window options. |
| `lib/utils.ts` | `cn()` — Tailwind class merge. |

### `utils/` — pure logic, no React

**`serialParser.ts`** — the transform pipeline.
`parseSerialLine(line)` → `{type:"sensor", values, signedRaw}` or `{type:"unknown"}`.
Runs remap → sign → tare → scale. Rejects any line that isn't 12 finite floats.
Reads the calibration and tare stores at call time, so changes take effect on the very
next sample. **Applies no rotation** — output is sensor frame.

**`calibration.ts`** — the persisted calibration store (`axisSigns`, `axisScales`).

| Export | Does |
|---|---|
| `getCalibration()` / `setCalibration(cfg)` | Read/replace the live in-memory config. |
| `defaultCalibration()` | Deep clone of the committed JSON defaults. |
| `loadPersistedCalibration()` | Startup load: backend → localStorage → built-in defaults. Always resolves. |
| `persistCalibration(cfg)` | Writes live store + localStorage + `POST /api/calibration` (best-effort). |
| `findDefaultChannels(cfg)` | Channels whose scale still equals the factory default — i.e. never calibrated. Drives the wizard's finish warning. |
| `computeAxisCalibration(raws, weights, dir)` | Least-squares slope through the origin → `{offset, scale}`. |
| `computeHangCalibration(rawsX, rawsZ, weights, θ)` | One vertical hang calibrates both X and Z, split by θ. |
| `Y_FORCE_DIRECTION_PER_BOARD` | `[-1, 1, -1, 1]` — left boards are pulled left (−Y), so their fitted scale flips. |
| `GRAVITY` | 9.80665. |

**`runtimeOffset.ts`** — the volatile zero (tare). Deliberately *not* part of the saved
calibration. Held in signed-raw space; cached under its own localStorage key so a reload
keeps the last zero.
`getRuntimeOffset()`, `setRuntimeOffset(offset)` → timestamp, `clearRuntimeOffset()`,
`getZeroedAt()`, plus `TARE_WINDOW_SAMPLES` (150 ≈ 1.5 s) and `TARE_MIN_SAMPLES` (20).

**`wallGeometry.ts`** — the sensor→world rotation, display-only.

| Export | Does |
|---|---|
| `getWallDeclineDeg()` / `setWallDeclineDeg(d)` | The θ store (localStorage `cw:wallDeclineDeg`, default 16°). |
| `rotateSensorToWorldXZ(x, z, θ)` | The 2-D rotation: `X_world = X·cosθ − Z·sinθ`, `Z_world = X·sinθ + Z·cosθ`. |
| `applyWallDecline(values, θ)` | Applies it per board across a length-12 array. Y untouched. |
| `toDisplayFrameReadings(readings, frame, θ)` | `"sensor"` returns the same reference (memoised consumers skip work); `"world"` maps a rotated copy. |
| `wallDeclineSelfCheck()` | Three assertions: θ=0 is identity, a pure vertical load → all X, a pure normal push → `(−sinθ, cosθ)`. **Extend this when you touch the geometry.** |

**`dataProcessing.ts`** — chart data builders.
`decimate(data, maxPoints)` (even stride, always keeps the last point, returns the *same
reference* when under the cap), `sensorNorm(reading, i)`, `smoothData(data, w=5)`,
`buildNormChartData`, `buildComponentChartData`, `buildSingleSensorComparisonData`.

**`chartOptions.ts`** — `BASE_CHART_OPTIONS` (behaviour shared by every chart: animations
fully off, `normalized`, index-mode interaction, tooltip) and `createChartOptions(...)`
for the live charts, which additionally pins the y-max and pre-spans the x window.
The recordings tab spreads `BASE_CHART_OPTIONS` but keeps its own scales — it floors y
at 0 and lets Chart.js auto-scale the top.

**API clients** — `recordingApi.ts` (`saveRecordingToBackend`, `fetchRecentRecordings`,
`fetchRecordingData`, `recordingDownloadUrl`, `deleteRecording`, `renameRecording`), `jumpApi.ts` (`computeJumpHeight` — sums the two hands and two
feet, then POSTs), `calibrationProfiles.ts` (`fetchProfiles`, `createProfile`,
`updateProfile`, `deleteProfile`, `configMatchesProfile`).

**Storage/export** — `sensorStorage.ts` (IndexedDB `save`/`load`/`clearSensorData`; the
store is at v2, and the upgrade drops any v1 buffer because the canonical frame changed),
`csvExport.ts` (`buildCsvContent`, `exportToCsv(data, filename?)`).

### `hooks/`

| Hook | Owns |
|---|---|
| `useBackendStream(onLine)` | The WebSocket. `connect()` resolves only once the socket is genuinely open, so collection can't start while `connected` is still false. Exposes `hardwareWarning` when only some of the 12 channels attached, and `mockModeActive` when the backend is unreachable. |
| `useSensorData(conn, display)` | The live buffer (a mutable ref — no re-render per sample), ~20 fps UI sync, 5 s IndexedDB autosave, mock generation, and buffer trimming at 360 000 samples. |
| `useCalibration()` | The active config plus the wizard's capture machinery: `feedSample`, `captureAverages(n)` → `{avg, std}`, `commitChannels`, `getRecentStds` (the live "still swinging?" signal), `restoreCalibration`, `resetToDefaults`. |
| `useCalibrationProfiles(cal)` | The named profile library: `saveAsNew`, `saveChangesTo`, `select`, `duplicate`, `rename`, `remove`. Remembers the active profile name in localStorage. |
| `useTareOffset()` | The zero: `feedSample`, `tare()`, `clearZero()`, `zeroedAt`, `canTare`. |
| `useChannelRing(size)` | Shared fixed-size ring of 12-channel samples, written with no per-sample allocation. `feed`, `filled`, `mean(min)`, `std(min)`. Backs both the tare and the wizard's swing readout. |
| `useJumpTest(deps)` | The jump state machine. Marks the window by **sampleNumber** (not array index) so it survives buffer trimming, and is invalidated naturally by "Start Fresh". |
| `useDisplaySettings()` | Window size, y-axis, world-view lock + angle, θ. All persisted. |
| `useRecentRecordings()` | Fetch the list, auto-select the newest, load its data. |
| `useComparisonData()` | The A/B slots for comparison; loads each recording's data. |
| `useSensorToggle()` | Which sensors are visible; always keeps at least one. |
| `usePersistedState(key, default)` | `useState` mirrored into localStorage. |

### `components/`

`sensor-dashboard.tsx` is the only orchestrator: it instantiates the hooks, wires
`handleSerialLine` to the three sinks through stable refs (breaking the circular
dependency between the stream and its consumers), and composes the layout. **No business
logic belongs here.**

| Component | Does |
|---|---|
| `dashboard/DashboardToolbar` | Connect/record/save/export, plus the calibration and view trays. |
| `dashboard/TareControl` | "Zero Sensors" + a staleness dot that ticks each second. |
| `dashboard/WorldFrameControl` | Opt-in world view: enter θ, confirm, lock. |
| `dashboard/CalibrationModal` | The full wizard: confirm → θ → board → mode → capture → save. |
| `dashboard/CalibrationProfilesModal` | Save/load/rename/duplicate/delete profiles. |
| `dashboard/ConnectionStatus` | Plain-language device + recording state. |
| `dashboard/SensorToggleBar` | Per-sensor pills. |
| `tabs/ForceMagnitudesTab` | Euclidean norm per sensor, one chart. Rotation-invariant. |
| `tabs/ComponentsTab` | X/Y/Z per sensor. Shares a ~1000-point budget across visible charts. |
| `tabs/JumpTestTab` | Weight/angle entry, run controls, result. |
| `dashboard/RecordingsBrowserModal` | Browse every recording (not just the recent 5): search, rename, delete, download. |
| `tabs/RecentRecordingsTab` | Recording list, single view, compare toggle, CSV export, range zoom, and the entry point to the browser modal. |
| `comparison/ComparisonView` | Overlay and stacked A/B modes; the stacked mode's synced crosshair is a hand-written Chart.js plugin. |
| `ui/*` | Trimmed shadcn primitives (button, card, alert, tabs, select, slider, popover). Only what is used is exported. |

---

## Persisted state

**Backend disk** — `calibration_settings.json` (active calibration, written into the
frontend source tree), `calibration_profiles.json` (gitignored), `saved_recordings/*.csv`
+ `.meta.json`.

**Browser** — IndexedDB `climbing-wall/recordings` holds the live buffer. localStorage
keys: `calibration`, `tareOffset`, `activeCalibrationProfile`, and `cw:*` for display
settings (`displaySampleCount`, `autoScaleY`, `yAxisMax`, `wallDeclineDeg`,
`worldViewLocked`, `worldViewAngleDeg`, `bodyWeight`, `wallAngle`, `jumpNumber`, …).
