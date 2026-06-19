import { useState, useEffect, useCallback } from "react"
import { Button } from "../ui/button"
import {
  X,
  ArrowLeft,
  Check,
  AlertTriangle,
  Crosshair,
  RotateCcw,
  Loader2,
  Triangle,
} from "lucide-react"
import { SENSOR_NAMES, FORCE_COMPONENTS } from "../../constants/sensor"
import {
  computeAxisCalibration,
  computeHangCalibration,
  GRAVITY,
  CALIBRATION_FORCE_DIRECTION,
} from "../../utils/calibration"
import type { UseCalibrationReturn } from "../../hooks/useCalibration"

interface CalibrationModalProps {
  open: boolean
  onClose: () => void
  connected: boolean
  calibration: UseCalibrationReturn
  /** Wall decline angle θ — owned by display settings, edited here in the wizard. */
  wallDeclineDeg: number
  onWallDeclineChange: (deg: number) => void
}

type Stage = "confirm" | "angle" | "boards" | "mode" | "steps"
/** "hang" calibrates X (in-plane) and Z (normal) together; "y" is sideways. */
type Mode = "hang" | "y"

interface StepState {
  weightKg: string
  /** Full averaged signed-raw array (length 12) captured at this weight. */
  raw: number[] | null
}

const DEFAULT_STEPS: StepState[] = [
  { weightKg: "0", raw: null },
  { weightKg: "10", raw: null },
  { weightKg: "20", raw: null },
]

/**
 * Since Method A the live readings are raw voltage ratios (~1e-6) and the scales
 * are Newtons-per-raw-unit (~1e6). toFixed would render both as "0.0" / lose
 * precision, so display them in scientific notation.
 */
const fmtRaw = (v: number) => v.toExponential(3)
const fmtScale = (v: number) => v.toExponential(3)

function freshSteps(): StepState[] {
  return DEFAULT_STEPS.map((s) => ({ ...s }))
}

/**
 * Full-screen calibration wizard. No Radix Dialog exists in the project, so this
 * is a lightweight `fixed inset-0` overlay following the existing Tailwind/Button
 * conventions.
 *
 * Flow: Confirm → pick a board → pick what to calibrate (Hang → X & Z, or Y) →
 * run the 0/10/20-kg (editable) capture → review → save.
 *
 * The X/Z calibration is the single-hang method: on a wall declined by θ, hanging
 * a vertical weight W loads the in-plane (X) axis by W·cosθ and the normal (Z)
 * axis by W·sinθ, so one hang calibrates both (see computeHangCalibration). The
 * wallGeometry rotation by θ then yields world-frame X (vertical) / Z (horizontal).
 */
