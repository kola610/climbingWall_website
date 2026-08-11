# Climbing Wall — Force Sensor Dashboard

A browser dashboard for the SMS Lab climbing wall. Four 3-axis load-cell boards measure
the force on each hand and foot; the dashboard shows it live in Newtons, records
sessions, compares past recordings, and computes jump height.

> **No hardware?** Everything runs in **demo mode** with simulated data — useful for
> development. You just can't calibrate or zero the sensors without a live stream.

---

## What you need

| Tool | Why | Check with |
|---|---|---|
| **Python 3** | Runs the backend, reads the sensor boards | `python3 --version` |
| **Node.js ≥ 18** | Runs the frontend dev server | `node -v` |
| **4 PhidgetBridge boards** | The sensors. Plug into this computer over USB. Optional — demo mode works without them. | — |

Any modern browser works. (Earlier versions needed Chrome for the Web Serial API — that
is no longer used.)

**macOS only:** the Phidget driver needs approval once, under
*System Settings → Privacy & Security*, or no board will attach.

---

## Getting started

You need **two terminals**: one for the backend, one for the frontend.

### 1 — Backend (Python / Flask)

```bash
cd backend

# First time only
python3 -m venv venv
source venv/bin/activate          # macOS / Linux
# venv\Scripts\activate           # Windows
pip install -r requirements.txt

# Every time
source venv/bin/activate
python app.py
```

You should see `Running on http://127.0.0.1:5001`. Leave it running.

There are also `run_backend.sh` (macOS/Linux) and `run_backend.bat` (Windows) that do
the activate-and-run step for you.

### 2 — Frontend (React / Vite)

In a second terminal:

```bash
cd climbing_wall_website
npm install        # first time only
npm run dev
```

### 3 — Open it

Go to **http://localhost:5173**. Click **Connect Device** to start streaming, or just
**Start Recording** to use demo data.

The frontend proxies `/api` and the `/api/stream` WebSocket to port 5001, so both
servers must be running for calibration, recordings, and the jump test to work.

---

## First-time setup with real hardware

1. **Check the boards are seen** — connect, and watch for a warning banner. If it says
   only *N* of 12 channels are attached, a board is unplugged or the driver isn't
   approved.
2. **Fix the board order if sensors look swapped** — edit `bridgeSerials` in
   `backend/phidget_config.json`. The list index is the sensor group
   (`0 = Left Foot, 1 = Left Hand, 2 = Right Foot, 3 = Right Hand`). No code change.
3. **Calibrate** — *Calibrate* in the toolbar. Set the wall angle θ, then for each board
   run a hang (calibrates X and Z at once) and a sideways pull (Y). See
   [calibration_pipeline.md](calibration_pipeline.md).
4. **Zero before each recording** — *Zero Sensors* with the wall unloaded. This is a
   live tare, deliberately not saved with the calibration.

---

## Project layout

```
ClimbingWall_webPage/
├── CLAUDE.md                 ← start here if you're an AI agent
├── ARCHITECTURE.md           ← every file + what each function does
├── measuring_pipeline.md     ← raw reading → Newtons → storage → jump height
├── calibration_pipeline.md   ← the calibration wizard and its math
├── backend/                  ← Flask API + Phidget reader
│   ├── app.py                   API and jump-height physics
│   ├── phidget_stream.py        Reads the 4 boards, broadcasts over WebSocket
│   ├── board_diagnostic.py      Standalone: is a bad board calibration or mechanical?
│   ├── phidget_config.json      Board serials, gain, sample interval
│   └── saved_recordings/        Recordings (CSV + .meta.json sidecar)
├── climbing_wall_website/    ← React + Vite frontend
│   └── src/                     See ARCHITECTURE.md
└── docs/                     ← LaTeX end-user guides (gitignored)
```

---

## Backend API

| Method | Path | Does |
|---|---|---|
| `WS` | `/api/stream` | Live sensor stream (12 raw values per line, ~100 Hz) |
| `GET` | `/api/phidgets/status` | Which boards are attached |
| `POST` | `/api/jump` | Compute jump height from a force window |
| `GET`/`POST` | `/api/calibration` | Read / write the active calibration |
| `GET`/`POST` | `/api/calibration/profiles` | List / create named calibrations |
| `PUT`/`DELETE` | `/api/calibration/profiles/:name` | Update / delete one |
| `POST` | `/api/recordings/save` | Save a recording |
| `GET` | `/api/recordings` | 5 most recent |
| `GET` | `/api/recordings/:id/data` | Readings for one recording |

Set `VITE_BACKEND_URL` in `climbing_wall_website/.env` if the backend isn't local.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Only N of 12 sensor channels are attached" | A board is unplugged, or the Phidget driver isn't approved (macOS: Privacy & Security). Missing channels read 0. |
| Sensors look swapped in the GUI | Reorder `bridgeSerials` in `backend/phidget_config.json`. |
| No boards attach at all, backend logs look fine | Something else already has them open — the Phidget Control Panel, or a second `app.py`. They are single-open. |
| "Zero Sensors" stays greyed out | Only enabled with a live stream. Demo data bypasses the tare path. |
| Charts stay empty | Press **Start Recording**. Connecting alone doesn't buffer. |
| Frontend loads, "Failed to connect to sensor stream" | The backend isn't running on 5001. |
| Port 5001 in use | `lsof -i :5001` to find and stop it. |
| Port 5173 in use | Vite picks the next free port and prints it. |

---

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, Chart.js |
| Backend | Python 3, Flask, flask-sock, numpy, scipy |
| Hardware | PhidgetBridge over USB (`Phidget22`) |
| Storage | CSV on disk; IndexedDB + localStorage in the browser |

Build with `npm run build` (type-checks, then bundles to `dist/`). There is no test
runner — the build plus `wallDeclineSelfCheck()` in the browser console are the gates.
