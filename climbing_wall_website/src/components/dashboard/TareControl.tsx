import { useEffect, useState } from "react"
import { Button } from "../ui/button"
import { Crosshair, RotateCcw } from "lucide-react"

interface TareControlProps {
  /** Epoch ms of the current zero, or null if no zero has been taken yet. */
  zeroedAt: number | null
  /** True once enough samples have streamed for a trustworthy zero. */
  canTare: boolean
  /** Average recent samples and install them as the zero. */
  onTare: () => void
  /** Drop the current zero (revert to un-tared readings). */
  onClearZero: () => void
}

/** "12s" / "3m" / "1h" — compact age of the current zero. */
function formatAge(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

// Staleness thresholds for the status dot, in ms. Under a minute the zero is
// fresh; within five it's getting old; beyond that it's likely drifted and worth
// re-taking.
const FRESH_MS = 60_000
const STALE_MS = 5 * 60_000

/**
 * Toolbar control for the runtime zero (tare).
 *
 * Zeroing is on-demand and non-blocking: a recording can run with no zero, and
 * the user taps "Zero Sensors" whenever the rig is unloaded to capture a fresh
 * zero from the most recent samples. The status chip makes the state legible —
 * whether a zero has ever been taken and, if so, how stale it is — and ticks
 * once a second so "Zeroed Xs ago" stays current.
 */
export function TareControl({ zeroedAt, canTare, onTare, onClearZero }: TareControlProps) {
  // Re-render every second so the relative age stays live while idle.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (zeroedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [zeroedAt])

  const ageMs = zeroedAt === null ? null : Math.max(0, now - zeroedAt)
  const dotColor =
    ageMs === null
      ? "bg-muted-foreground/40"
      : ageMs < FRESH_MS
        ? "bg-green-500"
        : ageMs < STALE_MS
          ? "bg-amber-500"
          : "bg-red-500"

  const statusText =
    ageMs === null ? "Not zeroed yet" : `Zeroed ${formatAge(ageMs)} ago`

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={onTare}
        disabled={!canTare}
        variant="outline"
        className="flex items-center gap-2"
        title={
          canTare
            ? "Average recent samples and use them as the new zero"
            : "Connect and start streaming before zeroing"
        }
      >
        <Crosshair className="h-4 w-4" /> Zero Sensors
      </Button>

      <div
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        title={
          zeroedAt === null
            ? "Readings are un-tared until you zero the sensors."
            : "Time since the current zero was captured."
        }
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        <span className="whitespace-nowrap">{statusText}</span>
        {zeroedAt !== null && (
          <button
            type="button"
            onClick={onClearZero}
            title="Clear the zero (revert to un-tared readings)"
            className="ml-0.5 inline-flex items-center text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
