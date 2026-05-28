import { useState } from "react"
import { Button } from "../ui/button"
import { Slider } from "../ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import {
  Download,
  StopCircle,
  Play,
  RotateCcw,
  Save,
  Power,
  PowerOff,
  SlidersHorizontal,
  Settings2,
} from "lucide-react"
import { SAMPLE_COUNT_OPTIONS } from "../../constants/sensor"

interface DashboardToolbarProps {
  connected: boolean
  onConnectToggle: () => void
  isCollecting: boolean
  hasPausedData: boolean
  onCollectToggle: () => void
  onStartFresh: () => void
  canCalibrate: boolean
  onCalibrate: () => void
  canExport: boolean
  canSaveRecording: boolean
  totalSamples: number
  onExportCsv: () => void
  onSaveRecording: (name: string) => void
  displaySampleCount: number | "all"
  autoScaleY: boolean
  yAxisMax: number
  onSampleCountChange: (value: string) => void
  onAutoScaleChange: (checked: boolean) => void
  onYAxisMaxChange: (values: number[]) => void
}

/**
 * Sticky toolbar — five actions, two visual groups.
 *
 * Primary (left):  Connect / Start-Stop (the "do the experiment" actions)
 * Secondary (right): Zero Sensors / Chart Settings / Export Data
 *
 * Button copy uses plain language so a non-technical user immediately
 * understands what each button does.
 */
export function DashboardToolbar({
  connected,
  onConnectToggle,
  isCollecting,
  hasPausedData,
  onCollectToggle,
  onStartFresh,
  canCalibrate,
  onCalibrate,
  canExport,
  canSaveRecording,
  totalSamples,
  onExportCsv,
  onSaveRecording,
  displaySampleCount,
  autoScaleY,
  yAxisMax,
  onSampleCountChange,
  onAutoScaleChange,
  onYAxisMaxChange,
}: DashboardToolbarProps) {
  const [exportPopoverOpen, setExportPopoverOpen] = useState(false)
  const [savePopoverOpen, setSavePopoverOpen] = useState(false)
  const [saveName, setSaveName] = useState("")

  const handleConfirmExport = () => {
    onExportCsv()
    setExportPopoverOpen(false)
  }

  const handleSaveOpenChange = (open: boolean) => {
    setSavePopoverOpen(open)
    if (!open) setSaveName("")
  }

  const handleConfirmSave = () => {
    onSaveRecording(saveName.trim())
    setSavePopoverOpen(false)
    setSaveName("")
  }

  const durationSeconds = (totalSamples / 100).toFixed(1)

  return (
    <div className="sticky top-0 z-10 bg-background pt-2 pb-4">
      <div className="flex items-center gap-3">

        {/* ── Primary actions ── */}
        <div className="flex items-center gap-3 mr-auto">
          {/* 1. Connect / Disconnect */}
          <Button
            onClick={onConnectToggle}
            variant={connected ? "destructive" : "default"}
            className="flex items-center gap-2 px-5"
          >
            {connected ? (
              <><PowerOff className="h-4 w-4" /> Disconnect</>
            ) : (
              <><Power className="h-4 w-4" /> Connect Device</>
            )}
          </Button>

          {/* 2. Recording controls — three states: idle / recording / paused */}
          {isCollecting ? (
            /* Actively recording → offer Pause */
            <Button
              onClick={onCollectToggle}
              variant="outline"
              className="flex items-center gap-2 px-5 border-red-300 text-red-600 hover:bg-red-50"
            >
              <StopCircle className="h-4 w-4" /> Stop Recording
            </Button>
          ) : hasPausedData ? (
            /* Paused with data → offer Resume, Save, and New Recording */
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2 py-1">
              <Button
                onClick={onStartFresh}
                variant="default"
                className="flex items-center gap-2 px-5 bg-green-600 hover:bg-green-700"
              >
                <RotateCcw className="h-4 w-4" /> Start New Recording
              </Button>
              <Popover open={savePopoverOpen} onOpenChange={handleSaveOpenChange}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!canSaveRecording}
                    className="flex items-center gap-2"
                  >
                    <Save className="h-4 w-4" /> Save 
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72" align="start">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold">Save recording</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Give this recording a name so you can find it later.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="save-name" className="text-sm font-medium">
                        Name <span className="text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <input
                        id="save-name"
                        type="text"
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleConfirmSave() }}
                        placeholder="e.g. Warm-up session"
                        maxLength={60}
                        autoFocus
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <p className="text-xs text-muted-foreground">
                        A timestamp is added automatically — no duplicates possible.
                      </p>
                    </div>

                    <div className="rounded-md bg-muted p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Data points</span>
                        <span className="font-semibold">{totalSamples.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Duration</span>
                        <span className="font-semibold">~{durationSeconds} s</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleSaveOpenChange(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 gap-1"
                        onClick={handleConfirmSave}
                      >
                        <Save className="h-3.5 w-3.5" /> Save
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Popover open={exportPopoverOpen} onOpenChange={setExportPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!canExport}
                    className="flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" /> Export Data
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72" align="start">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold">Download recording</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Saves as a CSV file you can open in Excel.
                      </p>
                    </div>

                    <div className="rounded-md bg-muted p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Data points</span>
                        <span className="font-semibold">{totalSamples.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Duration</span>
                        <span className="font-semibold">~{durationSeconds} s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sensors</span>
                        <span className="font-semibold">4 (12 channels)</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setExportPopoverOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 gap-1"
                        onClick={handleConfirmExport}
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            /* Idle (no data) → offer Start */
            <Button
            onClick={onCollectToggle}
            variant="default"
            className="flex items-center gap-2 px-5 bg-green-600 hover:bg-green-700"
          >
              <Play className="h-4 w-4" /> Start Recording
            </Button>
          )}
        </div>

        {/* ── Secondary actions ── */}
        <div className="flex items-center gap-2">
          {/* 3. Zero Sensors (tare / calibrate) */}
          <Button
            onClick={onCalibrate}
            variant="outline"
            disabled={!canCalibrate}
            className="flex items-center gap-2"
            title="Sets all force readings to zero based on the current load"
          >
            <SlidersHorizontal className="h-4 w-4" /> Zero Sensors
          </Button>

          {/* 4. Chart settings popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" /> Chart Settings
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-5">
                <h4 className="font-semibold">Chart Settings</h4>

                {/* Time window */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Time window shown</label>
                  <p className="text-xs text-muted-foreground">
                    How much history to display on the chart.
                  </p>
                  <Select
                    value={displaySampleCount.toString()}
                    onValueChange={onSampleCountChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select time window" />
                    </SelectTrigger>
                    <SelectContent>
                      {SAMPLE_COUNT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Force range */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Force range (chart top)</label>
                    <span className="text-sm font-mono text-muted-foreground">{yAxisMax} N</span>
                  </div>
                  <Slider
                    value={[yAxisMax]}
                    min={100}
                    max={2000}
                    step={100}
                    onValueChange={onYAxisMaxChange}
                    disabled={autoScaleY}
                  />
                </div>

                {/* Auto-adjust */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoScale"
                    checked={autoScaleY}
                    onChange={(e) => onAutoScaleChange(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="autoScale" className="text-sm font-medium cursor-pointer">
                    Auto-adjust scale to data
                  </label>
                </div>

                <div className="flex items-center justify-between pt-2 border-t text-sm">
                  <span className="text-muted-foreground">Data points recorded</span>
                  <span className="font-semibold">{totalSamples.toLocaleString()}</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>

        </div>
      </div>
    </div>
  )
}
