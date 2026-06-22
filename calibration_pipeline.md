# Calibration Pipeline

Calibration converts raw voltage ratios from the 4 load cell boards into correctly-scaled Newton forces. It must be run once per board. The fitted scales are intrinsic to the sensors and do **not** need re-running when the wall angle θ changes — θ is reapplied live in the measuring pipeline's rotation step (see the [Wall decline angle θ](#wall-decline-angle-θ) section).

---

## What is stored

The calibration config (`CalibrationConfig`) is 3 arrays of 12 numbers each, in **GUI-slot order**: `[Left Hand, Right Hand, Left Foot, Right Foot] × (X, Y, Z)`.

| Array | Meaning |
|---|---|
| `axisSigns` | ±1 per channel — flips axes that are physically wired backwards |
| `groundOffsets` | zero-load raw voltage reading per channel (subtracted before scaling) |
| `axisScales` | Newtons per raw-voltage-ratio unit per channel (the slope) |

Committed default values live in [`src/config/calibration_settings.json`](climbing_wall_website/src/config/calibration_settings.json). At runtime the active config is a module-level variable in [`src/utils/calibration.ts`](climbing_wall_website/src/utils/calibration.ts).

---

## Coordinate convention

```
+X  → up (toward the top of the wall)
+Y  → right (sideways)
+Z  → out of the wall (toward the climber)
```

This is the **sensor frame**. After calibration the measuring pipeline rotates X/Z into **world frame** (see `measuring_pipeline.md`). Calibration is done in sensor frame — the wizard works with sensor-frame raw values.

---

## Config priority at startup

[`loadPersistedCalibration()`](climbing_wall_website/src/utils/calibration.ts:194) in `calibration.ts` tries sources in order:

1. **Backend file** — `GET /api/calibration` → reads `calibration_settings.json` (the authoritative copy)
2. **localStorage** — key `"calibration"` (works offline / expo mode with no backend)
3. **Build-time defaults** — the JSON import baked into the bundle

Called once on mount inside [`useCalibration`](climbing_wall_website/src/hooks/useCalibration.ts:46).

---

## Wall decline angle θ

θ (degrees from vertical) is physically measured and entered in the wizard. It is **not** part of `CalibrationConfig`; it is stored separately in localStorage under key `"cw:wallDeclineDeg"` and defaults to 16°.

θ is needed **during** hang calibration only to interpret the capture: a hang gives one known number (the total weight W), and θ tells the fit how much of it landed on X (`W·cosθ`) vs Z (`W·sinθ`). So θ entered in the wizard must match the physical wall angle **at calibration time**, or the fitted scales come out wrong.

But the resulting `axisScales` are an **intrinsic sensor property** (Newtons per raw-voltage-ratio unit) and do **not** depend on θ. In the ideal orthogonal-axis model the `cosθ`/`sinθ` factors cancel in the least-squares slope (`scale = Σ(x·f)/Σ(x²)`), so the recovered scale equals the true sensor scale regardless of the angle used. A later θ change is handled automatically by the runtime rotation (`applyWallDecline`, see `measuring_pipeline.md` Step 6), which always reads the current θ — **not** by recalibrating. Recalibrating X & Z after a θ change is only worth considering as a hedge against real-world cross-axis coupling (a second-order non-ideality). Y is unaffected either way.

---

## Wizard flow (`CalibrationModal.tsx`)

```
Confirm → Set θ (angle) → Pick board → Pick mode → Capture steps → Save
```

| Stage | What happens |
|---|---|
| **confirm** | Overview; user reads the procedure |
| **angle** | Enter/confirm wall decline θ. Committed live immediately so the math below recomputes |
| **boards** | Visual 2×2 grid of the 4 boards. Green checks show already-calibrated axes |
| **mode** | Choose **Hang → X & Z** or **Y** for the selected board |
| **steps** | Capture 0 / 10 / 20 kg weight points (editable), then review and save |

The wizard takes a snapshot of `config` and θ when it opens. "Exit & discard" rolls back to that snapshot.

---

## Hang calibration — X & Z together

On a wall declined by θ, a purely vertical weight W loads:

```
X (in-plane / up-slope): W · cos θ
Z (normal / out-of-wall): W · sin θ
```

