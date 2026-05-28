import 'katex/dist/katex.min.css'
import { InlineMath } from 'react-katex'
import { Timer, CheckCircle2 } from "lucide-react"
import { Button } from "../../ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card"

interface JumpTestTabProps {
  jumpNumber: number | null
  jumpTestActive: boolean
  jumpTestStatus: "idle" | "waiting" | "completed"
  countdown: number
  bodyWeight: string
  bodyWeightSubmitted: number | null
  wallAngle: string
  wallAngleSubmitted: number | null
  connected: boolean
  mockModeActive: boolean
  onBodyWeightChange: (value: string) => void
  onWallAngleChange: (value: string) => void
  onSendBodyWeight: () => void
  onSendWallAngle: () => void
  onStartJump: () => void
  onFinishJump: () => void
}

/**
 * Jump Test tab — laid out as a clear, numbered workflow so the professor
 * always knows what to do next.
 *
 * Layout order (top → bottom):
 *   1. Step 1 — enter test parameters (compact, side-by-side)
 *   2. Step 2 — Start / Record buttons (visually dominant)
 *   3. Live countdown (appears during a running test)
 *   4. Result (appears after recording; most prominent element)
 *   5. Demo-mode notice (only when no hardware is connected)
 */
export function JumpTestTab({
  jumpNumber,
  jumpTestActive,
  jumpTestStatus,
  countdown,
  bodyWeight,
  bodyWeightSubmitted,
  wallAngle,
  wallAngleSubmitted,
  connected,
  mockModeActive,
  onBodyWeightChange,
  onWallAngleChange,
  onSendBodyWeight,
  onSendWallAngle,
  onStartJump,
  onFinishJump,
}: JumpTestTabProps) {
  const massIndependentScore =
    jumpNumber !== null && bodyWeightSubmitted !== null && bodyWeightSubmitted > 0
      ? (jumpNumber / Math.cbrt(bodyWeightSubmitted)).toFixed(1)
      : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Jump Height Test</CardTitle>
        <p className="text-sm text-muted-foreground">
          Fill in the parameters, then run the test.
        </p>
      </CardHeader>

      <CardContent>
        <div className="max-w-lg mx-auto space-y-8 py-4">

          {/* ── Step 1: Parameters ─────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step 1 — Test parameters
            </h3>

            <div className="grid grid-cols-2 gap-4">
              {/* Body weight */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Body weight <span className="font-normal text-muted-foreground">(kg)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={bodyWeight}
                    onChange={(e) => onBodyWeightChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSendBodyWeight()}
                    placeholder="e.g. 75"
                    className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    min="1"
                    max="500"
                  />
                  <Button
                    onClick={onSendBodyWeight}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    Set
                  </Button>
                </div>
                {bodyWeightSubmitted !== null && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {bodyWeightSubmitted} kg saved
                  </p>
                )}
              </div>

              {/* Wall angle */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Wall angle <span className="font-normal text-muted-foreground">(degrees)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={wallAngle}
                    onChange={(e) => onWallAngleChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSendWallAngle()}
                    placeholder="e.g. 45"
                    className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    min="0"
                    max="90"
                    step="0.1"
                  />
                  <Button
                    onClick={onSendWallAngle}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    Set
                  </Button>
                </div>
                {wallAngleSubmitted !== null && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {wallAngleSubmitted}° saved
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── Step 2: Controls ───────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step 2 — Run the test
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <Button
                onClick={onStartJump}
                disabled={jumpTestActive}
                size="lg"
                className="h-14 text-base gap-2"
              >
                <Timer className="h-5 w-5" />
                Start Jump Test
              </Button>

              <Button
                onClick={onFinishJump}
                disabled={!jumpTestActive}
                size="lg"
                variant="secondary"
                className={`h-14 text-base gap-2 ${
                  jumpTestActive
                    ? "border-2 border-green-500 text-green-700 bg-green-50 hover:bg-green-100"
                    : ""
                }`}
              >
                <CheckCircle2 className="h-5 w-5" />
                Record Result
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Click <strong>Start</strong>, perform the jump, then click <strong>Record Result</strong>.
            </p>
          </section>

          {/* ── Live countdown (visible only during an active test) ── */}
          {jumpTestStatus === "waiting" && (
            <div className="text-center p-6 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <p className="text-amber-800 font-semibold">Test in progress — perform the jump now</p>
              <p className="text-amber-600 text-sm">
                Click <strong>Record Result</strong> when the jump is complete.
              </p>
              <div className="text-6xl font-bold tabular-nums text-amber-900 py-2">
                {countdown}
              </div>
              <p className="text-xs text-amber-600">seconds since start</p>
            </div>
          )}

          {/* ── Result (visible after recording) ──────────────────── */}
          {jumpNumber !== null && (
            <div className="text-center p-8 bg-green-50 border-2 border-green-300 rounded-xl space-y-4">
              <p className="text-green-700 text-sm font-semibold uppercase tracking-widest">
                Result
              </p>

              {/* Primary result — jump height */}
              <div>
                <div className="text-7xl font-bold tabular-nums text-green-700">
                  {jumpNumber}
                </div>
                <p className="text-green-600 text-lg font-medium mt-1">cm jump height</p>
              </div>

              {/* Secondary result — mass-independent score (only if weight was set) */}
              {massIndependentScore !== null && (
                <div className="pt-4 border-t border-green-200 space-y-1">
                  <div className="text-4xl font-semibold tabular-nums text-blue-700">
                    {massIndependentScore}
                  </div>
                  <p className="text-blue-600 text-sm">
                    Mass-independent score &nbsp;
                    <span className="text-xs text-blue-400">
                      (<InlineMath math="\frac{\text{height}}{\sqrt[3]{\text{mass}}}" />)
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Demo-mode notice ───────────────────────────────────── */}
          {!connected && mockModeActive && (
            <p className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              Demo mode — connect a device for real measurements.
            </p>
          )}

        </div>
      </CardContent>
    </Card>
  )
}
