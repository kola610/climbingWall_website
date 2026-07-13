from datetime import datetime
from pathlib import Path
import csv
import json
import queue
import re

import numpy as np
from scipy.integrate import cumulative_trapezoid

from flask import Flask, jsonify, request
from flask_sock import Sock

from phidget_stream import streamer

app = Flask(__name__)
sock = Sock(app)
SAVE_DIR = Path(__file__).resolve().parent / "saved_recordings"
SAVE_DIR.mkdir(parents=True, exist_ok=True)

# Calibration is stored inside the frontend source tree so that serialParser.ts
# imports it as its committed default; the calibration wizard POSTs updates here.
CALIB_PATH = (
    Path(__file__).resolve().parent.parent
    / "climbing_wall_website"
    / "src"
    / "config"
    / "calibration_settings.json"
)
# Only axis switches and scales are persisted. The zero offset is computed at
# runtime in the frontend (a volatile tare), never saved here.
CALIB_KEYS = ("axisSigns", "axisScales")

# Named, reusable calibration profiles (switches + scales under a user name).
# Stored as a single JSON list so they survive backend restarts. This is the
# durable library of calibrations; calibration_settings.json above is just the
# one currently active. Offsets are never stored here (runtime-only tare).
PROFILES_PATH = Path(__file__).resolve().parent / "calibration_profiles.json"

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
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def _safe_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
    return cleaned[:80] or "recording"


def _meta_path(csv_path: Path) -> Path:
    return csv_path.with_suffix(".meta.json")


def _write_meta(
    csv_path: Path,
    label: str,
    sample_count: int,
    duration_s: float,
    wall_decline_deg=None,
) -> dict:
    meta = {
        "id": csv_path.stem,
        "filename": csv_path.name,
        "created_at": datetime.now().isoformat(),
        "sample_count": sample_count,
        "duration_s": round(duration_s, 2),
        "label": label,
    }
    # The wall tilt angle θ the data was captured at — metadata only. The stored
    # values are NOT rotated by it; the frontend uses it to prefill the world-frame
    # view's angle field. Omitted for older recordings.
    if isinstance(wall_decline_deg, (int, float)):
        meta["wall_decline_deg"] = wall_decline_deg
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


def calculate_jump_height_with_angle(foot_forces, hand_forces, mass, sampling_rate, wall_angle_degrees):
    """
    Calculate jump height from wall-oriented force data with angle correction.

    Ported (Method A) from the Pi's demonstration.py so the proven numpy/scipy
    algorithm now runs computer-side on the calibrated Newton force buffer.

    foot_forces / hand_forces: numpy arrays of shape (n_samples, 3), columns
        [Fx, Fy, Fz] in wall coordinates (Newtons). foot = both feet summed,
        hand = both hands summed.
    mass: climber mass in kg
    sampling_rate: Hz
    wall_angle_degrees: wall angle from vertical (positive = overhanging)

    Returns jump height in meters (perpendicular to the wall).

    Deviation from the original: the "no zero crossing found" branch used to
    `return true_takeoff_index` (an integer sample index, not a height) — a bug.
    Here both branches fall through to the same position-based height calculation.
    """
    dt = 1.0 / sampling_rate
    time_axis = np.arange(len(foot_forces)) / sampling_rate
    wall_angle = np.radians(wall_angle_degrees)

    # Transform forces from wall coordinates to global coordinates.
    foot_global_z = foot_forces[:, 2] * np.cos(wall_angle) + foot_forces[:, 1] * np.sin(wall_angle)
    hand_global_z = hand_forces[:, 2] * np.cos(wall_angle) + hand_forces[:, 1] * np.sin(wall_angle)

    total_force_z = foot_global_z + hand_global_z

    # Net force / acceleration (downward-Z convention: weight positive in +Z).
    still_end = max(1, int(1 * sampling_rate))  # first 1 second
    mean_weight_force = np.mean(total_force_z[: still_end * 3])
    net_force_z = total_force_z - mean_weight_force
    accel_z = net_force_z / mass

    # Baseline correction.
    accel_baseline = np.mean(accel_z[:still_end])
    accel_z = accel_z - accel_baseline

    i_max_accel = int(np.argmax(foot_global_z))
    window_start = max(0, i_max_accel - 200)

    # Detect the first significant upward slope in foot force before the peak.
    # Start no earlier than index 1: at i=0 the i-1 backward difference would
    # wrap to the LAST sample (Python negative indexing), poisoning the slope.
    slope = np.zeros(len(accel_z))
    for i in range(max(window_start, 1), i_max_accel):
        slope[i] = foot_global_z[i] - foot_global_z[i - 1]

    slope_window = slope[window_start:i_max_accel]
    i_max_change_local = 0
    for i in range(len(slope_window)):
        if slope_window[i] > 10:
            i_max_change_local = i
            break
    i_max_change = window_start + i_max_change_local

    accel_z[:i_max_change] = 0  # zero everything before the true start

    # Double integration: acceleration -> velocity -> position, baseline-corrected.
    velocity_z = cumulative_trapezoid(accel_z, dx=dt, initial=0)
    velocity_z = velocity_z - np.mean(velocity_z[:still_end])
    position_z = cumulative_trapezoid(velocity_z, dx=dt, initial=0)
    position_z = position_z - np.mean(position_z[:still_end])

    # Determine the true takeoff index (first time total force drops to ~0 after
    # the acceleration peak).
    zero_crossings = np.where(np.diff(np.sign(total_force_z)))[0]
    after = zero_crossings[zero_crossings > i_max_accel]
    if len(after) == 0:
        # Fallback: first time the force falls below a small threshold.
        threshold = 20
        forces_z = total_force_z[i_max_accel:]
        below = np.where(forces_z < threshold)[0]
        true_takeoff_index = (below[0] + i_max_accel) if len(below) else i_max_accel
    else:
        true_takeoff_index = int(after[0])

    true_takeoff_index = int(np.clip(true_takeoff_index, 0, len(position_z) - 1))

    # Position-based jump height, wall-angle corrected to wall-perpendicular.
    peak_height = float(np.max(position_z) - position_z[true_takeoff_index])
    jump_height = peak_height * np.cos(wall_angle)
    return float(jump_height)


