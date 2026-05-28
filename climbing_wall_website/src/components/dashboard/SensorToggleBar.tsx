import { X } from "lucide-react"
import { SENSOR_NAMES, MAGNITUDE_COLORS } from "../../constants/sensor"

interface SensorToggleBarProps {
  activeSensors: Set<number>
  onToggle: (index: number) => void
}

/**
 * Bubbly pill toggles for the 4 force sensors.
 *
 * Usage:
 *   <SensorToggleBar activeSensors={activeSensors} onToggle={toggleSensor} />
 *
 * Hide entirely with a conditional:
 *   {showToggles && <SensorToggleBar ... />}
 */
export function SensorToggleBar({ activeSensors, onToggle }: SensorToggleBarProps) {
  return (
    <div className="flex items-center gap-2.5">
      {SENSOR_NAMES.map((name, index) => {
        const active = activeSensors.has(index)
        const color = MAGNITUDE_COLORS[index].border
        return (
          <button
            key={index}
            onClick={() => onToggle(index)}
            className={[
              "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5",
              "text-[13px] font-medium cursor-pointer select-none",
              "transition-all duration-200 ease-out",
              "hover:scale-[1.03] active:scale-[0.97]",
            ].join(" ")}
            style={{
              backgroundColor: active
                ? color.replace("rgb", "rgba").replace(")", ", 0.12)")
                : "var(--muted, hsl(210 40% 96.1%))",
              border: "none",
              color: active ? color : "var(--muted-foreground, hsl(215.4 16.3% 56.9%))",
              opacity: active ? 1 : 0.55,
            }}
          >
            {active ? (
              <X className="h-3 w-3 shrink-0" strokeWidth={2.5} />
            ) : (
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0 transition-all duration-200"
                style={{ backgroundColor: "currentColor" }}
              />
            )}
            {name}
          </button>
        )
      })}
    </div>
  )
}
