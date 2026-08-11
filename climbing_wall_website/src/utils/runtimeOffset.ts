/**
 * Volatile, runtime-only zero offset (tare) — the counterpart to the persisted
 * calibration in `calibration.ts`.
 *
 *   - calibration.ts   : axis switches + scales. Measured against known weights,
 *                        saved to localStorage + the backend file.
 *   - runtimeOffset.ts : the zero. Recomputed whenever the user taps "Zero",
 *                        cached under its OWN localStorage key so a reload keeps
 *                        the last zero in effect. Never part of the calibration
 *                        config, never written to the backend.
 *
 * Held in SIGNED-RAW space (post axis-sign, pre-scale) — the same space
 * `serialParser` subtracts it in, so the average is a valid zero regardless of
 * the scale in effect.
 */

const N_CHANNELS = 12

const zeros = (): number[] => new Array(N_CHANNELS).fill(0)

/**
 * Samples averaged to compute a zero. ~1.5 s at the ~100 Hz stream rate — long
 * enough to average out noise, short enough that the tare reflects the sensor's
 * state *now* rather than folding in load applied seconds ago.
 */
export const TARE_WINDOW_SAMPLES = 150

/**
 * Minimum buffered samples before a tare is considered trustworthy. Below this
 * the stream has barely started (or isn't connected) and the average would be
 * dominated by startup noise, so the UI keeps the Zero action disabled.
 */
export const TARE_MIN_SAMPLES = 20

/** localStorage key for the cached zero. Distinct from the calibration key. */
export const TARE_STORAGE_KEY = "tareOffset"

interface PersistedTare {
  offset: number[]
  zeroedAt: number
}

function isValidPersisted(value: unknown): value is PersistedTare {
  if (typeof value !== "object" || value === null) return false
  const t = value as Record<string, unknown>
  return (
    Array.isArray(t.offset) &&
    t.offset.length === N_CHANNELS &&
    t.offset.every((n) => typeof n === "number" && isFinite(n)) &&
    typeof t.zeroedAt === "number" &&
    isFinite(t.zeroedAt)
  )
}

// Module-level active offset, read by `serialParser` at call time. Seeded from
// the persisted zero (if any) at import time so a reload keeps the last zero in
// effect; otherwise all zeros (no offset is subtracted until the user tares).
let activeOffset: number[] = zeros()
// When the active offset was computed (epoch ms), restored on load so the
// staleness indicator survives a reload. null = no zero has been taken.
let zeroedAt: number | null = null

function loadPersistedOffset(): void {
  try {
    const stored = localStorage.getItem(TARE_STORAGE_KEY)
    if (!stored) return
    const data: unknown = JSON.parse(stored)
    if (isValidPersisted(data)) {
      activeOffset = data.offset.slice(0, N_CHANNELS)
      zeroedAt = data.zeroedAt
    }
  } catch {
    // Corrupt / unavailable storage — keep the all-zeros default.
  }
}
loadPersistedOffset()

/** When the current zero was computed (epoch ms), or null if never zeroed. */
export function getZeroedAt(): number | null {
  return zeroedAt
}

/** Current zero offset (signed-raw space, length 12). Read per reading. */
export function getRuntimeOffset(): number[] {
  return activeOffset
}

/**
 * Install a freshly averaged zero (defensively copied + length-clamped) and
 * cache it. Returns the timestamp it was stored under, so the caller's UI state
 * matches the persisted value exactly.
 */
export function setRuntimeOffset(offset: number[]): number {
  const next = zeros()
  for (let i = 0; i < N_CHANNELS; i++) next[i] = offset[i] ?? 0
  activeOffset = next
  zeroedAt = Date.now()
  try {
    localStorage.setItem(
      TARE_STORAGE_KEY,
      JSON.stringify({ offset: next, zeroedAt } satisfies PersistedTare),
    )
  } catch {
    // Quota / unavailable — the in-memory offset still applies this session.
  }
  return zeroedAt
}

/** Drop the zero (and its cached copy), reverting to un-tared readings. */
export function clearRuntimeOffset(): void {
  activeOffset = zeros()
  zeroedAt = null
  try {
    localStorage.removeItem(TARE_STORAGE_KEY)
  } catch {
    // Unavailable storage — the in-memory offset is already cleared.
  }
}
