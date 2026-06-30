import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { Alert, AlertDescription } from "./ui/alert"
import { BarChart, Activity, Timer, FolderOpen } from "lucide-react"

import { useSerialPort } from "../hooks/useSerialPort"
import { useSensorData } from "../hooks/useSensorData"
import { useJumpTest } from "../hooks/useJumpTest"
import { useDisplaySettings } from "../hooks/useDisplaySettings"
import { useComparisonData } from "../hooks/useComparisonData"
import { useCalibration } from "../hooks/useCalibration"
import { useTareOffset } from "../hooks/useTareOffset"

import { parseSerialLine } from "../utils/serialParser"
import { exportToCsv } from "../utils/csvExport"
import { createChartOptions } from "../utils/chartOptions"
import { saveRecordingToBackend } from "../utils/recordingApi"
import { toDisplayFrameReadings } from "../utils/wallGeometry"

import { DashboardToolbar } from "./dashboard/DashboardToolbar"
import { CalibrationModal } from "./dashboard/CalibrationModal"
import { ConnectionStatus } from "./dashboard/ConnectionStatus"
import { ForceMagnitudesTab } from "./dashboard/tabs/ForceMagnitudesTab"
import { ComponentsTab } from "./dashboard/tabs/ComponentsTab"
import { JumpTestTab } from "./dashboard/tabs/JumpTestTab"
import { RecentRecordingsTab } from "./dashboard/tabs/RecentRecordingsTab"

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
)

/**
 * Top-level dashboard component.
 *
 * Responsibilities (and only these):
 *  1. Instantiate domain hooks and wire their dependencies together.
 *  2. Route incoming serial lines to the correct handler (sensor data vs. jump
 *     messages) via the `handleSerialLine` dispatcher.
 *  3. Compose the page layout from purely presentational sub-components.
 *
 * No business logic, data processing, or serial I/O belongs here.
 */
