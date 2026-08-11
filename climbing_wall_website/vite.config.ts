import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The backend persists calibration into src/config/calibration_settings.json,
    // which is imported by calibration.ts. Without this, every "Save axis" write
    // makes Vite full-page-reload, which drops the Web Serial connection. The live
    // calibration store is updated in-memory on save (and re-read via
    // GET /api/calibration on the next load), so ignoring the file here is safe.
    watch: {
      ignored: ["**/src/config/calibration_settings.json"],
    },
    // 127.0.0.1, not "localhost". Flask's dev server binds IPv4 only, but Node
    // resolves "localhost" to ::1 first — so the proxy would connect to
    // [::1]:5001 and get ECONNREFUSED. Node 20+ hides this with Happy Eyeballs
    // (autoSelectFamily), Node 18 does not, and Windows resolves ::1 first far
    // more consistently than macOS. Naming the literal address sidesteps DNS.
    proxy: {
      // The live sensor stream is a WebSocket. It must be listed BEFORE the
      // generic "/api" rule so the upgrade is proxied with ws:// rather than
      // being caught by the plain HTTP rule below.
      "/api/stream": {
        target: "ws://127.0.0.1:5001",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:5001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
