# Climbing Wall — Force Sensor Dashboard

A browser-based dashboard for the SMS Lab climbing wall.  
It connects to a USB sensor device (Arduino/ADC board), visualises live force data from 4 sensors in real time, lets you record sessions, run jump tests, and compare past recordings side by side.

> **No hardware?** The dashboard also runs in **mock mode** with simulated data — useful for development or demos.

---

## What you need (prerequisites)

| Tool | Why | How to check |
|---|---|---|
| **Node.js ≥ 18** | Runs the frontend dev server | `node -v` in a terminal |
| **Python 3** | Runs the backend API | `python3 --version` |
| **Chrome or Edge** | Firefox does **not** support the Web Serial API | — |
| **USB sensor device** | Arduino/ADC board streaming force data over serial (optional — mock mode works without it) | — |

---

## Getting started

You need to start **two things**: the backend (Python) and the frontend (Node). Open **two terminal windows/tabs**.

---

### 1 — Start the backend (Python / Flask)

```bash
# Go into the backend folder
cd backend

# First time only: create a virtual environment and install Flask
python3 -m venv venv
source venv/bin/activate          # macOS / Linux
# venv\Scripts\activate           # Windows

pip install flask flask-cors

# Every time: activate the venv and run the server
source venv/bin/activate
python app.py
```

You should see something like:
```
 * Running on http://127.0.0.1:5001
```

Leave this terminal running. The backend listens on **port 5001**.

---

### 2 — Start the frontend (React / Vite)

Open a **second** terminal:

```bash
# Go into the frontend folder
cd climbing_wall_website

# First time only: install Node dependencies
npm install

# Every time: start the dev server
npm run dev
```

You should see:
```
  VITE ready in ...ms

  ➜  Local:   http://localhost:5173/
```

---

### 3 — Open the dashboard

Open **Chrome or Edge** and go to:

```
http://localhost:5173
```

That's it. The dashboard should load. If a USB sensor is plugged in, click **Connect** to start streaming live data. Otherwise it will offer mock/simulated data.

---

## Project layout

```
ClimbingWall_webPage/
├── backend/                  ← Python Flask API
│   ├── app.py                   Main server file
│   └── saved_recordings/        Where recordings are stored (CSV files)
└── climbing_wall_website/    ← React + Vite frontend
    ├── src/                     All UI source code
    ├── package.json
    └── vite.config.ts
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Install Node.js from [nodejs.org](https://nodejs.org) (choose the LTS version) |
| `python3: command not found` | Install Python from [python.org](https://python.org) |
| Frontend loads but "No backend" error | Make sure `python app.py` is running in the `backend/` folder |
| Serial connect button does nothing | Use Chrome or Edge (Firefox does not support Web Serial) |
| Port 5001 already in use | Another process is using that port. Run `lsof -i :5001` to find and stop it |
| Port 5173 already in use | Vite will automatically pick the next free port (5174, 5175, …) and print it |

---

## Stopping the servers

Press `Ctrl + C` in each terminal to stop the frontend and backend.

---

## Backend API (brief reference)

| Method | URL | What it does |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/api/recordings/save` | Save a recording |
| `GET` | `/api/recordings` | List recent recordings |
| `GET` | `/api/recordings/:id/data` | Fetch recording data |

---

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Chart.js |
| Backend | Python 3, Flask |
| Hardware I/O | Web Serial API (Chromium browsers only) |
| Storage | CSV files on disk (backend), localStorage / IndexedDB (browser) |
