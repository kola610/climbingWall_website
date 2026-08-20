import { useState, useCallback } from "react"
import type { SensorReading } from "../types/sensor"
import {
  fetchRecentRecordings,
  fetchRecordingData,
  deleteRecording,
  renameRecording,
  type RecordingMeta,
} from "../utils/recordingApi"

/** [from, to) row bounds of the loaded window, or null for the whole recording. */
export type SampleWindow = { from: number; to: number } | null

export interface RecentRecordingsState {
  recordings: RecordingMeta[]
  selectedId: string | null
  selectedData: SensorReading[]
  /** The window currently loaded — null means the full recording. */
  sampleWindow: SampleWindow
  listLoading: boolean
  dataLoading: boolean
  error: string | null
  /** Fetch the list and auto-select the newest entry. */
  refresh: () => Promise<void>
  /**
   * Select and load data for a specific recording. Pass `meta` when the id may
   * not be in the recent list (picked from the full archive) so it gets folded
   * into the list and the header/compare lookups still resolve.
   */
  selectRecording: (id: string, meta?: RecordingMeta) => Promise<void>
  /** Reload the selected recording over a narrower row window, for zoom. */
  loadWindow: (window: SampleWindow) => Promise<void>
  /** Delete a recording, then refresh the list. */
  removeRecording: (id: string) => Promise<void>
  /** Change a recording's display label, then refresh the list. */
  relabelRecording: (id: string, label: string) => Promise<void>
}

export function useRecentRecordings(): RecentRecordingsState {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<SensorReading[]>([])
  const [sampleWindow, setSampleWindow] = useState<SampleWindow>(null)
  const [listLoading, setListLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Shared loader — every path that puts data on screen goes through here. */
  const loadData = useCallback(async (id: string, win: SampleWindow) => {
    setDataLoading(true)
    setError(null)
    try {
      const data = await fetchRecordingData(id, win?.from, win?.to)
      setSelectedData(data)
      setSampleWindow(win)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recording data.")
    } finally {
      setDataLoading(false)
    }
  }, [])

  const selectRecording = useCallback(async (id: string, meta?: RecordingMeta) => {
    if (meta) {
      setRecordings((prev) => (prev.some((r) => r.id === id) ? prev : [meta, ...prev]))
    }
    setSelectedId(id)
    setSelectedData([])
    // A new recording always opens at full extent — a window from the previous
    // selection would silently apply to a recording of a different length.
    await loadData(id, null)
  }, [loadData])

  const loadWindow = useCallback(async (win: SampleWindow) => {
    if (!selectedId) return
    await loadData(selectedId, win)
  }, [loadData, selectedId])

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
        await loadData(list[0].id, null)
      } else {
        setSelectedId(null)
        setSelectedData([])
        setSampleWindow(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recordings.")
    } finally {
      setListLoading(false)
    }
  }, [loadData])

  const removeRecording = useCallback(async (id: string) => {
    setError(null)
    try {
      await deleteRecording(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete recording.")
      return
    }
    // Drop the selection first: refresh() re-selects the newest, and leaving a
    // deleted id selected would fetch a 404 in between.
    if (selectedId === id) {
      setSelectedId(null)
      setSelectedData([])
      setSampleWindow(null)
    }
    await refresh()
  }, [refresh, selectedId])

  const relabelRecording = useCallback(async (id: string, label: string) => {
    setError(null)
    try {
      const updated = await renameRecording(id, label)
      // Patch the one row in place. A full refresh would re-select the newest
      // recording and reload its chart — a jarring jump for a text edit.
      setRecordings((prev) => prev.map((r) => (r.id === id ? updated : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename recording.")
    }
  }, [])

  return {
    recordings,
    selectedId,
    selectedData,
    sampleWindow,
    listLoading,
    dataLoading,
    error,
    refresh,
    selectRecording,
    loadWindow,
    removeRecording,
    relabelRecording,
  }
}
