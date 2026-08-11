import { useState, useRef, useCallback, useEffect } from "react"

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? ""

/**
 * WebSocket connection to the backend sensor stream (`/api/stream`), which reads
 * the Phidget bridges and broadcasts one line of 12 comma-separated raw voltage
 * ratios per sample (~100 Hz).
 *
 * Responsibilities:
 *  - Open / close the socket. `connect()` resolves only once the socket is
 *    actually open (or has failed). Resolving early would let the user start
 *    collection while `connected` is still false, spinning up the mock generator
 *    alongside the real stream and interleaving both into one buffer.
 *  - Split incoming payloads into complete lines and deliver them via `onLine`.
 *  - After connecting, check `/api/phidgets/status` and expose `hardwareWarning`
 *    when only some of the 12 channels are attached — otherwise a partly
 *    unplugged rig looks fully "Connected" while some channels silently read 0.
 *  - Expose a `mockModeActive` ref, set when the socket can't be reached, so the
 *    rest of the app can fall back to generated data.
 *
 * `onLine` is stored in a ref internally, so callers can pass a fresh function
 * every render without stale-closure issues.
 */

/** Shape of GET /api/phidgets/status (backend/phidget_stream.py). */
interface PhidgetStatus {
  attachedChannels: number
  totalChannels: number
  groups: { sensor: string; attachedAxes: number }[]
}

/**
 * Channels attach asynchronously after the backend opens them, so wait this long
 * after the socket opens before judging how many are present.
 */
const HARDWARE_CHECK_DELAY_MS = 2000

export function useBackendStream(onLine: (line: string) => void) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Human-readable warning when the stream is up but hardware is incomplete
  // (e.g. "Only 9 of 12 sensor channels attached — check: Right Hand").
  const [hardwareWarning, setHardwareWarning] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const mockModeActiveRef = useRef(false)
  // Set true while disconnect() is tearing down, so the socket's onclose handler
  // knows the close was intentional and doesn't flip the app into mock mode.
  const intentionalCloseRef = useRef(false)
  // Keep the callback up-to-date without making it a dependency of anything.
  const onLineRef = useRef(onLine)
  onLineRef.current = onLine

  const checkHardware = useCallback(async (socket: WebSocket) => {
    await new Promise((r) => setTimeout(r, HARDWARE_CHECK_DELAY_MS))
    // The user may have disconnected (or the socket dropped) during the delay.
    if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/api/phidgets/status`)
      if (!res.ok) return
      const status = (await res.json()) as PhidgetStatus
      if (status.attachedChannels < status.totalChannels) {
        const missing = status.groups
          .filter((g) => g.attachedAxes < 3)
          .map((g) => g.sensor)
        setHardwareWarning(
          `Only ${status.attachedChannels} of ${status.totalChannels} sensor channels are attached` +
            (missing.length ? ` — check: ${missing.join(", ")}` : "") +
            ". Missing channels read 0.",
        )
      } else {
        setHardwareWarning(null)
      }
    } catch {
      // Status endpoint unreachable — the stream itself still works; stay quiet.
    }
  }, [])

  const connect = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      // Already connecting or connected — never open a second socket, it would
      // deliver every sample twice into the same pipeline.
      const existing = socketRef.current
      if (existing && existing.readyState <= WebSocket.OPEN) {
        resolve()
        return
      }

      // connect() settles exactly once, on the FIRST of open/error/close.
      // Errors resolve rather than reject: failures are reported via the `error`
      // state, not thrown to the caller.
      let settled = false
      const settle = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }

      try {
        // Relative URL through the Vite proxy (see vite.config.ts) so the same
        // build works whether served over http or https.
        const proto = location.protocol === "https:" ? "wss" : "ws"
        const url = `${proto}://${location.host}/api/stream`
        const socket = new WebSocket(url)
        socketRef.current = socket
        intentionalCloseRef.current = false

        socket.onopen = () => {
          mockModeActiveRef.current = false
          setConnected(true)
          setError(null)
          void checkHardware(socket)
          settle()
        }

        socket.onmessage = (event) => {
          // A payload may contain one or more newline-separated lines. Non-sensor
          // lines (e.g. the "ping" heartbeat) are parsed downstream as
          // {type:"unknown"} and ignored, so just forward every non-empty line.
          const data = typeof event.data === "string" ? event.data : ""
          const lines = data.split("\n")
          for (const line of lines) {
            if (line.trim()) onLineRef.current(line.trim())
          }
        }

        socket.onerror = () => {
          // onerror fires before onclose; record the failure so the close handler
          // (or the app) can fall back to mock data.
          setError("Failed to connect to sensor stream. Using mock data.")
          mockModeActiveRef.current = true
          settle()
        }

        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = null
          setConnected(false)
          setHardwareWarning(null)
          // An unexpected close (not triggered by disconnect()) means the
          // backend is unreachable — fall back to mock mode.
          if (!intentionalCloseRef.current) {
            setError("Sensor stream closed. Using mock data.")
            mockModeActiveRef.current = true
          }
          settle()
        }
      } catch (err) {
        console.error("Failed to open sensor stream:", err)
        setError("Failed to connect to sensor stream. Using mock data.")
        setConnected(false)
        mockModeActiveRef.current = true
        settle()
      }
    })
  }, [checkHardware])

  const disconnect = useCallback(async () => {
    mockModeActiveRef.current = false
    intentionalCloseRef.current = true
    if (socketRef.current) {
      try {
        socketRef.current.close()
      } catch (err) {
        console.error("Error closing sensor stream:", err)
      }
      socketRef.current = null
    }
    setConnected(false)
    setError(null)
    setHardwareWarning(null)
  }, [])

  // Close the socket when the component tree unmounts.
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true
      socketRef.current?.close()
    }
  }, [])

  return {
    connected,
    error,
    setError,
    hardwareWarning,
    mockModeActive: mockModeActiveRef,
    connect,
    disconnect,
  }
}
