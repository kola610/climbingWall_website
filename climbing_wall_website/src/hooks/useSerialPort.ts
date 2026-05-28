import { useState, useRef, useCallback, useEffect } from "react"

/**
 * Manages the Web Serial API connection lifecycle.
 *
 * Responsibilities:
 *  - Open / close the serial port.
 *  - Buffer incoming bytes into complete lines and deliver them via `onLine`.
 *  - Send text commands to the device.
 *  - Expose a `mockModeActive` ref that is set to true when no hardware is
 *    available, so the rest of the app can fall back to generated data.
 *
 * The `onLine` callback is stored in a ref internally so callers never need
 * to worry about stale-closure issues — they can pass a fresh function every
 * render if needed.
 */
export function useSerialPort(onLine: (line: string) => void) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const portRef = useRef<SerialPort | null>(null)
  const readerActiveRef = useRef(false)
  const mockModeActiveRef = useRef(false)
  // Keep the callback up-to-date without making it a dependency of anything.
  const onLineRef = useRef(onLine)
  onLineRef.current = onLine

  const startReadLoop = useCallback(async (serialPort: SerialPort) => {
    if (!serialPort.readable) return
    let buffer = ""
    try {
      const reader = serialPort.readable.getReader()
      const decoder = new TextDecoder()
      try {
        while (readerActiveRef.current) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) {
            buffer += decoder.decode(value)
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              if (line.trim()) onLineRef.current(line.trim())
            }
          }
        }
      } catch (err) {
        console.error("Serial read error:", err)
      } finally {
        reader.releaseLock()
      }
    } catch (err) {
      console.error("Serial reader setup error:", err)
    }
  }, [])

  const connect = useCallback(async () => {
    try {
      const selectedPort = await navigator.serial.requestPort()
      await selectedPort.open({ baudRate: 230400 })
      portRef.current = selectedPort
      readerActiveRef.current = true
      mockModeActiveRef.current = false
      setConnected(true)
      setError(null)
      startReadLoop(selectedPort)
    } catch (err) {
      console.error("Failed to open serial port:", err)
      setError("Failed to open serial port. Please try again.")
      setConnected(false)
      mockModeActiveRef.current = true
    }
  }, [startReadLoop])

  const disconnect = useCallback(async () => {
    readerActiveRef.current = false
    mockModeActiveRef.current = false
    if (portRef.current) {
      try {
        await portRef.current.close()
      } catch (err) {
        console.error("Error closing port:", err)
      }
      portRef.current = null
    }
    setConnected(false)
    setError(null)
  }, [])

  const sendCommand = useCallback(async (command: string) => {
    if (!portRef.current?.writable) return
    try {
      const writer = portRef.current.writable.getWriter()
      await writer.write(new TextEncoder().encode(command))
      writer.releaseLock()
    } catch (err) {
      console.error("Error sending command:", err)
      setError(`Failed to send command: ${command.trim()}`)
    }
  }, [])

  // Release the port when the component tree unmounts.
  useEffect(() => {
    return () => {
      readerActiveRef.current = false
      portRef.current?.close().catch(console.error)
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