export function CalibrationModal({
  open,
  onClose,
  connected,
  calibration,
  wallDeclineDeg,
  onWallDeclineChange,
}: CalibrationModalProps) {
  const { config, getLatestSample, captureAverages, cancelCapture, commitChannels, resetToDefaults } =
    calibration

  const [stage, setStage] = useState<Stage>("confirm")
  const [board, setBoard] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [steps, setSteps] = useState<StepState[]>(freshSteps)
  const [capturingStep, setCapturingStep] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Channels calibrated during this session, keyed "board-axis", for badges.
  const [doneAxes, setDoneAxes] = useState<Set<string>>(new Set())
  // Live signed-raw array, for the live readout.
  const [liveSample, setLiveSample] = useState<number[] | null>(null)
  // Transient "saved" confirmation shown after a successful save.
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  // Decline angle θ drives the hang split (W·cosθ → X, W·sinθ → Z) and the
  // world-frame projection. It lives in the shared display-settings store and is
  // edited right here in the wizard (see the prominent θ control below). A local
  // text mirror lets the field be cleared / typed freely; every valid number
  // commits immediately so the calibration math re-derives live.
  const declineDeg = wallDeclineDeg
  const [declineInput, setDeclineInput] = useState(String(wallDeclineDeg))

  // θ is a physical wall property — clamp to a sane range. The HTML min/max are
  // only hints and don't stop a typed value (e.g. 12000).
  const handleDeclineInput = (raw: string) => {
    setDeclineInput(raw)
    const n = parseFloat(raw)
    if (Number.isFinite(n)) onWallDeclineChange(Math.min(90, Math.max(-90, n)))
  }
  // Snap the visible text back to the committed (clamped) value on blur.
  const handleDeclineBlur = () => setDeclineInput(String(wallDeclineDeg))

  // Reset everything when the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setStage("confirm")
      setBoard(null)
      setMode(null)
      setSteps(freshSteps())
      setCapturingStep(null)
      setError(null)
      setDoneAxes(new Set())
      setSavedNotice(null)
      // Re-sync the θ field to the committed value (reads current value at open;
      // intentionally not a dep so editing θ doesn't reset the wizard).
      setDeclineInput(String(wallDeclineDeg))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Auto-dismiss the saved confirmation after a few seconds.
  useEffect(() => {
    if (!savedNotice) return
    const id = setTimeout(() => setSavedNotice(null), 4000)
    return () => clearTimeout(id)
  }, [savedNotice])

  // Poll the live signed-raw array while on the step page.
  useEffect(() => {
    if (stage !== "steps") {
      setLiveSample(null)
      return
    }
    const id = setInterval(() => setLiveSample(getLatestSample()), 100)
    return () => clearInterval(id)
  }, [stage, getLatestSample])

  const handleClose = useCallback(() => {
    if (capturingStep !== null) cancelCapture()
    onClose()
  }, [capturingStep, cancelCapture, onClose])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, handleClose])

  if (!open) return null

  // Flat channel indices for the current board.
  const xIdx = board !== null ? board * 3 + 0 : null
  const yIdx = board !== null ? board * 3 + 1 : null
  const zIdx = board !== null ? board * 3 + 2 : null

  const goBoards = () => {
    setStage("boards")
    setBoard(null)
    setMode(null)
    setSteps(freshSteps())
    setError(null)
  }

  const selectBoard = (b: number) => {
    setBoard(b)
    setMode(null)
    setStage("mode")
    setError(null)
    setSavedNotice(null)
  }

  const selectMode = (m: Mode) => {
    setMode(m)
    setSteps(freshSteps())
    setStage("steps")
    setError(null)
    setSavedNotice(null)
  }

  const updateWeight = (idx: number, value: string) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, weightKg: value, raw: null } : s)))
  }

  const captureStep = async (idx: number) => {
    if (board === null || mode === null) return
    setError(null)
    setCapturingStep(idx)
    try {
      const avg = await captureAverages()
      setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, raw: avg } : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed.")
    } finally {
      setCapturingStep(null)
    }
  }

  const weights = steps.map((s) => parseFloat(s.weightKg) || 0)
  const allCaptured = steps.every((s) => s.raw !== null)

  // θ too small → a vertical hang loads the normal (Z) axis by ~W·sinθ ≈ 0, so Z
  // can't be calibrated from a hang. Block hang calibration in that case.
  const declineTooSmall = Math.abs(declineDeg) < 1

  // Computed results for the current mode.
  const hangResult =
    mode === "hang" && allCaptured && xIdx !== null && zIdx !== null && !declineTooSmall
      ? computeHangCalibration(
          steps.map((s) => (s.raw as number[])[xIdx]),
          steps.map((s) => (s.raw as number[])[zIdx]),
          weights,
          declineDeg,
        )
      : null

  const yForceDir = yIdx !== null ? CALIBRATION_FORCE_DIRECTION[yIdx] : 1
  const yResult =
    mode === "y" && allCaptured && yIdx !== null
      ? computeAxisCalibration(
          steps.map((s) => (s.raw as number[])[yIdx]),
          weights,
          yForceDir,
        )
      : null

  const hasResult = hangResult !== null || yResult !== null

  const saveCalibration = () => {
    if (board === null) return
    if (mode === "hang" && hangResult && xIdx !== null && zIdx !== null) {
      commitChannels([
        { idx: xIdx, offset: hangResult.x.offset, scale: hangResult.x.scale },
        { idx: zIdx, offset: hangResult.z.offset, scale: hangResult.z.scale },
      ])
      setDoneAxes((prev) => new Set(prev).add(`${board}-0`).add(`${board}-2`))
      setSavedNotice(`${SENSOR_NAMES[board]} · X & Z calibrated and saved.`)
    } else if (mode === "y" && yResult && yIdx !== null) {
      commitChannels([{ idx: yIdx, offset: yResult.offset, scale: yResult.scale }])
      setDoneAxes((prev) => new Set(prev).add(`${board}-1`))
      setSavedNotice(`${SENSOR_NAMES[board]} · Y calibrated and saved.`)
    } else {
      return
    }
    // Back to the mode picker for the same board (device stays connected).
    setMode(null)
    setSteps(freshSteps())
    setError(null)
    setStage("mode")
  }

  const boardName = board !== null ? SENSOR_NAMES[board] : ""
  const liveX = liveSample && xIdx !== null ? liveSample[xIdx] : null
  const liveY = liveSample && yIdx !== null ? liveSample[yIdx] : null
  const liveZ = liveSample && zIdx !== null ? liveSample[zIdx] : null
  const w1 = parseFloat(steps[1].weightKg) || 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border bg-background p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {stage !== "confirm" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (stage === "angle") setStage("confirm")
                  else if (stage === "boards") setStage("angle")
                  else if (stage === "mode") goBoards()
                  else if (stage === "steps") setStage("mode")
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h3 className="text-lg font-semibold">Calibrate Sensors</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!connected && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No device connected. Calibration reads live sensor data — connect the
              device before capturing, or captures will time out.
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {savedNotice && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{savedNotice}</span>
          </div>
        )}

        {/* ── Stage: Confirm ── */}
        {stage === "confirm" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Calibrate each of the 4 boards. The wall is declined{" "}
              <span className="font-semibold text-foreground">{declineDeg}°</span> from
              vertical (you confirm or change this in the next step), so{" "}
              <span className="font-semibold">hanging a single known weight</span> loads both
              the X (along-wall) and Z (out-of-wall) axes at once — one hang calibrates both.
              Y (sideways) is calibrated separately.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Pick a board on the wall.</li>
              <li>Choose <em>Hang → X &amp; Z</em>, or <em>Y</em>.</li>
              <li>Apply each weight (0&nbsp;/&nbsp;10&nbsp;/&nbsp;20&nbsp;kg) and press Capture.</li>
              <li>Review the result and save.</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Saved calibration applies immediately, persists across reloads, and is
              written to <code>calibration_settings.json</code>.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => setStage("angle")}>Start Calibration</Button>
            </div>
          </div>
        )}

        {/* ── Stage: Set wall angle θ ──
            This is the ONLY place θ can change. It lives inside the calibration
            flow (not a passive settings field) so the angle can't be desynced
            from the saved X/Z scales without deliberately recalibrating. */}
        {stage === "angle" && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">Step 1 · Set the wall decline angle θ</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Set this to your wall's true lean-back from vertical. It splits a single
                vertical hang into the X (along-wall) and Z (out-of-wall) axes, so the boards
                you calibrate next are computed for exactly this angle.
              </p>
            </div>

            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <Triangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <div className="text-sm font-bold text-amber-900">
                      Wall decline angle&nbsp;θ
                    </div>
                    <p className="mt-0.5 text-xs text-amber-800">
                      How far the wall leans back from vertical (−90° to 90°).
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:pl-4">
                  <input
                    id="wallDecline"
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min={-90}
                    max={90}
                    value={declineInput}
                    onChange={(e) => handleDeclineInput(e.target.value)}
                    onBlur={handleDeclineBlur}
                    autoFocus
                    className="w-24 rounded-md border-2 border-amber-400 bg-background px-3 py-2 text-lg font-bold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-sm font-medium text-amber-800 whitespace-nowrap">
                    ° from vertical
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                θ defines how X &amp; Z are split from a hang. If you change it, recalibrate
                each board's <span className="font-semibold">Hang → X &amp; Z</span> so the
                directional forces stay correct. The overall force magnitude and Y are
                unaffected.
              </span>
            </div>

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setStage("confirm")}>
                Back
              </Button>
              <Button onClick={() => setStage("boards")}>Next — pick a board</Button>
            </div>
          </div>
        )}

        {/* ── Stage: Board picker (visual wall) ── */}
        {stage === "boards" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a board to calibrate. Hands are on top, feet on the bottom — as
              if you are facing the wall.
            </p>
            <div className="grid grid-cols-2 gap-4">
              {SENSOR_NAMES.map((name, b) => {
                const axesDone = FORCE_COMPONENTS.map((_, a) => doneAxes.has(`${b}-${a}`))
                return (
                  <button
                    key={name}
                    onClick={() => selectBoard(b)}
                    className="group flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-border bg-muted/30 p-6 transition-colors hover:border-primary hover:bg-accent"
                  >
                    <span className="text-base font-semibold">{name}</span>
                    <div className="flex gap-1.5">
                      {FORCE_COMPONENTS.map((axisName, a) => (
                        <span
                          key={axisName}
                          className={`flex h-6 w-6 items-center justify-center rounded text-xs font-medium ${
                            axesDone[a]
                              ? "bg-green-100 text-green-700"
                              : "bg-background text-muted-foreground"
                          }`}
                        >
                          {axesDone[a] ? <Check className="h-3.5 w-3.5" /> : axisName}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              A green check means that axis was calibrated in this session.
            </p>
          </div>
        )}

        {/* ── Stage: Mode picker (Hang → X & Z, or Y) ── */}
        {stage === "mode" && board !== null && xIdx !== null && yIdx !== null && zIdx !== null && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{boardName}</span>
              {" "}— what do you want to calibrate?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => selectMode("hang")}
                disabled={declineTooSmall}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-muted/30 p-5 text-center transition-colors hover:border-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-lg font-bold">Hang → X &amp; Z</span>
                <span className="text-[11px] text-muted-foreground">
                  one vertical hang, split by θ={declineDeg}°
                </span>
                <div className="text-center text-[11px] leading-tight text-muted-foreground">
                  <div>X: scale {fmtScale(config.axisScales[xIdx])}</div>
                  <div>Z: scale {fmtScale(config.axisScales[zIdx])}</div>
                </div>
                {doneAxes.has(`${board}-0`) && doneAxes.has(`${board}-2`) && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <Check className="h-3 w-3" /> done
                  </span>
                )}
              </button>
              <button
                onClick={() => selectMode("y")}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-muted/30 p-5 text-center transition-colors hover:border-primary hover:bg-accent"
              >
                <span className="text-lg font-bold">Y — sideways</span>
                <span className="text-[11px] text-muted-foreground">push left / right</span>
                <div className="text-center text-[11px] leading-tight text-muted-foreground">
                  <div>offset {fmtRaw(config.groundOffsets[yIdx])}</div>
                  <div>scale {fmtScale(config.axisScales[yIdx])}</div>
                </div>
                {doneAxes.has(`${board}-1`) && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <Check className="h-3 w-3" /> done
                  </span>
                )}
              </button>
            </div>
            {declineTooSmall && (
              <p className="text-xs text-amber-700">
                Wall decline θ is ~0°, so a vertical hang puts no load on the Z (normal)
                axis and can't calibrate it. Go back to “Set wall angle” and use a non-zero θ.
              </p>
            )}
          </div>
        )}

        {/* ── Stage: Step runner ── */}
        {stage === "steps" && board !== null && mode !== null && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">
                Calibrating{" "}
                <span className="font-semibold">
                  {boardName} · {mode === "hang" ? "X & Z (hang)" : "Y"}
                </span>
              </p>
              <div className="rounded-md bg-muted px-3 py-1 text-sm">
                Live raw:{" "}
                {mode === "hang" ? (
                  <span className="font-mono font-semibold">
                    X {liveX === null ? "—" : fmtRaw(liveX)} · Z{" "}
                    {liveZ === null ? "—" : fmtRaw(liveZ)}
                  </span>
                ) : (
                  <span className="font-mono font-semibold">
                    {liveY === null ? "—" : fmtRaw(liveY)}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
              {mode === "hang" ? (
                <>
                  Hang the known weight straight down. On the {declineDeg}°-declined wall
                  this loads the along-wall axis by W·cos{declineDeg}° (→ X) and the
                  out-of-wall axis by W·sin{declineDeg}° (→ Z), so this one hang calibrates
                  both. A hanging climber reads −X (vertical); a pull out of the wall reads +Z.
                </>
              ) : yForceDir === -1 ? (
                <>
                  Pull the known weight to the LEFT. This board's left side is −Y, so the
                  app flips the sign — a rightward force will then read +Y.
                </>
              ) : (
                <>Pull the known weight to the RIGHT — this is +Y.</>
              )}
            </div>

            <div className="space-y-2">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3"
                >
                  <span className="w-16 shrink-0 text-sm font-medium text-muted-foreground">
                    Step {i}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={step.weightKg}
                      onChange={(e) => updateWeight(i, e.target.value)}
                      className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">kg</span>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="min-w-[8rem] text-right font-mono text-xs">
                      {step.raw === null ? (
                        <span className="text-muted-foreground">not captured</span>
                      ) : mode === "hang" ? (
                        <>
                          X {fmtRaw((step.raw as number[])[xIdx as number])}
                          <br />
                          Z {fmtRaw((step.raw as number[])[zIdx as number])}
                        </>
                      ) : (
                        fmtRaw((step.raw as number[])[yIdx as number])
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant={step.raw === null ? "default" : "outline"}
                      disabled={capturingStep !== null}
                      onClick={() => captureStep(i)}
                      className="gap-1.5"
                    >
                      {capturingStep === i ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Capturing
                        </>
                      ) : (
                        <>
                          <Crosshair className="h-3.5 w-3.5" />
                          {step.raw === null ? "Capture" : "Recapture"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Result — hang (X & Z) */}
            {hangResult && xIdx !== null && zIdx !== null && (
              <div className="rounded-lg border border-green-300 bg-green-50 p-4">
                <p className="mb-2 text-sm font-semibold text-green-800">
                  Computed calibration (world frame after θ rotation)
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-background/60 p-2">
                    <div className="mb-1 font-semibold">X (vertical)</div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">offset</span>
                      <span className="font-mono">{fmtRaw(hangResult.x.offset)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">scale</span>
                      <span className="font-mono">{fmtScale(hangResult.x.scale)}</span>
                    </div>
                  </div>
                  <div className="rounded bg-background/60 p-2">
                    <div className="mb-1 font-semibold">Z (out of wall)</div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">offset</span>
                      <span className="font-mono">{fmtRaw(hangResult.z.offset)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">scale</span>
                      <span className="font-mono">{fmtScale(hangResult.z.scale)}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-green-700">
                  At {steps[1].weightKg} kg the along-wall axis sees ~
                  {(Math.cos((declineDeg * Math.PI) / 180) * w1 * GRAVITY).toFixed(0)} N and
                  the normal axis ~
                  {(Math.sin((declineDeg * Math.PI) / 180) * w1 * GRAVITY).toFixed(0)} N. After
                  the θ rotation a hang reads ≈ −{(w1 * GRAVITY).toFixed(0)} N on X and ≈ 0 N on Z.
                </p>
              </div>
            )}

            {/* Result — Y */}
            {yResult && (
              <div className="rounded-lg border border-green-300 bg-green-50 p-4">
                <p className="mb-2 text-sm font-semibold text-green-800">Computed calibration</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between rounded bg-background/60 px-3 py-1.5">
                    <span className="text-muted-foreground">Offset</span>
                    <span className="font-mono font-semibold">{fmtRaw(yResult.offset)}</span>
                  </div>
                  <div className="flex justify-between rounded bg-background/60 px-3 py-1.5">
                    <span className="text-muted-foreground">Scale (N/raw)</span>
                    <span className="font-mono font-semibold">{fmtScale(yResult.scale)}</span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-green-700">
                  At {steps[1].weightKg} kg this reads ~
                  {(((steps[1].raw as number[])[yIdx as number] - yResult.offset) * yResult.scale).toFixed(0)}{" "}
                  N (expected {(yForceDir * w1 * GRAVITY).toFixed(0)} N
                  {yForceDir === -1 ? ", negative because pulled left (−Y)" : ""}).
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setStage("mode")}>
                Back
              </Button>
              <Button disabled={!hasResult} onClick={saveCalibration} className="gap-1.5">
                <Check className="h-4 w-4" /> {mode === "hang" ? "Save X & Z" : "Save Y"}
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              if (window.confirm("Reset all calibration to the built-in defaults?")) {
                resetToDefaults()
                setDoneAxes(new Set())
              }
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </Button>
          <Button variant="outline" size="sm" onClick={handleClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
