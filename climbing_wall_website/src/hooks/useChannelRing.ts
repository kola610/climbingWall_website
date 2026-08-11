import { useCallback, useMemo, useRef } from "react"

const N_CHANNELS = 12

/**
 * Fixed-size ring buffer of the last `size` 12-channel samples, written at full
 * stream rate with no allocation per sample (rows are overwritten in place).
 *
 * Shared by the calibration wizard's swing readout and the runtime tare — both
 * need "the mean (and spread) of the most recent N signed-raw samples", fed from
 * the same dispatch in the dashboard.
 *
 * `mean()` / `std()` read entries [0, filled) rather than unwinding the ring:
 * once full every slot holds a recent sample, and mean/variance are
 * order-independent, so this is correct whether or not the ring has wrapped.
 */
export function useChannelRing(size: number) {
  const bufRef = useRef<number[][]>(
    Array.from({ length: size }, () => new Array(N_CHANNELS).fill(0)),
  )
  const headRef = useRef(0)
  const filledRef = useRef(0)

  const feed = useCallback(
    (sample: number[]) => {
      const row = bufRef.current[headRef.current]
      for (let i = 0; i < N_CHANNELS; i++) row[i] = sample[i] ?? 0
      headRef.current = (headRef.current + 1) % size
      if (filledRef.current < size) filledRef.current += 1
    },
    [size],
  )

  /** Number of samples currently held (saturates at `size`). */
  const filled = useCallback(() => filledRef.current, [])

  /** Per-channel mean, or null if fewer than `minSamples` have arrived. */
  const mean = useCallback(
    (minSamples: number): number[] | null => {
      const n = Math.min(filledRef.current, size)
      if (n < minSamples) return null
      const sums = new Array(N_CHANNELS).fill(0)
      const buf = bufRef.current
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < N_CHANNELS; i++) sums[i] += buf[k][i]
      }
      return sums.map((s) => s / n)
    },
    [size],
  )

  /** Per-channel standard deviation, or null if fewer than `minSamples`. */
  const std = useCallback(
    (minSamples: number): number[] | null => {
      const n = Math.min(filledRef.current, size)
      if (n < minSamples) return null
      const sums = new Array(N_CHANNELS).fill(0)
      const sumSqs = new Array(N_CHANNELS).fill(0)
      const buf = bufRef.current
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < N_CHANNELS; i++) {
          const v = buf[k][i]
          sums[i] += v
          sumSqs[i] += v * v
        }
      }
      return sums.map((s, i) => {
        const m = s / n
        // Var = E[x²] − E[x]²; clamp at 0 to absorb floating-point noise.
        return Math.sqrt(Math.max(0, sumSqs[i] / n - m * m))
      })
    },
    [size],
  )

  // Stable object identity so consumers can list it in a useCallback dep array.
  return useMemo(() => ({ feed, filled, mean, std }), [feed, filled, mean, std])
}
