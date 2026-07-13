"""Reads the 4 PhidgetBridge boards directly on this computer and streams the
12 raw voltage ratios to WebSocket clients, replacing the Raspberry Pi.

The Pi used to read the bridges and stream one comma-separated line of 12
floats per sample (~100 Hz) over serial. The frontend's whole calibration
pipeline (remap -> sign -> tare -> scale, see serialParser.ts) is built on that
line format, so this module reproduces it byte-for-byte over a WebSocket:

    "<g0x>,<g0y>,<g0z>,<g1x>,...,<g3z>\n"    (raw voltage ratios, ~1e-6)

Group order matches the Pi's wiring convention that serialParser's
SENSOR_GROUP_ORDER = [1, 3, 0, 2] expects:
    group 0 = Left Foot, group 1 = Left Hand,
    group 2 = Right Foot, group 3 = Right Hand

Which physical bridge is which group is defined by `bridgeSerials` in
phidget_config.json (index in that list = group number). If the sensors appear
swapped in the GUI, reorder the serials there — no code change needed.
"""

from pathlib import Path
import json
import queue
import threading
import time

from Phidget22.Devices.VoltageRatioInput import VoltageRatioInput
from Phidget22.PhidgetException import PhidgetException
from Phidget22.BridgeGain import BridgeGain

CONFIG_PATH = Path(__file__).resolve().parent / "phidget_config.json"

DEFAULT_CONFIG = {
    # Bridge serial number per sensor group (index 0..3 = group 0..3).
    # Group meaning is fixed by the frontend: 0=Left Foot, 1=Left Hand,
    # 2=Right Foot, 3=Right Hand.
    "bridgeSerials": [293698, 293701, 481661, 481689],
    # Bridge input channels used per board, in (X, Y, Z) order.
    "channels": [0, 1, 2],
    # Amplifier gain — must match what the Pi used so the raw-ratio scale (and
    # therefore the saved calibration scales) stays comparable.
    "bridgeGain": 128,
    # Sample period in ms. 10 ms = 100 Hz, the rate the whole pipeline assumes
    # (e.g. /api/jump defaults to samplingRate=100).
    "dataIntervalMs": 10,
}

_GAIN_MAP = {
    1: BridgeGain.BRIDGE_GAIN_1,
    8: BridgeGain.BRIDGE_GAIN_8,
    16: BridgeGain.BRIDGE_GAIN_16,
    32: BridgeGain.BRIDGE_GAIN_32,
    64: BridgeGain.BRIDGE_GAIN_64,
    128: BridgeGain.BRIDGE_GAIN_128,
}


def _load_config() -> dict:
    config = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            with CONFIG_PATH.open(encoding="utf-8") as f:
                config.update(json.load(f))
        except Exception:
            pass  # fall back to defaults; status endpoint reveals what loaded
    else:
        # Write the defaults so the mapping is visible and editable on disk.
        try:
            with CONFIG_PATH.open("w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
        except Exception:
            pass
    return config


class PhidgetStreamer:
    """Owns the 12 VoltageRatioInput channels and fans samples out to clients.

    Channels are opened non-blocking: the streamer (and the whole backend)
    works even when boards are unplugged; channels attach whenever hardware
    appears. Each WebSocket client gets its own bounded queue — a slow client
    drops its own samples instead of stalling the others.
    """

    def __init__(self):
        self.config = _load_config()
        self._values = [0.0] * 12
        self._attached = [False] * 12
        self._inputs: list[VoltageRatioInput] = []
        self._clients: set[queue.Queue] = set()
        self._clients_lock = threading.Lock()
        self._started = False
        self._start_lock = threading.Lock()
        self._sender: threading.Thread | None = None

    # ── lifecycle ────────────────────────────────────────────────────────────

    def ensure_started(self):
        with self._start_lock:
            if self._started:
                return
            self._open_channels()
            self._sender = threading.Thread(
                target=self._broadcast_loop, name="phidget-broadcast", daemon=True
            )
            self._sender.start()
            self._started = True

    def _open_channels(self):
        # Direct USB access only. This requires the Phidget driver extension to
        # be enabled once per machine (macOS: System Settings → Privacy &
        # Security → allow the Phidgets driver). Network-server discovery was
        # deliberately NOT enabled: with the driver working, a channel silently
        # attaching through a Phidget Network Server (e.g. the Control Panel's)
        # instead of USB would be nondeterministic and confusing to debug.
        serials = self.config["bridgeSerials"]
        channels = self.config["channels"]
        gain = _GAIN_MAP.get(int(self.config.get("bridgeGain", 128)),
                             BridgeGain.BRIDGE_GAIN_128)
        interval = int(self.config.get("dataIntervalMs", 10))

        for group, serial in enumerate(serials):
            for axis, channel in enumerate(channels):
                idx = group * 3 + axis
                vri = VoltageRatioInput()
                vri.setDeviceSerialNumber(int(serial))
                vri.setChannel(int(channel))

                # Bind idx via default args — Phidget handlers are called from
                # the library's own threads.
                def on_change(ph, ratio, idx=idx):
                    self._values[idx] = ratio

                def on_attach(ph, idx=idx, gain=gain, interval=interval):
                    try:
                        ph.setBridgeGain(gain)
                        ph.setDataInterval(interval)
                    except PhidgetException:
                        pass  # keep streaming with device defaults
                    self._attached[idx] = True

                def on_detach(ph, idx=idx):
                    self._attached[idx] = False
                    # A detached channel must not keep broadcasting its last
                    # reading: frozen-at-last-value is indistinguishable from a
                    # real constant force in the charts and in recordings.
                    self._values[idx] = 0.0

                vri.setOnVoltageRatioChangeHandler(on_change)
                vri.setOnAttachHandler(on_attach)
                vri.setOnDetachHandler(on_detach)
                try:
                    vri.open()  # non-blocking; attaches when hardware appears
                except PhidgetException:
                    pass
                self._inputs.append(vri)

    # ── client fan-out ───────────────────────────────────────────────────────

    def add_client(self) -> queue.Queue:
        self.ensure_started()
        q: queue.Queue = queue.Queue(maxsize=100)
        with self._clients_lock:
            self._clients.add(q)
        return q

    def remove_client(self, q: queue.Queue):
        with self._clients_lock:
            self._clients.discard(q)

    def _broadcast_loop(self):
        interval_s = int(self.config.get("dataIntervalMs", 10)) / 1000.0
        next_tick = time.monotonic()
        while True:
            next_tick += interval_s
            delay = next_tick - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_tick = time.monotonic()  # fell behind; resync

            with self._clients_lock:
                clients = list(self._clients)
            if not clients or not any(self._attached):
                continue

            # Same wire format the Pi produced: 12 comma-separated floats.
            line = ",".join("%.9e" % v for v in self._values)
            for q in clients:
                try:
                    q.put_nowait(line)
                except queue.Full:
                    pass  # slow client: drop its sample, never block others

    # ── introspection ────────────────────────────────────────────────────────

    def status(self) -> dict:
        groups = []
        group_names = ["Left Foot", "Left Hand", "Right Foot", "Right Hand"]
        for group, serial in enumerate(self.config["bridgeSerials"]):
            axes = self._attached[group * 3: group * 3 + 3]
            groups.append({
                "group": group,
                "sensor": group_names[group],
                "serial": serial,
                "attachedAxes": sum(axes),
            })
        return {
            "started": self._started,
            "allAttached": all(self._attached),
            "attachedChannels": sum(self._attached),
            "totalChannels": len(self._attached),
            "groups": groups,
            "config": self.config,
        }


# Single shared instance; Flask imports this.
streamer = PhidgetStreamer()
