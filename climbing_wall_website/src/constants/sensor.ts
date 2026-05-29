export const FORCE_COMPONENTS = ["X", "Y", "Z"] as const

export const SENSOR_NAMES = [
  "Left Hand",
  "Right Hand",
  "Left Foot",
  "Right Foot",
] as const

export const SAMPLE_COUNT_OPTIONS = [
  { value: "250",  label: "Last 2.5 seconds" },
  { value: "500",  label: "Last 5 seconds" },
  { value: "1000", label: "Last 10 seconds" },
  { value: "all",  label: "Show everything" },
]

/** Colors for the per-sensor X / Y / Z component charts. */
export const COMPONENT_COLORS = [
  { border: "rgb(123, 104, 238)", background: "rgba(123, 104, 238, 0.5)" }, // X — purple
  { border: "rgb(112, 128, 144)", background: "rgba(112, 128, 144, 0.5)" }, // Y — slate
  { border: "rgb(255, 215, 0)",   background: "rgba(255, 215, 0, 0.5)" },   // Z — gold
]

/** Colors for the force-magnitude (Euclidean norm) comparison chart. */
export const MAGNITUDE_COLORS = [
  // Order matches SENSOR_NAMES:
  // 0 = Left Hand, 1 = Right Hand, 2 = Left Foot, 3 = Right Foot
  //
  // `border`  — primary colour used for single-view charts and comparison slot A
  // `borderB` — darker/contrasting shade used exclusively for comparison slot B
  //             so that both lines are clearly visible and distinguishable
  {
    border:     "rgb(255, 215, 0)",
    background: "rgba(255, 215, 0, 0.5)",
    borderB:    "rgb(160, 120, 0)",       // dark gold  — Left Hand B
  },
  {
    border:     "rgb(255, 99, 132)",
    background: "rgba(255, 99, 132, 0.5)",
    borderB:    "rgb(170, 30, 70)",       // dark rose  — Right Hand B
  },
  {
    border:     "rgb(53, 162, 235)",
    background: "rgba(53, 162, 235, 0.5)",
    borderB:    "rgb(20, 95, 170)",       // dark blue  — Left Foot B
  },
  {
    border:     "rgb(0, 180, 90)",
    background: "rgba(0, 180, 90, 0.5)",
    borderB:    "rgb(0, 110, 55)",        // dark green — Right Foot B
  },
]