@app.route("/api/jump", methods=["POST", "OPTIONS"])
def compute_jump():
    """Compute jump height from a window of calibrated hand/foot force samples.

    Expects JSON: {
      "hand": [[Fx,Fy,Fz], ...],   # both hands summed, Newtons, wall coords
      "foot": [[Fx,Fy,Fz], ...],   # both feet summed
      "mass": <kg>,
      "wallAngle": <deg>,          # optional, default 0
      "samplingRate": <Hz>         # optional, default 100
    }
    Returns {"jumpHeightM": <m>, "jumpHeightCm": <int cm>}.
    """
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    hand = payload.get("hand")
    foot = payload.get("foot")
    mass = payload.get("mass")
    wall_angle = payload.get("wallAngle", 0)
    # Default the sampling rate from the live stream's configured interval so the
    # jump physics can never silently drift from the hardware config (dt enters
    # the double integration squared). Clients may still override explicitly.
    sampling_rate = payload.get("samplingRate")
    if sampling_rate is None:
        sampling_rate = 1000.0 / float(streamer.config.get("dataIntervalMs", 10))

    if not isinstance(hand, list) or not isinstance(foot, list):
        return jsonify({"error": "'hand' and 'foot' must be arrays of [Fx,Fy,Fz]."}), 400
    if len(hand) != len(foot) or len(foot) < 10:
        return jsonify({"error": "'hand' and 'foot' must be equal-length arrays of >= 10 samples."}), 400
    if not isinstance(mass, (int, float)) or mass <= 0:
        return jsonify({"error": "'mass' must be a positive number (kg)."}), 400
    if not isinstance(sampling_rate, (int, float)) or sampling_rate <= 0:
        return jsonify({"error": "'samplingRate' must be a positive number (Hz)."}), 400

    try:
        foot_arr = np.asarray(foot, dtype=float)
        hand_arr = np.asarray(hand, dtype=float)
        if foot_arr.ndim != 2 or foot_arr.shape[1] != 3 or hand_arr.shape != foot_arr.shape:
            return jsonify({"error": "'hand'/'foot' samples must each be [Fx, Fy, Fz]."}), 400

        height_m = calculate_jump_height_with_angle(
            foot_arr, hand_arr, float(mass), float(sampling_rate), float(wall_angle)
        )
    except Exception as err:  # never 500 on a well-shaped request
        return jsonify({"error": f"Jump computation failed: {err}"}), 400

    if not np.isfinite(height_m):
        return jsonify({"error": "Jump computation produced a non-finite result."}), 400

    return jsonify({
        "jumpHeightM": round(height_m, 4),
        "jumpHeightCm": int(round(height_m * 100)),
    }), 200


# ── Live Phidget sensor stream ───────────────────────────────────────────────
# The Phidget bridges are now attached directly to this computer (no Pi). This
# WebSocket replaces the Pi's serial stream: same line format (12 comma-
# separated raw voltage ratios, ~100 Hz), so the frontend pipeline is unchanged.

@sock.route("/api/stream")
def sensor_stream(ws):
    q = streamer.add_client()
    try:
        while True:
            try:
                line = q.get(timeout=1.0)
            except queue.Empty:
                # No sensor data (boards detached / idle). Send a heartbeat so
                # a closed socket is still detected promptly; the frontend
                # parses it as {type:"unknown"} and ignores it.
                line = "ping"
            ws.send(line)
    finally:
        streamer.remove_client(q)


