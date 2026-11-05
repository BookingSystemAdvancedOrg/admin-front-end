import { EVENT_SCAN_KEY_PREFIX } from '../../shared/storageRegistry'
import type { CheckIn, GuestList } from './api'

/**
 * Insläppet utan nät (ADR-K 7): gästlistan, scan-nyckeln och köade insläpp
 * sparas i IndexedDB under `booqy-event-scan-<tillfälle>` (lagringsregistret,
 * nödvändig). Databasen tas bort när allt är synkat efter evenemanget. Utan
 * IndexedDB (privat läge, test) hålls allt i minnet för fliken.
 */

export interface ScanState {
  list: GuestList | null
  queue: CheckIn[]
  /** ticketId -> när den släpptes in här (även innan servern vet det). */
  local: Record<string, string>
  savedAt: string | null
}

const EMPTY: ScanState = { list: null, queue: [], local: {}, savedAt: null }
const memory = new Map<string, ScanState>()

function dbName(occurrenceId: string): string {
  return `${EVENT_SCAN_KEY_PREFIX}${occurrenceId}`
}

function open(occurrenceId: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName(occurrenceId), 1)
      req.onupgradeneeded = () => req.result.createObjectStore('state')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function loadScan(occurrenceId: string): Promise<ScanState> {
  const db = await open(occurrenceId)
  if (!db) return memory.get(occurrenceId) ?? { ...EMPTY }
  return new Promise((resolve) => {
    const req = db.transaction('state').objectStore('state').get('s')
    req.onsuccess = () => { db.close(); resolve((req.result as ScanState | undefined) ?? { ...EMPTY }) }
    req.onerror = () => { db.close(); resolve({ ...EMPTY }) }
  })
}

export async function saveScan(occurrenceId: string, state: ScanState): Promise<void> {
  const next = { ...state, savedAt: new Date().toISOString() }
  const db = await open(occurrenceId)
  if (!db) {
    memory.set(occurrenceId, next)
    return
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction('state', 'readwrite')
    tx.objectStore('state').put(next, 's')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); resolve() }
  })
}

/** Tar bort allt som sparats för tillfället (när det är synkat och evenemanget är slut). */
export async function clearScan(occurrenceId: string): Promise<void> {
  memory.delete(occurrenceId)
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(dbName(occurrenceId))
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** QR-innehållet är `<ticketId>.<sig>`; en inskriven kod får ha mellanslag och små bokstäver. */
export function parseCode(raw: string): { ticketId: string; sig: string } | null {
  const text = raw.trim().replace(/\s+/g, '')
  const m = /^([0-9A-Za-z_]{8,40})\.([0-9a-fA-F]{16})$/.exec(text)
  return m ? { ticketId: m[1].toUpperCase(), sig: m[2].toLowerCase() } : null
}

/** sig = HMAC-SHA256(scanKey, ticketId), de 16 första hex-tecknen: samma som servern, så skanningen fungerar utan nät. */
export async function signature(scanKeyHex: string, ticketId: string): Promise<string> {
  const keyBytes = new Uint8Array((scanKeyHex.match(/../g) ?? []).map((h) => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ticketId)))
  return Array.from(mac.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}
