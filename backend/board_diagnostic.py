#!/usr/bin/env python3
"""
Per-board force diagnostic for saved recordings.

Answers the question "is this board's problem calibration, or is it mechanical?"
from a recording of known-magnitude pulls (e.g. a Federwaage / spring scale).

The key test is that a *calibration* fault can only ever rescale each axis
independently. So if no set of three per-axis scales can reproduce the known
applied magnitudes with a physically sensible direction, the fault is NOT in the
calibration and recalibrating will never fix it.

Usage
-----
    python3 backend/board_diagnostic.py <recording.csv> [--kg 10] [--board RF]

    --kg      magnitude of each applied pull, read off the spring scale
              (default 10 kg = 98.07 N). Used to grade every plateau.
    --board   restrict the plateau search to one board (LH/RH/LF/RF).
              Default: report every board that saw a load.
    --scales  extra candidate scale set(s) to fingerprint against; repeatable.

Recordings are sensor-frame Newtons (see measuring_pipeline.md), so the raw
voltage ratios are recovered as value / axisScales[i]. That needs the calibration
that was active *at capture time*, which is not necessarily the one on disk now —
so the script identifies it by noise fingerprint rather than assuming it. See
`identify_scales`.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics as st
import sys
from pathlib import Path

BOARDS = ["LH", "RH", "LF", "RF"]
BOARD_NAMES = {
    "LH": "Left Hand",
    "RH": "Right Hand",
    "LF": "Left Foot",
    "RF": "Right Foot",
}
AXES = "XYZ"
GRAVITY = 9.80665

# A channel that is behaving normally sits in this band (N per raw-voltage-ratio
# unit). Every healthy channel across all four boards falls inside it, so a value
# outside is a strong signal on its own.
FAMILY_LO, FAMILY_HI = 2.70e6, 3.00e6

SETTINGS_PATH = (
    Path(__file__).resolve().parent.parent
    / "climbing_wall_website"
    / "src"
    / "config"
    / "calibration_settings.json"
)


def load_scales(path: Path) -> list[float]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)["axisScales"]


def read_recording(path: Path) -> dict[str, list[float]]:
    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    cols: dict[str, list[float]] = {}
    for b in range(1, 5):
        for a in AXES:
            cols[f"S{b}_{a}"] = [float(r[f"S{b}_{a}"]) for r in rows]
    return cols


def magnitude(cols, b: int) -> list[float]:
    x, y, z = (cols[f"S{b}_{a}"] for a in AXES)
    return [math.sqrt(px * px + py * py + pz * pz) for px, py, pz in zip(x, y, z)]


def smooth(v: list[float], w: int = 25) -> list[float]:
    out, acc = [], 0.0
    for i, x in enumerate(v):
        acc += x
        if i >= w:
            acc -= v[i - w]
        out.append(acc / min(i + 1, w))
    return out


def find_plateaus(mag: list[float], target_n: float, min_len: int = 150) -> list[tuple[int, int]]:
    """Contiguous stretches of sustained load, trimmed to their flattest middle.

    The threshold is a fraction of the force being APPLIED, not of the board's own
    peak. Peak-relative thresholding fails whenever one pull is much larger than
    another in the same recording: a 118 N sideways pull lifts the bar above a 22 N
    pull-out on the same board, so the interesting plateau vanishes and short
    transients get picked up instead.

    A plateau must also last `min_len` samples (~1.5 s at 100 Hz). The outer 25% on
    each side is dropped so the ramp-in/ramp-out never pollutes the mean.
    """
    thresh = 0.15 * target_n
    runs, start = [], None
    for i, m in enumerate(mag):
        if m > thresh and start is None:
            start = i
        elif m <= thresh and start is not None:
            if i - start >= min_len:
                runs.append((start, i))
            start = None
    if start is not None and len(mag) - start >= min_len:
        runs.append((start, len(mag)))

    trimmed = []
    for s, e in runs:
        pad = (e - s) // 4
        trimmed.append((s + pad, e - pad))
    return trimmed


def describe(cols, b: int, seg: tuple[int, int], scales: list[float], target_n: float):
    s, e = seg
    v = {a: st.mean(cols[f"S{b}_{a}"][s:e]) for a in AXES}
    raw = {a: v[a] / scales[(b - 1) * 3 + i] for i, a in enumerate(AXES)}
    mag = math.sqrt(sum(x * x for x in v.values()))
    dominant = max(AXES, key=lambda a: abs(v[a]))
    off = [a for a in AXES if a != dominant]
    return {
        "t0": s / 100.0,
        "t1": e / 100.0,
        "v": v,
        "raw": raw,
        "mag": mag,
        "err_pct": (mag / target_n - 1) * 100,
        "dominant": dominant,
        "leak": {a: abs(v[a]) / abs(v[dominant]) for a in off},
    }


def longest_quiet_run(cols, margin_n: float = 3.0, min_len: int = 2000):
    """Longest contiguous stretch with every board unloaded.

    Needs to be long: the sampling error on a standard deviation is ~sigma/sqrt(2N),
    so a 500-sample window alone swings +/-10% and would flag healthy channels.

    "Unloaded" is measured against each board's OWN resting level, not an absolute
    Newton threshold — recordings are often un-tared, so a board can sit at 1.5 N
    at rest. The median over the whole file is that resting level (loads are always
    the minority of a recording). Thresholding the smoothed magnitude also stops a
    single noise spike from splitting an otherwise quiet run in two.
    """
    n = len(next(iter(cols.values())))
    mags = [smooth(magnitude(cols, b), 25) for b in range(1, 5)]
    limits = [st.median(m) + margin_n for m in mags]
    best = None
    start = None
    for i in range(n):
        if all(m[i] < lim for m, lim in zip(mags, limits)):
            if start is None:
                start = i
        else:
            if start is not None and i - start >= min_len:
                if best is None or i - start > best[1] - best[0]:
                    best = (start, i)
            start = None
    if start is not None and n - start >= min_len:
        if best is None or n - start > best[1] - best[0]:
            best = (start, n)
    return best


def channel_noise(cols, quiet: tuple[int, int]) -> list[float]:
    """Per-channel noise in Newtons over an unloaded stretch.

    Uses the successive-difference estimator rms(diff)/sqrt(2), which is immune
    to any slow DC drift inside the window (a plain standard deviation folds
    drift into the result and inflates it unevenly across channels).
    """
    out = []
    for b in range(1, 5):
        for a in AXES:
            v = cols[f"S{b}_{a}"][quiet[0] : quiet[1]]
            d = [v[k + 1] - v[k] for k in range(len(v) - 1)]
            out.append(math.sqrt(sum(x * x for x in d) / len(d)) / math.sqrt(2))
    return out


def scale_set_score(noise_n: list[float], scales: list[float]) -> float:
    """How uniform is the raw-referred noise under this scale set? Lower is better.

    All 12 channels share one bridge gain and one ADC, so their *electrical*
    noise expressed in raw voltage-ratio units must match. Newtons-per-raw is the
    only thing that differs, so dividing the measured Newton noise by the correct
    scale collapses all 12 onto one value. A wrong scale set leaves outliers.
    That makes this a fingerprint: it identifies which calibration wrote a CSV.
    """
    raw = [n / abs(s) for n, s in zip(noise_n, scales)]
    med = st.median(raw)
    return max(abs(r / med - 1) for r in raw)


def candidate_scale_sets(extra: list[Path] | None = None) -> list[tuple[str, list[float]]]:
    out = [("active calibration_settings.json", load_scales(SETTINGS_PATH))]
    for p in extra or []:
        out.append((f"--scales {p.name}", load_scales(p)))
    profiles = SETTINGS_PATH.parents[3] / "backend" / "calibration_profiles.json"
    if profiles.exists():
        try:
            with profiles.open(encoding="utf-8") as f:
                for p in json.load(f):
                    if isinstance(p.get("axisScales"), list) and len(p["axisScales"]) == 12:
                        out.append((f"profile {p.get('name')!r}", p["axisScales"]))
        except Exception:
            pass
    return out


def identify_scales(cols, extra: list[Path] | None = None):
    """Pick the scale set that actually produced this CSV, by noise fingerprint."""
    quiet = longest_quiet_run(cols)
    if quiet is None:
        return None, "no quiet stretch long enough to fingerprint (need ~20 s unloaded)"

    noise_n = channel_noise(cols, quiet)
    ranked = sorted(
        ((scale_set_score(noise_n, s), name, s) for name, s in candidate_scale_sets(extra)),
        key=lambda t: t[0],
    )
    score, name, scales = ranked[0]
    lines = [
        f"identified from noise fingerprint over t={quiet[0]/100:.0f}-{quiet[1]/100:.0f}s:",
        f"    -> {name}  (channel spread {score*100:.1f}%)",
    ]
    for s, n, _ in ranked[1:]:
        lines.append(f"       rejected: {n}  (spread {s*100:.1f}%)")
    if score > 0.12:
        lines.append("    WARNING: even the best match is a poor fit — no candidate")
        lines.append("             matches, so the capture-time scales are not on disk.")
    return scales, "\n  ".join(lines)


def crosstalk_model(plateaus, target_n: float, theta_deg: float):
    """Decompose each channel into "responds to its own gauge" vs "responds to another".

    Needs one pull along Y (pure sideways) and one pull out of the wall. The
    pull-out is taken as horizontal in world terms, so in sensor frame it is
    (F*sin(theta), 0, F*cos(theta)).

        raw_y = gamma * F_y                  (Y channel, assumed clean)
        raw_x = delta * F_x                  (X channel, assumed clean)
        raw_z = alpha * F_z + beta * F_y     (Z channel, possibly mixed)

    The diagnostic number is (alpha + beta) / gamma. A Wheatstone bridge sums
    four arms, so whatever fraction of the arms sits on the wrong gauge is
    *exactly* the fraction of sensitivity lost from the right one. If that ratio
    comes out at 1.0, the Z channel is reading a blend of two gauges through one
    bridge — a wiring fault. Mechanical faults (a shunted load path, a lever arm)
    have no reason to sum to one.
    """
    z_pull = next((p for p in plateaus if p["dominant"] == "Z"), None)
    y_pull = next((p for p in plateaus if p["dominant"] == "Y"), None)
    if not z_pull or not y_pull:
        return None

    # Ratios are taken on magnitudes. `raw` is value/scale, and axisScales carry
    # their own per-channel sign (the axis-sign convention is folded into them),
    # so raw signs are not comparable across channels — only sensitivities are.

    th = math.radians(theta_deg)
    # The pull direction carries a sign: left-side boards are pulled LEFT (-Y), and
    # a board can be pushed rather than pulled. Take it from the reading itself so
    # the sensitivities come out positive either way.
    sgn_y = 1.0 if y_pull["v"]["Y"] >= 0 else -1.0
    sgn_z = 1.0 if z_pull["v"]["Z"] >= 0 else -1.0
    fy = sgn_y * target_n
    fz = sgn_z * target_n * math.cos(th)
    fx = sgn_z * target_n * math.sin(th)

    gamma = y_pull["raw"]["Y"] / fy
    delta = z_pull["raw"]["X"] / fx if fx else float("nan")
    beta = y_pull["raw"]["Z"] / fy
    alpha = z_pull["raw"]["Z"] / fz
    own, foreign = abs(alpha / gamma), abs(beta / gamma)
    return {
        "own": own,
        "foreign": foreign,
        "sum": own + foreign,
        "x_rel": abs(delta / gamma),
    }


def diagonal_fix_exists(plateaus, scales: list[float], b: int, target_n: float,
                        tol: float = 0.10):
    """Can ANY per-axis rescaling reproduce the known magnitudes?

    A calibration fault can only rescale each axis independently, so sweep all
    three scales across the healthy band and ask whether any combination brings
    both pulls within `tol` of the applied force while still landing each pull on
    the axis it was actually applied along.

    The tolerance matters: the loads are hand-applied against a spring scale, so
    demanding an exact match would reject a perfectly healthy board that happens
    to read 94 N instead of 98 N. Sweeping directly (rather than solving for exact
    equality) is what makes the tolerance expressible at all.

    Returns (solutions, tried) — an empty list means no calibration can explain the
    data, so the fault is upstream of the numbers.
    """
    if len(plateaus) < 2:
        return None, 0
    p1, p2 = plateaus[0], plateaus[1]
    if p1["dominant"] == p2["dominant"]:
        return None, 0  # need two differently-directed pulls

    steps = 25
    grid = [FAMILY_LO + (FAMILY_HI - FAMILY_LO) * k / (steps - 1) for k in range(steps)]
    lo, hi = target_n * (1 - tol), target_n * (1 + tol)

    solutions, tried = [], 0
    for sx in grid:
        for sy in grid:
            for sz in grid:
                tried += 1
                cand = {"X": sx, "Y": sy, "Z": sz}
                ok = True
                for p in (p1, p2):
                    comp = {a: cand[a] * p["raw"][a] for a in AXES}
                    mag = math.sqrt(sum(v * v for v in comp.values()))
                    if not (lo <= mag <= hi):
                        ok = False
                        break
                    if max(AXES, key=lambda a: abs(comp[a])) != p["dominant"]:
                        ok = False
                        break
                if ok:
                    solutions.append(cand)
    return solutions, tried


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("recording", type=Path)
    ap.add_argument("--kg", type=float, default=10.0, help="spring-scale reading per pull (default 10)")
    ap.add_argument("--board", choices=BOARDS, help="restrict to one board")
    ap.add_argument("--theta", type=float, default=16.0,
                    help="wall decline in degrees; sets the assumed direction of a "
                         "pull-out (default 16)")
    ap.add_argument("--scales", type=Path, action="append", metavar="JSON",
                    help="extra candidate scale set(s) to fingerprint against; repeatable. Any JSON with an axisScales array of 12 numbers.")
    args = ap.parse_args()

    if not args.recording.exists():
        print(f"No such recording: {args.recording}", file=sys.stderr)
        return 1

    target_n = args.kg * GRAVITY
    cols = read_recording(args.recording)
    scales, note = identify_scales(cols, args.scales)
    if scales is None:
        print(note, file=sys.stderr)
        return 1

    print(f"Recording : {args.recording.name}")
    print(f"Applied   : {args.kg:g} kg = {target_n:.1f} N per pull")
    print(f"Scales    : {note}\n")

    wanted = [args.board] if args.board else BOARDS
    for b, key in enumerate(BOARDS, start=1):
        if key not in wanted:
            continue
        segs = find_plateaus(smooth(magnitude(cols, b)), target_n)
        if not segs:
            continue
        print(f"── {BOARD_NAMES[key]} ({key}) " + "─" * 46)
        plateaus = [describe(cols, b, seg, scales, target_n) for seg in segs]
        # find_plateaus works off each board's own peak, so a board that was never
        # loaded still yields "plateaus" out of its release transients. Anything far
        # below the applied force was not a deliberate pull — drop it.
        plateaus = [d for d in plateaus if d["mag"] > 0.25 * target_n]
        if not plateaus:
            continue
        for d in plateaus:
            flag = "OK " if abs(d["err_pct"]) < 10 else "OFF"
            leaks = ", ".join(f"{a}/{d['dominant']}={r:.2f}" for a, r in d["leak"].items())
            print(
                f"  [{flag}] t={d['t0']:5.1f}-{d['t1']:5.1f}s  "
                f"X={d['v']['X']:7.1f} Y={d['v']['Y']:7.1f} Z={d['v']['Z']:7.1f} N   "
                f"|F|={d['mag']:6.1f} N ({d['err_pct']:+.0f}%)"
            )
            print(f"         pulled along {d['dominant']}; cross-axis leak {leaks}")
            if d["dominant"] == "Z":
                # A pull-out is horizontal in world terms, so the board -- tilted by
                # theta -- legitimately sees F*sin(theta) along its surface. That X
                # is real force, not leakage. Report the angle it implies rather than
                # asserting a fault: a hand-aimed pull is never exactly horizontal, so
                # an off X/Z only means something when the magnitude is wrong too.
                implied = math.degrees(math.atan2(abs(d["v"]["X"]), abs(d["v"]["Z"])))
                msg = (
                    f"X/Z is geometry, not leak: implies a pull {implied:.0f} deg off "
                    f"the board normal (horizontal = {args.theta:g} deg)"
                )
                if abs(d["err_pct"]) > 10 and implied > args.theta * 1.4:
                    msg += "\n         magnitude is wrong too, so Z is the suspect channel"
                print(f"         {msg}")

        sols, tried = diagonal_fix_exists(plateaus, scales, b, target_n)
        if sols is None:
            print("\n  (need two pulls along different axes to test for a calibration fix)")
        elif sols:
            avg = {a: st.mean(s[a] for s in sols) for a in AXES}
            print(
                f"\n  VERDICT: a calibration fix EXISTS ({len(sols)}/{tried} candidates in band).\n"
                f"           recalibrate towards "
                + ", ".join(f"{a}={avg[a]:.3e}" for a in AXES)
            )
        else:
            print(
                f"\n  VERDICT: NO per-axis calibration can reproduce these magnitudes\n"
                f"           ({tried} candidates swept across the healthy band, none valid).\n"
                f"           Recalibrating cannot fix this board -- the fault is mechanical\n"
                f"           or electrical, upstream of the scale numbers."
            )

        cm = crosstalk_model(plateaus, target_n, args.theta)
        if cm:
            print(f"\n  CHANNEL MODEL (pull-out assumed horizontal, theta={args.theta:g} deg):")
            # X's figure divides by sin(theta), which is steep near zero: aiming the
            # pull 12 deg off instead of 16 moves it by a third. The Z figures divide
            # by cos(theta), which is flat there — same 4 deg moves them under 2%.
            # So only the Z rows carry weight; X is reported for completeness.
            print(f"    X channel  : {cm['x_rel']:.2f}x a healthy channel"
                  f"  (sensitive to aim — treat as indicative only)")
            print(f"    Y channel  : 1.00x by definition (used as the reference)")
            print(f"    Z channel  : {cm['own']:.2f}x from its OWN gauge")
            print(f"                 {cm['foreign']:.2f}x from the Y gauge (crosstalk)")
            print(f"                 ------")
            print(f"                 {cm['sum']:.2f}x total")
            if 0.90 <= cm["sum"] <= 1.10 and cm["foreign"] > 0.20:
                print(
                    "\n    -> The two contributions sum to 1.0: the Z channel is losing\n"
                    "       exactly as much of its own gauge as it gains from Y. That is\n"
                    "       what a shared Wheatstone bridge does -- some of the Z bridge's\n"
                    "       four arms are connected to the Y gauge. WIRING FAULT, not\n"
                    "       mechanics: a shunted load path or a lever arm would not\n"
                    "       conserve the total."
                )
        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
