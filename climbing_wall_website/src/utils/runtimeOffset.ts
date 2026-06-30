/**
 * Volatile, runtime-only zero offset (a.k.a. tare) — the counterpart to the
 * persisted calibration in `calibration.ts`.
 *
 * Clean separation of concerns:
 *   - calibration.ts  : axis switches + scales. Computed against known weights,
 *                       SAVED at calibration time (localStorage + backend file).
 *   - runtimeOffset.ts : the zero offset. Recomputed at runtime by averaging
 *                        recent samples whenever the user taps "Zero / Tare".
 *                        It is cached in its OWN localStorage key so a reload
 *                        keeps the last zero in effect (no forced re-zeroing) —
 *                        but it is never part of the calibration config and is
 *                        never written to the backend.
 *
 * The offset is held in SIGNED-RAW space (post axis-sign, pre-scale) and is
 * subtracted by `serialParser` in exactly the slot the old persisted
 * `groundOffsets` used to occupy, so the per-reading order of operations
 * (sign → offset → scale) is unchanged — only the source of the offset moved
 * from the saved config to this live, user-controlled store.
 */

const N_CHANNELS = 12

const zeros = (): number[] => new Array(N_CHANNELS).fill(0)

/**
 * Number of samples averaged to compute a zero. At the ~100 Hz stream rate this
 * is ~1.5 s — long enough to average out sensor noise, short enough that the
 * tare reflects the sensor's state *now* (a longer window would fold in load
 * applied seconds ago) and that "Zero" feels instant. The whole averaging window
 * is tuned here, in one named place.
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
 * Install a freshly averaged zero offset (defensively copied + length-clamped)
 * and cache it to localStorage so it survives reloads. Returns the timestamp it
 * was stored under, so the caller's UI state matches the persisted value exactly.
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