So **one hang sweep** at 0 / 10 / 20 kg calibrates both axes simultaneously. This is only valid when `|θ| ≥ 1°`; at θ = 0 the hang puts no load on Z.

**Code** — [`computeHangCalibration`](climbing_wall_website/src/utils/calibration.ts:164):

```ts
const t = (declineDeg * Math.PI) / 180
x = computeAxisCalibration(rawsX, weights, -Math.cos(t))
z = computeAxisCalibration(rawsZ, weights, +Math.sin(t))
```

The force direction for X is `−cosθ` (a hung weight is down-slope → negative X). For Z it is `+sinθ` (the hang pushes out of the wall).

---

## Y calibration

Y is sideways. The user pulls a known weight left or right. The sign depends on board side:

- **Left boards** (Left Hand, Left Foot): pull left → `forceDirection = -1` (the fitted scale flips so a rightward force reads +Y)
- **Right boards** (Right Hand, Right Foot): pull right → `forceDirection = +1`

Direction is encoded in [`CALIBRATION_FORCE_DIRECTION`](climbing_wall_website/src/utils/calibration.ts:49).

---

## `computeAxisCalibration` — the math

[`computeAxisCalibration(rawsPerStep, weightsKg, forceDirection)`](climbing_wall_website/src/utils/calibration.ts:115):

1. **offset** = `rawsPerStep[0]` (zero-load reading)
2. For each step: `x_k = rawsPerStep[k] - offset`, `f_k = forceDirection × weightsKg[k] × 9.80665`
3. **scale** = `Σ(x_k × f_k) / Σ(x_k²)` — least-squares slope through the origin

Applied in the measuring pipeline: `(signedRaw - offset) × scale ≈ force in Newtons`

If the denominator is near zero (the sensor didn't respond across weights), scale falls back to 1 to avoid division-by-zero.

---

## Sample capture machinery (`useCalibration.ts`)

Every incoming serial sample is routed to [`calibration.feedSample(signedRaw)`](climbing_wall_website/src/hooks/useCalibration.ts:59). This is the **post-sign, pre-offset, pre-scale** array — independent of whatever offset/scale is currently active, so the wizard reads true hardware values.

When the user clicks **Capture** for a step:

1. `captureAverages(150)` starts a `CaptureState` object (150 samples ≈ 1.5 s at ~100 Hz)
2. Each `feedSample` call accumulates running sums across all 12 channels
3. After 150 samples the promise resolves with the averaged array
4. The result is stored as `step.raw` for that weight step

Timeout of 8 s rejects the capture if no samples arrive (device not connected).

---

## Saving calibration

After all steps are captured and the math runs, **Save X & Z** or **Save Y** calls [`commitChannels`](climbing_wall_website/src/hooks/useCalibration.ts:122):

1. Reads the current config
2. Writes new `groundOffsets[idx]` and `axisScales[idx]` for the calibrated channels
3. Calls [`persistCalibration(next)`](climbing_wall_website/src/utils/calibration.ts:229):
   - Updates the live in-memory store (takes effect on the **next serial sample**)
   - Writes to `localStorage["calibration"]`
   - POSTs to `POST /api/calibration` → backend overwrites `calibration_settings.json`

The backend validates that all three arrays have exactly 12 finite numbers before writing.

---

## Key files

| File | Role |
|---|---|
| [`src/config/calibration_settings.json`](climbing_wall_website/src/config/calibration_settings.json) | Committed default + persisted calibration on disk |
| [`src/utils/calibration.ts`](climbing_wall_website/src/utils/calibration.ts) | Config store, math (`computeAxisCalibration`, `computeHangCalibration`), load/persist |
| [`src/hooks/useCalibration.ts`](climbing_wall_website/src/hooks/useCalibration.ts) | React hook: sample capture machinery, `commitChannels`, `restoreCalibration` |
| [`src/components/dashboard/CalibrationModal.tsx`](climbing_wall_website/src/components/dashboard/CalibrationModal.tsx) | Full-screen wizard UI |
| [`backend/app.py`](backend/app.py) | `GET/POST /api/calibration` — reads/writes `calibration_settings.json` |
