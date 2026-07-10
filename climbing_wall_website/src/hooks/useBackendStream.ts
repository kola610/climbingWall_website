import { useState, useRef, useCallback, useEffect } from "react"

/**
 * Manages a WebSocket connection to the backend sensor stream.
 *
 * This is a drop-in replacement for `useSerialPort`: it exposes the exact same
 * interface so the dashboard can swap one for the other without any other
 * changes. Instead of the Web Serial API talking to a Pi over USB, it opens a
 * WebSocket to the Flask backend (`/api/stream`) which reads the Phidget bridges
 * directly and broadcasts the same line format the Pi used to send (12 comma-
 * separated raw voltage ratios per sample, ~100 Hz).
 *
 * Responsibilities:
 *  - Open / close the WebSocket.
 *  - Split incoming payloads into complete lines and deliver them via `onLine`.
 *  - Expose a `mockModeActive` ref that is set to true when the socket can't be
 *    reached, so the rest of the app can fall back to generated data.
 *  - Keep `sendCommand` as a no-op so the interface matches (the Pi's serial
 *    commands like body-weight / wall-angle are no longer sent over the wire —
 *    jump params are handled computer-side).
 *
 * The `onLine` callback is stored in a ref internally so callers never need to
 * worry about stale-closure issues — they can pass a fresh function every render
 * if needed.
 */
export function useBackendStream(onLine: (line: string) => void) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const mockModeActiveRef = useRef(false)
  // Set true while disconnect() is tearing down, so the socket's onclose handler
  // knows the close was intentional and doesn't flip the app into mock mode.
  const intentionalCloseRef = useRef(false)
  // Keep the callback up-to-date without making it a dependency of anything.
  const onLineRef = useRef(onLine)
  onLineRef.current = onLine

  const connect = useCallback(async () => {
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
      }

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        setConnected(false)
        // An unexpected close (not triggered by disconnect()) means the backend
        // is unreachable — mirror useSerialPort's fallback into mock mode.
        if (!intentionalCloseRef.current) {
          setError("Sensor stream closed. Using mock data.")
          mockModeActiveRef.current = true
        }
      }
    } catch (err) {
      console.error("Failed to open sensor stream:", err)
      setError("Failed to connect to sensor stream. Using mock data.")
      setConnected(false)
      mockModeActiveRef.current = true
    }
  }, [])

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
  }, [])

  // No-op: the Pi's serial commands (body-weight / wall-angle) are no longer
  // sent over the wire. Kept so the interface matches useSerialPort.
  const sendCommand = useCallback(async (_command: string) => {}, [])

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
    mockModeActive: mockModeActiveRef,
    connect,
    disconnect,
    sendCommand,
  }
}
