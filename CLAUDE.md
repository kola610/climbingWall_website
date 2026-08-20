# CLAUDE.md

Guidance for AI agents working in this repo. Humans: start at [README.md](README.md).

## What this is

A force-measurement dashboard for the SMS Lab climbing wall. Four 3-axis load-cell
boards (PhidgetBridge) feed a Flask backend over USB; the backend broadcasts raw
readings over a WebSocket; a React frontend calibrates them to Newtons, charts them
live, records sessions, and computes jump height.

**There is no Raspberry Pi and no Web Serial.** Older comments and docs may mention
both — they are gone. The bridges plug straight into the machine running the backend.

## Commands

```bash
# Backend — port 5001. Must be running for calibration, recordings, and jump test.
cd backend && source venv/bin/activate && python app.py

# Frontend — port 5173. Proxies /api and /api/stream to 5001 (see vite.config.ts).
cd climbing_wall_website && npm run dev

npm run build     # tsc --noEmit + vite build. This is the only gate — no test runner.

# End-user PDFs — docs/GUIDES/ is gitignored, so a fresh clone has none.
cd docs && for f in *.tex; do latexmk -pdf -interaction=nonstopmode -outdir=GUIDES "$f"; done
```

No test framework is configured. `npm run build` runs TypeScript in `strict` mode with
`noUnusedLocals`/`noUnusedParameters`, which catches most breakage. The recordings window/downsample
math has `backend/test_recordings.py` (`python test_recordings.py`, run from `backend/`).
Correctness of the
physics is guarded by `wallDeclineSelfCheck()` (runs in the browser console on load in
DEV). If you change non-trivial math, extend that function rather than adding a test
framework.

## The one invariant

**Everything is stored in the SENSOR (board) frame. Never rotate on ingestion.**

`X` = along the wall (in-plane), `Y` = sideways (right), `Z` = out of the wall.
The wall-decline angle θ is applied **only at render time**, as an opt-in view
(`toDisplayFrameReadings`). The live buffer, IndexedDB, and the backend CSV all hold
sensor-frame Newtons.

This was inverted once already and caused double-corrected jump heights. If you find
yourself applying θ anywhere in `serialParser.ts`, `useSensorData.ts`, or before a
`POST`, stop — that is the bug, not the fix.

## Data flow

```
PhidgetBridge ×4  ──USB──▶  backend/phidget_stream.py
                              │  12 raw voltage ratios (~1e-6), ~100 Hz
                              ▼  WebSocket /api/stream
                            useBackendStream  ──▶  handleSerialLine  (sensor-dashboard.tsx)
                                                     │
                                            parseSerialLine
                                    remap → sign → tare → scale
                                                     │
                          ┌──────────────────────────┼──────────────────────┐
                          ▼ values (Newtons)         ▼ signedRaw            ▼ signedRaw
                    useSensorData              useCalibration          useTareOffset
                    (buffer, charts)           (wizard capture)        (zero / tare)
```

`signedRaw` is post-sign, **pre**-tare and pre-scale. The calibration wizard and the
tare both average it, so their results are independent of whatever offset/scale is
currently active. Do not feed them `values`.

## Conventions

- **GUI-slot order is `[Left Hand, Right Hand, Left Foot, Right Foot] × (X, Y, Z)`** —
  every length-12 array in the frontend. The hardware streams a different order;
  `SENSOR_GROUP_ORDER = [1, 3, 0, 2]` in `serialParser.ts` remaps it. Flat channel
  index is `board * 3 + axis`.
- **Two persisted calibration arrays only**: `axisSigns` and `axisScales`. The zero
  offset is a volatile runtime tare (`runtimeOffset.ts`), never saved to the backend.
- **No line numbers in docs.** They rot within a commit. Reference `file.ts` and the
  function name instead.
- Comments explain *why* — a physical ceiling, a non-obvious threshold, a trap.
  Migration history ("this used to be on the Pi") belongs in git, not in files.

## Traps

| Thing | Why it bites |
|---|---|
| `allSensorDataRef.current` is mutated in place | Never hand it to React state or Chart.js directly. `buildDisplaySlice` copies for exactly this reason. |
| Mock mode bypasses `parseSerialLine` | So "Zero Sensors" stays disabled with no hardware — the tare ring is never fed. Not a bug. |
| Vite ignores `src/config/calibration_settings.json` | The backend writes that file on every calibration save; without the ignore, Vite full-page-reloads and drops the stream. See `vite.config.ts`. |
| Flask runs `use_reloader=False` | The reloader forks a second process that also opens the Phidget channels. They are single-open, so both processes fail to attach. |
| `backend/calibration_profiles.json` is gitignored | Profiles are local-only. A fresh clone starts with none. |

## Docs

| File | Covers |
|---|---|
| [docs/AGENTS_HANDOVER.md](docs/AGENTS_HANDOVER.md) | Current state: in-flight work, what's unverified, rules of engagement |
| [README.md](README.md) | Setup, running, troubleshooting |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Every file and what each exported function does |
| [measuring_pipeline.md](measuring_pipeline.md) | Raw line → Newtons → storage → jump height, in depth |
| [calibration_pipeline.md](calibration_pipeline.md) | The wizard, the hang-split math, how scales are fitted |

`docs/` holds the LaTeX end-user guides and this handover. Sources are tracked; the
built PDFs (`docs/GUIDES/`) and diagram exports (`docs/diagrams/*.png`, `*.svg`) are not.
