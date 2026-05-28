interface ConnectionStatusProps {
  connected: boolean
  mockModeActive: boolean
  isCollecting: boolean
}

/**
 * Slim status bar — tells the professor at a glance what the device is doing.
 * Written in plain language, no technical jargon.
 */
export function ConnectionStatus({
  connected,
  mockModeActive,
  isCollecting,
}: ConnectionStatusProps) {
  const indicatorColor = connected
    ? "bg-green-500"
    : mockModeActive
      ? "bg-amber-400"
      : "bg-red-400"

  const deviceText = connected
    ? "Device connected"
    : mockModeActive
      ? "Demo mode — no hardware connected"
      : "No device connected"

  const recordingText = isCollecting
    ? "● Recording data…"
    : "Ready to record"

  const recordingColor = isCollecting
    ? "text-green-700 font-medium"
    : "text-muted-foreground"

  return (
    <div className="flex items-center justify-between bg-muted/60 border border-border px-3 py-2 rounded-lg text-sm">
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${indicatorColor}`} />
        <span className="text-muted-foreground">{deviceText}</span>
      </div>
      <span className={recordingColor}>{recordingText}</span>
    </div>
  )
}
