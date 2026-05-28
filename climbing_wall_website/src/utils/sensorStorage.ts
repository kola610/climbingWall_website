import type { SensorReading } from "../types/sensor"

/**
 * Persistent storage for sensor recordings using IndexedDB.
 *
 * IndexedDB is used instead of sessionStorage/localStorage because:
 *  - No practical size limit (hundreds of MB vs 5 MB).
 *  - Persists across reloads AND browser restarts — data is never lost
 *    unless the user explicitly starts a new recording.
 *  - Async — does not block the main thread during large writes.
 */

const DB_NAME = "climbing-wall"
const DB_VERSION = 1
const STORE_NAME = "recordings"
const RECORD_KEY = "current"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveSensorData(data: SensorReading[]): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(data, RECORD_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn("Failed to persist sensor data:", err)
  }
}

export async function loadSensorData(): Promise<SensorReading[]> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).get(RECORD_KEY)
    const result = await new Promise<SensorReading[] | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as SensorReading[] | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return result ?? []
  } catch (err) {
    console.warn("Failed to load sensor data:", err)
    return []
  }
}

export async function clearSensorData(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(RECORD_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn("Failed to clear sensor data:", err)
  }
}
