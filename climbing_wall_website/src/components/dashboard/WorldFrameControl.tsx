import { useState } from "react"
import { Axis3d, Lock, Unlock, Triangle, X } from "lucide-react"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

interface WorldFrameControlProps {
  /** Whether the world-frame view is currently active (locked). */
  locked: boolean
  /** The confirmed tilt angle θ the world view is locked at (used when locked). */
  angleDeg: number
  /** Prefill for the angle field when unlocked (a convenience — still confirmed). */
  defaultAngleDeg: number
  /** Called with the confirmed angle when the user locks the world view. */
  onLock: (angleDeg: number) => void
  /** Called to return to the default sensor-frame view. */
  onUnlock: () => void
}

/**
 * Coordinate-frame control. The default, canonical view is the raw SENSOR (board)
 * frame. World frame is an explicit, opt-in, UI-only rotation: the user types the
 * CURRENT wall tilt angle θ into a clearly labeled field and confirms it
 * ("Display in world frame using θ = X°?"). On confirm the world view is "locked"
 * at that angle and shown as a locked badge; unlocking returns to sensor frame.
 *
 * The transformation is performed graphically at render time only — the stored
 * data is never modified. Reused by both the live toolbar and the recordings tab.
 */
export function WorldFrameControl({
  locked,
  angleDeg,
  defaultAngleDeg,
  onLock,
  onUnlock,
}: WorldFrameControlProps) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [angleInput, setAngleInput] = useState(String(defaultAngleDeg))

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // Fresh each time: reset the prefill and the confirm step.
      setAngleInput(String(defaultAngleDeg))
      setConfirming(false)
    }
  }

  const parsed = parseFloat(angleInput)
  const valid = Number.isFinite(parsed) && parsed >= -90 && parsed <= 90

  const handleConfirm = () => {
    if (!valid) return
    onLock(parsed)
    setOpen(false)
    setConfirming(false)
  }

  // ── Locked: world-frame view is active ──
  if (locked) {
    return (
      <div
        className="flex h-10 items-center overflow-hidden rounded-md border border-primary/40 bg-primary/5 text-sm"
        title={`Showing world frame, rotated by θ = ${angleDeg}°. Stored data is unchanged.`}
      >
        <span className="flex h-full items-center gap-1.5 border-r border-primary/30 bg-primary/10 px-2.5 font-medium text-primary">
          <Lock className="h-3.5 w-3.5" />
          World θ = {angleDeg}°
        </span>
        <button
          onClick={onUnlock}
          className="flex h-full items-center gap-1.5 px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Unlock className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Return to sensor view</span>
          <span className="lg:hidden">Sensor</span>
        </button>
      </div>
    )
  }

  // ── Unlocked: default sensor frame, with an opt-in to world frame ──
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div
        className="flex h-10 items-center overflow-hidden rounded-md border text-sm"
        title="Default is the raw sensor (board) frame. Opt into world frame by entering and confirming the wall tilt."
      >
        <span className="flex h-full items-center gap-1.5 border-r bg-muted/40 px-2.5 text-muted-foreground">
          <Axis3d className="h-4 w-4" />
          <span className="hidden text-xs font-medium lg:inline">Sensor frame</span>
        </span>
        <PopoverTrigger asChild>
          <button className="h-full px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            View in world frame…
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent className="w-80" align="end">
        {!confirming ? (
          <div className="space-y-4">
            <div>
              <h4 className="flex items-center gap-1.5 font-semibold">
                <Triangle className="h-4 w-4 text-amber-600" />
                View in world frame
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the <span className="font-medium text-foreground">current</span> wall
                tilt to rotate X/Z into true vertical / out-of-wall. This only changes the
                display — stored data stays in the sensor frame.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="world-frame-angle" className="text-sm font-medium">
                Current wall tilt θ <span className="text-muted-foreground font-normal">(−90° to 90°)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="world-frame-angle"
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min={-90}
                  max={90}
                  value={angleInput}
                  onChange={(e) => setAngleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && valid) setConfirming(true)
                  }}
                  autoFocus
                  className="w-24 rounded-md border-2 border-amber-400 bg-background px-3 py-2 text-lg font-bold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-sm text-muted-foreground">° from vertical</span>
              </div>
              {!valid && (
                <p className="text-xs text-destructive">Enter an angle between −90° and 90°.</p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!valid} onClick={() => setConfirming(true)}>
                View in world frame
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <Triangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <h4 className="font-semibold">
                  Display in world frame using θ = {parsed}°?
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Charts will show tilt-corrected forces (X = vertical, Z = out of wall).
                  The stored data is not modified — you can return to the sensor view at
                  any time.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" onClick={handleConfirm} className="gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Confirm &amp; lock
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
