from datetime import datetime
from pathlib import Path
import csv
import json
import re

from flask import Flask, jsonify, request

app = Flask(__name__)
SAVE_DIR = Path(__file__).resolve().parent / "saved_recordings"
SAVE_DIR.mkdir(parents=True, exist_ok=True)

CSV_HEADERS = [
    "Timestamp",
    "Sample",
    "S1_X", "S1_Y", "S1_Z",
    "S2_X", "S2_Y", "S2_Z",
    "S3_X", "S3_Y", "S3_Z",
    "S4_X", "S4_Y", "S4_Z",
]

# Number of points returned to the frontend for chart rendering.
# Keeps payload small and charts fast even for long recordings.
MAX_CHART_POINTS = 1000


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def _safe_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
    return cleaned[:80] or "recording"


def _meta_path(csv_path: Path) -> Path:
    return csv_path.with_suffix(".meta.json")


def _write_meta(csv_path: Path, label: str, sample_count: int, duration_s: float) -> dict:
    meta = {
        "id": csv_path.stem,
        "filename": csv_path.name,
        "created_at": datetime.now().isoformat(),
        "sample_count": sample_count,
        "duration_s": round(duration_s, 2),
        "label": label,
    }
    with _meta_path(csv_path).open("w", encoding="utf-8") as f:
        json.dump(meta, f)
    return meta


def _read_or_generate_meta(csv_path: Path) -> dict:
    """Return metadata from sidecar if it exists, otherwise derive from CSV."""
    mp = _meta_path(csv_path)
    if mp.exists():
        try:
            with mp.open(encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    # Fallback: read the CSV to compute metadata (used for recordings saved
    # before the sidecar feature was added).
    rows = []
    try:
        with csv_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except Exception:
        pass

    count = len(rows)
    duration_s = 0.0
    if count >= 2:
        try:
            t0 = datetime.fromisoformat(rows[0]["Timestamp"])
            t1 = datetime.fromisoformat(rows[-1]["Timestamp"])
            duration_s = (t1 - t0).total_seconds()
        except Exception:
            pass

    return {
        "id": csv_path.stem,
        "filename": csv_path.name,
        "created_at": datetime.fromtimestamp(csv_path.stat().st_mtime).isoformat(),
        "sample_count": count,
        "duration_s": round(duration_s, 2),
        "label": csv_path.stem,
    }


@app.route("/")
def home():
    return "Hallo, Flask läuft!"


@app.route("/api/hello", methods=["GET"])
def hello():
    return jsonify({"message": "Hallo vom Backend!"})


@app.route("/api/recordings/save", methods=["POST", "OPTIONS"])
def save_recording():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    readings = payload.get("readings")
    # `label` is the raw user-provided name shown in the UI.
    # `filename` is used as the file prefix and is always sanitised.
    raw_label = str(payload.get("label", "")).strip()
    requested_name = str(payload.get("filename", raw_label)).strip()

    if not isinstance(readings, list) or len(readings) == 0:
        return jsonify({"error": "Payload must contain a non-empty 'readings' array."}), 400

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = _safe_filename_part(requested_name) if requested_name else "recording"
    filename = f"{prefix}_{timestamp}.csv"
    filepath = SAVE_DIR / filename

    written_rows: list[tuple] = []
    try:
        with filepath.open("w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(CSV_HEADERS)
            for row in readings:
                if not isinstance(row, dict):
                    continue
                values = row.get("values", [])
                if not isinstance(values, list) or len(values) != 12:
                    continue
                ts_iso = datetime.fromtimestamp(row.get("timestamp", 0) / 1000).isoformat()
                sample = row.get("sampleNumber", "")
                writer.writerow([ts_iso, sample, *values])
                written_rows.append((ts_iso, sample))
    except Exception as err:
        return jsonify({"error": f"Could not save recording: {err}"}), 500

    # Derive duration and write metadata sidecar
    count = len(written_rows)
    duration_s = 0.0
    if count >= 2:
        try:
            t0 = datetime.fromisoformat(written_rows[0][0])
            t1 = datetime.fromisoformat(written_rows[-1][0])
            duration_s = (t1 - t0).total_seconds()
        except Exception:
            pass
    # Store the user's original label for display; fall back to the sanitised prefix.
    display_label = raw_label if raw_label else (prefix if prefix != "recording" else "Recording")
    _write_meta(filepath, display_label, count, duration_s)

    return jsonify({
        "message": "Recording saved successfully.",
        "filename": filename,
        "path": str(filepath),
    }), 201


@app.route("/api/recordings", methods=["GET"])
def list_recordings():
    """Return the 5 most recent recordings, newest first."""
    metas = []
    for csv_path in SAVE_DIR.glob("*.csv"):
        try:
            meta = _read_or_generate_meta(csv_path)
            metas.append(meta)
        except Exception:
            pass
    metas.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return jsonify(metas[:5])


@app.route("/api/recordings/<recording_id>/data", methods=["GET"])
def get_recording_data(recording_id: str):
    """Return downsampled sensor readings for a single recording."""
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", recording_id)
    csv_path = SAVE_DIR / f"{safe_id}.csv"
    if not csv_path.exists():
        return jsonify({"error": "Recording not found."}), 404

    rows = []
    try:
        with csv_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except Exception as err:
        return jsonify({"error": f"Could not read recording: {err}"}), 500

    total = len(rows)

    # Downsample evenly to at most MAX_CHART_POINTS.
    # Evenly-spaced selection + frontend moving-average smoothing produces
    # charts that are visually faithful without rendering thousands of points.
    if total > MAX_CHART_POINTS:
        step = total / MAX_CHART_POINTS
        rows = [rows[int(i * step)] for i in range(MAX_CHART_POINTS)]

    readings = []
    for row in rows:
        try:
            ts_ms = int(datetime.fromisoformat(row["Timestamp"]).timestamp() * 1000)
            sample = int(float(row["Sample"]))
            values = [float(row[h]) for h in CSV_HEADERS[2:]]
            readings.append({"timestamp": ts_ms, "sampleNumber": sample, "values": values})
        except (KeyError, ValueError):
            continue

    return jsonify({
        "id": safe_id,
        "total_samples": total,
        "returned_samples": len(readings),
        "readings": readings,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
