import { useState, useEffect, useCallback } from "react"

type StorageBackend = "local" | "session"

function getStorage(backend: StorageBackend): Storage {
  return backend === "session" ? sessionStorage : localStorage
}

/**
 * Drop-in replacement for `useState` that also persists the value to
 * localStorage (default) or sessionStorage.
 *
 * - Reads the stored value on first render; falls back to `defaultValue`.
 * - Writes every state change back to storage.
 * - Handles JSON serialisation, quota errors, and SSR gracefully.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  backend: StorageBackend = "local",
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValueRaw] = useState<T>(() => {
    try {
      const stored = getStorage(backend).getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      getStorage(backend).setItem(key, JSON.stringify(value))
    } catch {
      // Quota exceeded — silently drop, the app still works in-memory.
    }
  }, [key, value, backend])

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => setValueRaw(next),
    [],
  )

  return [value, setValue]
}