@app.route("/api/phidgets/status", methods=["GET"])
def phidget_status():
    """Attach state of the 4 bridge boards; also boots the Phidget channels."""
    streamer.ensure_started()
    return jsonify(streamer.status())


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
    wall_decline_deg = payload.get("wall_decline_deg")

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
    _write_meta(filepath, display_label, count, duration_s, wall_decline_deg)

    return jsonify({
        "message": "Recording saved successfully.",
        "filename": filename,
        "path": str(filepath),
    }), 201


@app.route("/api/calibration", methods=["GET"])
def get_calibration():
    """Return the committed calibration settings, or 404 if not present."""
    if not CALIB_PATH.exists():
        return jsonify({"error": "Calibration settings not found."}), 404
    try:
        with CALIB_PATH.open(encoding="utf-8") as f:
            return jsonify(json.load(f))
    except Exception as err:
        return jsonify({"error": f"Could not read calibration: {err}"}), 500


@app.route("/api/calibration", methods=["POST", "OPTIONS"])
def save_calibration():
    """Overwrite the calibration settings file with a validated config."""
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    for key in CALIB_KEYS:
        arr = payload.get(key)
        if (
            not isinstance(arr, list)
            or len(arr) != 12
            or not all(isinstance(n, (int, float)) for n in arr)
        ):
            return jsonify({"error": f"'{key}' must be an array of 12 numbers."}), 400

    config = {key: payload[key] for key in CALIB_KEYS}
    try:
        CALIB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with CALIB_PATH.open("w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    except Exception as err:
        return jsonify({"error": f"Could not save calibration: {err}"}), 500

    return jsonify({"message": "Calibration saved.", "path": str(CALIB_PATH)}), 200


# ── Named calibration profiles ────────────────────────────────────────────────

def _calib_config_error(payload):
    """Return an error string if payload lacks valid CALIB_KEYS arrays, else None."""
    for key in CALIB_KEYS:
        arr = payload.get(key)
        if (
            not isinstance(arr, list)
            or len(arr) != 12
            or not all(isinstance(n, (int, float)) for n in arr)
        ):
            return f"'{key}' must be an array of 12 numbers."
    return None


def _read_profiles():
    if not PROFILES_PATH.exists():
        return []
    try:
        with PROFILES_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_profiles(profiles):
    with PROFILES_PATH.open("w", encoding="utf-8") as f:
        json.dump(profiles, f, indent=2)


@app.route("/api/calibration/profiles", methods=["GET"])
def list_calibration_profiles():
    """All saved calibration profiles (name + switches + scales)."""
    return jsonify({"profiles": _read_profiles()})


@app.route("/api/calibration/profiles", methods=["POST", "OPTIONS"])
def create_calibration_profile():
    """Create a new named profile from the supplied calibration config."""
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "A profile name is required."}), 400
    err = _calib_config_error(payload)
    if err:
        return jsonify({"error": err}), 400

    profiles = _read_profiles()
    if any(p.get("name") == name for p in profiles):
        return jsonify({"error": f"A profile named '{name}' already exists."}), 409

    profile = {"name": name, **{key: payload[key] for key in CALIB_KEYS}}
    profiles.append(profile)
    try:
        _write_profiles(profiles)
    except Exception as err:
        return jsonify({"error": f"Could not save profile: {err}"}), 500
    return jsonify(profile), 201


@app.route("/api/calibration/profiles/<path:name>", methods=["PUT", "DELETE", "OPTIONS"])
def modify_calibration_profile(name):
    """Update/rename (PUT) or delete (DELETE) an existing profile by name."""
    if request.method == "OPTIONS":
        return ("", 204)

    profiles = _read_profiles()
    idx = next((i for i, p in enumerate(profiles) if p.get("name") == name), None)
    if idx is None:
        return jsonify({"error": f"Profile '{name}' not found."}), 404

    if request.method == "DELETE":
        removed = profiles.pop(idx)
        try:
            _write_profiles(profiles)
        except Exception as err:
            return jsonify({"error": f"Could not delete profile: {err}"}), 500
        return jsonify({"message": f"Deleted '{removed.get('name')}'."}), 200

    # PUT — write changed config back, optionally renaming.
    payload = request.get_json(silent=True) or {}
    new_name = (payload.get("name") or name).strip()
    if not new_name:
        return jsonify({"error": "A profile name is required."}), 400
    err = _calib_config_error(payload)
    if err:
        return jsonify({"error": err}), 400
    if new_name != name and any(p.get("name") == new_name for p in profiles):
        return jsonify({"error": f"A profile named '{new_name}' already exists."}), 409

    profiles[idx] = {"name": new_name, **{key: payload[key] for key in CALIB_KEYS}}
    try:
        _write_profiles(profiles)
    except Exception as err:
        return jsonify({"error": f"Could not update profile: {err}"}), 500
    return jsonify(profiles[idx]), 200


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
    # use_reloader=False: the reloader forks a second process that would also
    # open the Phidget channels, and these bridges are single-open — the two
    # processes would fight over the hardware and neither would attach.
    app.run(debug=True, port=5001, use_reloader=False)