export default function SensorDashboard() {
  const [activeTab, setActiveTab] = useState("norms")
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null)
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  // Incrementing this after a successful save makes RecentRecordingsTab
  // re-fetch the list and auto-select the newly saved recording.
  const [saveCount, setSaveCount] = useState(0)

  // Comparison state lives here (not inside RecentRecordingsTab) so that
  // switching to another tab and back does not reset the selection.
  const [compareMode, setCompareMode] = useState(false)
  const comparison = useComparisonData()

  const [showCalibration, setShowCalibration] = useState(false)
  const calibration = useCalibration()
  const tare = useTareOffset()

  // --- Step 1: stable dispatcher refs ---
  // These refs break the circular dependency between useSerialPort (which needs
  // to call handlers) and useSensorData / useJumpTest (which need the port).
  // They are updated every render so hook implementations never go stale.
  const addSensorReadingRef = useRef<((values: number[]) => void) | null>(null)
  const calibrationSinkRef = useRef<((signedRaw: number[]) => void) | null>(null)
  const tareSinkRef = useRef<((signedRaw: number[]) => void) | null>(null)

  const handleSerialLine = useCallback((line: string) => {
    const msg = parseSerialLine(line)
    if (msg.type === "sensor") {
      addSensorReadingRef.current?.(msg.values)
      // Both the calibration wizard and the runtime tare average signed-raw
      // (pre-offset, pre-scale) samples, so they each get the raw stream.
      calibrationSinkRef.current?.(msg.signedRaw)
      tareSinkRef.current?.(msg.signedRaw)
    }
    // Jump height is no longer reported over serial — it is computed from the
    // calibrated buffer on jump-finish (see useJumpTest / backend /api/jump).
  }, []) // intentionally stable — reads from refs at call time

  // --- Step 2: domain hooks ---
  const serial = useSerialPort(handleSerialLine)

  const displaySettings = useDisplaySettings()

  const sensorData = useSensorData(
    {
      isConnected: serial.connected,
      mockModeActive: serial.mockModeActive,
    },
    {
      displaySampleCount: displaySettings.displaySampleCount,
    },
  )

  const jumpTest = useJumpTest({
    isConnected: serial.connected,
    mockModeActive: serial.mockModeActive,
    setError: serial.setError,
    allSensorDataRef: sensorData.allSensorDataRef,
  })

  // --- Step 3: keep dispatcher refs current ---
  addSensorReadingRef.current = sensorData.addSensorReading
  calibrationSinkRef.current = calibration.feedSample
  tareSinkRef.current = tare.feedSample

  // --- Step 4: orchestrated actions ---
  const handleConnectToggle = async () => {
    if (serial.connected) {
      sensorData.stopCollection()
      jumpTest.reset()
      await serial.disconnect()
    } else {
      await serial.connect()
    }
  }

  // --- Step 5: derived values for presentational layer ---
  // Re-express the live window in the chosen coordinate frame. Sensor (the stored
  // canonical) returns the same array reference, so this is free unless the user
  // has locked the world view. World frame applies the wall-decline rotation at
  // the confirmed angle — purely at the display layer. The norm-based charts are
  // rotation-invariant, so only the directional "Force by Direction" view changes.
  const displayDataForCharts = useMemo(
    () =>
      toDisplayFrameReadings(
        sensorData.displayData,
        displaySettings.coordinateFrame,
        displaySettings.worldViewAngleDeg,
      ),
    [sensorData.displayData, displaySettings.coordinateFrame, displaySettings.worldViewAngleDeg],
  )

  // Memoised so the options object keeps a stable reference between renders
  // that don't touch its inputs, letting memoised chart components skip
  // unnecessary Chart.js updates. Built from the frame-adjusted data so the
  // y-axis auto-scaling matches what is actually plotted.
  const chartOptions = useMemo(
    () =>
      createChartOptions(
        displayDataForCharts,
        displaySettings.yAxisMax,
        displaySettings.displaySampleCount,
        displaySettings.autoScaleY,
      ),
    [
      displayDataForCharts,
      displaySettings.yAxisMax,
      displaySettings.displaySampleCount,
      displaySettings.autoScaleY,
    ],
  )

  const handleSaveRecording = async (name: string) => {
    const currentData = sensorData.allSensorDataRef.current
    if (currentData.length === 0) {
      setSaveErrorMessage("No data available to save yet.")
      setSaveStatusMessage(null)
      return
    }

    try {
      const result = await saveRecordingToBackend(currentData, name)
      const displayName = name || result.filename
      setSaveStatusMessage(`Saved as "${displayName}"`)
      setSaveErrorMessage(null)
      setSaveCount((c) => c + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save recording."
      setSaveErrorMessage(message)
      setSaveStatusMessage(null)
    }
  }

  useEffect(() => {
    if (!saveStatusMessage) return
    const timeoutId = setTimeout(() => {
      setSaveStatusMessage(null)
    }, 5000)
    return () => clearTimeout(timeoutId)
  }, [saveStatusMessage])

  return (
    <div className="space-y-6">
      {serial.error && (
        <Alert variant="destructive">
          <AlertDescription>{serial.error}</AlertDescription>
        </Alert>
      )}

      {saveStatusMessage && (
        <Alert className="border-green-300 bg-green-50 text-green-800">
          <AlertDescription>{saveStatusMessage}</AlertDescription>
        </Alert>
      )}

      {saveErrorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{saveErrorMessage}</AlertDescription>
        </Alert>
      )}

      <DashboardToolbar
        connected={serial.connected}
        isCollecting={sensorData.isCollecting}
        hasPausedData={!sensorData.isCollecting && sensorData.totalSamples > 0}
        totalSamples={sensorData.totalSamples}
        onOpenCalibration={() => setShowCalibration(true)}
        canExport={sensorData.totalSamples > 0}
        canSaveRecording={sensorData.totalSamples > 0}
        displaySampleCount={displaySettings.displaySampleCount}
        autoScaleY={displaySettings.autoScaleY}
        yAxisMax={displaySettings.yAxisMax}
        worldViewLocked={displaySettings.worldViewLocked}
        worldViewAngleDeg={displaySettings.worldViewAngleDeg}
        wallDeclineDeg={displaySettings.wallDeclineDeg}
        zeroedAt={tare.zeroedAt}
        canTare={tare.canTare}
        onTare={tare.tare}
        onClearZero={tare.clearZero}
        onConnectToggle={handleConnectToggle}
        onCollectToggle={sensorData.toggleDataCollection}
        onStartFresh={sensorData.startFreshCollection}
        onExportCsv={() => exportToCsv(sensorData.allSensorDataRef.current)}
        onSaveRecording={handleSaveRecording}
        onSampleCountChange={displaySettings.handleSampleCountChange}
        onAutoScaleChange={displaySettings.setAutoScaleY}
        onYAxisMaxChange={(values) => displaySettings.setYAxisMax(values[0])}
        onLockWorldView={displaySettings.lockWorldView}
        onUnlockWorldView={displaySettings.unlockWorldView}
      />

      <ConnectionStatus
        connected={serial.connected}
        mockModeActive={serial.mockModeActive.current}
        isCollecting={sensorData.isCollecting}
      />

      <CalibrationModal
        open={showCalibration}
        onClose={() => setShowCalibration(false)}
        connected={serial.connected}
        calibration={calibration}
        wallDeclineDeg={displaySettings.wallDeclineDeg}
        onWallDeclineChange={displaySettings.handleWallDeclineChange}
      />

      <Tabs defaultValue="norms" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="norms" className="flex items-center gap-2">
            <BarChart className="h-4 w-4" /> Overall Force
          </TabsTrigger>
          <TabsTrigger value="components" className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Force by Direction
          </TabsTrigger>
          <TabsTrigger value="jump" className="flex items-center gap-2">
            <Timer className="h-4 w-4" /> Jump Test (BETA)
          </TabsTrigger>
          <TabsTrigger value="recordings" className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" /> Recordings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="norms" className="mt-0">
          <ForceMagnitudesTab
            displayData={displayDataForCharts}
            displaySampleCount={displaySettings.displaySampleCount}
            totalSamples={sensorData.totalSamples}
            chartOptions={chartOptions}
          />
        </TabsContent>

        <TabsContent value="components" className="mt-0">
          <ComponentsTab
            displayData={displayDataForCharts}
            displaySampleCount={displaySettings.displaySampleCount}
            totalSamples={sensorData.totalSamples}
            chartOptions={chartOptions}
            worldViewAngleDeg={displaySettings.worldViewAngleDeg}
            coordinateFrame={displaySettings.coordinateFrame}
          />
        </TabsContent>

        <TabsContent value="jump" className="mt-0">
          <JumpTestTab
            jumpNumber={jumpTest.jumpNumber}
            jumpTestActive={jumpTest.jumpTestActive}
            jumpTestStatus={jumpTest.jumpTestStatus}
            countdown={jumpTest.countdown}
            bodyWeight={jumpTest.bodyWeight}
            bodyWeightSubmitted={jumpTest.bodyWeightSubmitted}
            wallAngle={jumpTest.wallAngle}
            wallAngleSubmitted={jumpTest.wallAngleSubmitted}
            connected={serial.connected}
            mockModeActive={serial.mockModeActive.current}
            onBodyWeightChange={jumpTest.setBodyWeight}
            onWallAngleChange={jumpTest.setWallAngle}
            onSendBodyWeight={jumpTest.sendBodyWeight}
            onSendWallAngle={jumpTest.sendWallAngle}
            onStartJump={jumpTest.startJumpTest}
            onFinishJump={jumpTest.finishJumpTest}
          />
        </TabsContent>

        <TabsContent value="recordings" className="mt-0">
          <RecentRecordingsTab
            refreshTrigger={saveCount}
            compareMode={compareMode}
            onSetCompareMode={setCompareMode}
            comparison={comparison}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
