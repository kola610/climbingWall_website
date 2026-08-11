import { useEffect } from "react"
import SensorDashboard from "./components/sensor-dashboard"
import { wallDeclineSelfCheck } from "./utils/wallGeometry"

function App() {
  // Dev-only: assert the wall-decline rotation model (θ=0 identity, vertical→X,
  // normal-push split). No test runner is configured, so this surfaces a failure
  // in the console during development.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const results = wallDeclineSelfCheck()
    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      console.error("[wallGeometry] sanity checks FAILED:", failed)
    } else {
      console.debug(
        "[wallGeometry] sanity checks passed:",
        results.map((r) => r.name),
      )
    }
  }, [])

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 container mx-auto p-4">
        <SensorDashboard />
      </div>
    </main>
  )
}

export default App
