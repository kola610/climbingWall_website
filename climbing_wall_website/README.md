# Frontend — Climbing Wall Dashboard

React + TypeScript + Vite. Reads the live sensor stream from the Flask backend,
calibrates raw readings to Newtons in the browser, and charts them.

Full setup lives in the [root README](../README.md).
The file-by-file map lives in [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Commands

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc --noEmit, then bundle to dist/
npm run preview   # serve the production build
```

`npm run build` is the only automated gate — TypeScript runs in `strict` mode with
`noUnusedLocals` and `noUnusedParameters`. There is no test runner.

---

## Backend connection

`vite.config.ts` proxies to `http://localhost:5001`:

- `/api/stream` → WebSocket (listed first, so the upgrade isn't caught by the HTTP rule)
- `/api/*` → HTTP

For a non-local backend, copy `.env.example` to `.env` and set `VITE_BACKEND_URL`.

Without a backend the app still runs: it falls back to **demo mode** with generated
data. Saving, loading, calibration, and the jump test all need the backend.

> `vite.config.ts` deliberately excludes `src/config/calibration_settings.json` from the
> file watcher. The backend rewrites that file on every calibration save, and a
> full-page reload mid-session would drop the sensor stream.

---

## Stream format

One line per sample, ~100 Hz, from `/api/stream`:

```
<g0x>,<g0y>,<g0z>,<g1x>,...,<g3z>\n
```

12 **raw voltage ratios** (~1e-6), not Newtons and not ADC integers — all calibration
happens in the browser, in `src/utils/serialParser.ts`. The line carries no sample
number; the frontend assigns one. `"ping"` is a heartbeat and is ignored.

Board order on the wire is `0 = Left Foot, 1 = Left Hand, 2 = Right Foot, 3 = Right Hand`
and is remapped to GUI order by `SENSOR_GROUP_ORDER = [1, 3, 0, 2]`.

---

## Layout

```
src/
  App.tsx  main.tsx  index.css     Entry
  components/
    sensor-dashboard.tsx           Orchestrator — wires hooks together, no logic
    dashboard/                     Toolbar, modals, controls
    dashboard/tabs/                The four tabs
    dashboard/comparison/          A/B recording comparison
    ui/                            Trimmed shadcn primitives
  hooks/                           One domain concern each
  utils/                           Pure logic — parsing, calibration, geometry, API
  config/                          calibration_settings.json (written by the backend)
  constants/  types/  lib/
```

See [ARCHITECTURE.md](../ARCHITECTURE.md) for what each file and function does.
