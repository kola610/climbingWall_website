# Climbing Wall — Force Sensor Dashboard

A browser-based dashboard that reads force data from climbing wall sensors over USB serial, visualises it in real time, saves recordings, and supports side-by-side comparison of past sessions.

---

## Requirements

| Requirement | Notes |
|---|---|
| **Node.js ≥ 18** | `node -v` to check |
| **Chromium-based browser** | Firefox does not support the Web Serial API |
| **USB sensor device** | Arduino / ADC board that streams sensor data at 100 Hz |
| **Backend server** | Python Flask server (separate repo/folder) running on port 5001 |

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Configure backend URL — only needed if your backend is not on localhost:5001
cp .env.example .env
# edit VITE_BACKEND_URL if required

# 3. Start the dev server
npm run dev
```

Open **http://localhost:5173** in Chrome or Edge.

> The frontend also works without the backend — you just won't be able to save/load recordings. Mock data is generated automatically when no USB device is connected.

---

## Project layout

```
src/
  App.tsx                      Root component
  main.tsx                     Vite entry point
  index.css                    Tailwind base styles

  components/
    sensor-dashboard.tsx        Main dashboard (serial read loop, state, charts)
    dashboard/
      ConnectionStatus.tsx      USB connection indicator
      DashboardToolbar.tsx      Top bar (connect, record, export)
      SensorToggleBar.tsx       Per-sensor show/hide toggles
      comparison/
        ComparisonView.tsx      Side-by-side recording comparison
      tabs/
        ComponentsTab.tsx       X / Y / Z force component charts
        ForceMagnitudesTab.tsx  Euclidean magnitude per sensor
        JumpTestTab.tsx         Jump detection + peak force
        RecentRecordingsTab.tsx List of saved recordings

  hooks/
    useSensorData.ts            Live sensor state + data pipeline
    useSerialPort.ts            Web Serial API connection management
    useJumpTest.ts              Jump detection logic
    useRecentRecordings.ts      Fetch & manage saved recordings
    useComparisonData.ts        Load two recordings for comparison
    useDisplaySettings.ts       Persisted display preferences
    useSensorToggle.ts          Per-sensor visibility state
    usePersistedState.ts        LocalStorage-backed useState

  types/
    sensor.ts                   SensorReading interface + shared types

  constants/
    sensor.ts                   Sensor names, colours, sample-count options

  utils/
    serialParser.ts             Parses raw serial bytes → SensorReading[]
    dataProcessing.ts           Force magnitude, smoothing helpers
    chartOptions.ts             Shared Chart.js option factories
    csvExport.ts                CSV download helper
    recordingApi.ts             REST calls to the backend
    sensorStorage.ts            IndexedDB helpers (current-session data)
```

---

## Backend API

The backend exposes three endpoints (default base URL: `http://localhost:5001`):

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/recordings/save` | Save a recording (JSON body: `{ label, filename, readings }`) |
| `GET` | `/api/recordings` | List all saved recordings |
| `GET` | `/api/recordings/:id/data` | Fetch readings for a specific recording |

Set `VITE_BACKEND_URL` in `.env` if the backend is on a different host.

---

## Serial data format

The firmware sends one line per sample at ~100 Hz:

```
<sampleNumber>,<s1x>,<s1y>,<s1z>,<s2x>,<s2y>,<s2z>,<s3x>,<s3y>,<s3z>,<s4x>,<s4y>,<s4z>\n
```

12 force values (4 sensors × X/Y/Z), all raw ADC integers. Parsing lives in `src/utils/serialParser.ts`.

---

## Building for production

```bash
npm run build   # outputs to dist/
npm run preview # local preview of the production build
```
