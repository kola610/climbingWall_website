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
      {/* <header className="bg-slate-800 text-white p-4 shadow-md">
        <div className="container mx-auto flex items-center justify-center">
          <Mountain className="h-6 w-6 mr-2" />
          <h1 className="text-2xl font-bold">THE CLIMBING WALL</h1>
        </div>
      </header> */}
      <div className="flex-1 container mx-auto p-4">
        <SensorDashboard />
      </div>
    </main>
  )
}

export default App
