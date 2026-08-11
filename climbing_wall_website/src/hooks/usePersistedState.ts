import { useState, useEffect } from "react"

/**
 * Drop-in replacement for `useState` that also persists the value to
 * localStorage: reads the stored value on first render (falling back to
 * `defaultValue`) and writes every change back. Storage failures — quota,
 * private mode, corrupt JSON — are swallowed; the app still works in-memory.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Quota exceeded / unavailable — the in-memory value still applies.
    }
  }, [key, value])

  return [value, setValue]
}
