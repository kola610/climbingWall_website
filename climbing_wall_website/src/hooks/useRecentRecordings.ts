import { useState, useCallback } from "react"
import type { SensorReading } from "../types/sensor"
import {
  fetchRecentRecordings,
  fetchRecordingData,
  type RecordingMeta,
} from "../utils/recordingApi"

export interface RecentRecordingsState {
  recordings: RecordingMeta[]
  selectedId: string | null
  selectedData: SensorReading[]
  listLoading: boolean
  dataLoading: boolean
  error: string | null
  /** Fetch the list and auto-select the newest entry. */
  refresh: () => Promise<void>
  /** Select and load data for a specific recording. */
  selectRecording: (id: string) => Promise<void>
}

export function useRecentRecordings(): RecentRecordingsState {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<SensorReading[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectRecording = useCallback(async (id: string) => {
    setSelectedId(id)
    setSelectedData([])
    setDataLoading(true)
    setError(null)
    try {
      const data = await fetchRecordingData(id)
      setSelectedData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recording data.")
    } finally {
      setDataLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setListLoading(true)
    setError(null)
    try {
      const list = await fetchRecentRecordings()
      setRecordings(list)
      // Always jump to the newest recording so the user sees their latest save first.
      if (list.length > 0) {
        setSelectedId(list[0].id)
        setSelectedData([])
        setDataLoading(true)
        try {
          const data = await fetchRecordingData(list[0].id)
          setSelectedData(data)
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load recording data.")
        } finally {
          setDataLoading(false)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recordings.")
    } finally {
      setListLoading(false)
    }
  }, [])

  return {
    recordings,
    selectedId,
    selectedData,
    listLoading,
    dataLoading,
    error,
    refresh,
    selectRecording,
  }
}
