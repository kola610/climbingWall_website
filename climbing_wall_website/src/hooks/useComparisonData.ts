import { useState, useCallback, useEffect } from "react"
import type { SensorReading } from "../types/sensor"
import { fetchRecordingData } from "../utils/recordingApi"

export interface ComparisonSlot {
  id: string
  data: SensorReading[]
  loading: boolean
}

export interface ComparisonDataState {
  slotA: ComparisonSlot | null
  slotB: ComparisonSlot | null
  /**
   * Click a recording to add it to the next free slot (A then B).
   * Click the same recording again to remove it from its slot.
   * If both slots are full, the new recording replaces B.
   */
  toggleId: (id: string) => void
  clearAll: () => void
}

function useSlot(id: string | null): [SensorReading[], boolean] {
  const [data, setData] = useState<SensorReading[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) { setData([]); return }
    let cancelled = false
    setLoading(true)
    fetchRecordingData(id)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  return [data, loading]
}

export function useComparisonData(): ComparisonDataState {
  const [idA, setIdA] = useState<string | null>(null)
  const [idB, setIdB] = useState<string | null>(null)

  const [dataA, loadingA] = useSlot(idA)
  const [dataB, loadingB] = useSlot(idB)

  const toggleId = useCallback((id: string) => {
    if (idA === id) { setIdA(null); return }
    if (idB === id) { setIdB(null); return }
    if (idA === null) { setIdA(id); return }
    if (idB === null) { setIdB(id); return }
    setIdB(id) // both full → replace B
  }, [idA, idB])

  const clearAll = useCallback(() => {
    setIdA(null)
    setIdB(null)
  }, [])

  return {
    slotA: idA !== null ? { id: idA, data: dataA, loading: loadingA } : null,
    slotB: idB !== null ? { id: idB, data: dataB, loading: loadingB } : null,
    toggleId,
    clearAll,
  }
}
