import { apiFetch } from '../../shared/api'

/** Kö (CONTRACTS.md 6.F). Personalen arbetar bara på sin egen restaurang; inställningarna är ägarens. */

export type EntryStatus = 'waiting' | 'offered' | 'seated' | 'booked' | 'expired' | 'left' | 'removed'

export interface Offer { reservationId: string; tableIds: string[]; startTime: string; endTime: string; expiresAt: string }
export interface Entry {
  entryId: string
  date: string
  name: string
  partySize: number
  phone?: string
  note?: string
  source: 'site' | 'staff'
  status: EntryStatus
  joinedAt: string
  wantFrom?: string
  wantUntil?: string
  position?: number | null
  offer?: Offer
  reservationId?: string
  notice?: { kind: 'joined' | 'offered' | 'expired'; at: string; sentAt?: string }
  version: number
}
export interface Settings { enabled: boolean; holdMinutes: number; maxWaiting: number; publicJoin: boolean; version: number }
export interface Suggestion { entryId: string; tableIds: string[]; startTime: string }
export interface Queue { settings: Settings; entries: Entry[]; suggestions: Suggestion[] }

const base = (locationId: string) => `/locations/${encodeURIComponent(locationId)}/waitlist`
const one = (locationId: string, entryId: string) => `${base(locationId)}/${encodeURIComponent(entryId)}`

export const getQueue = (locationId: string, date: string) => apiFetch<Queue>(`${base(locationId)}?date=${date}`)
export const addWalkIn = (locationId: string, body: { entryId: string; name: string; partySize: number; phone?: string; note?: string }) =>
  apiFetch<Entry>(base(locationId), { method: 'POST', body: JSON.stringify(body) })
export const offerTable = (locationId: string, e: Entry, tableIds: string[], startTime: string) =>
  apiFetch<Entry>(`${one(locationId, e.entryId)}/offer`, { method: 'POST', body: JSON.stringify({ tableIds, startTime, version: e.version }) })
export const seatNow = (locationId: string, e: Entry, tableIds?: string[]) =>
  apiFetch<{ entry: Entry; reservationId: string }>(`${one(locationId, e.entryId)}/seat`, {
    method: 'POST', body: JSON.stringify({ version: e.version, ...(tableIds ? { tableIds } : {}) }),
  })
export const removeEntry = (locationId: string, e: Entry) =>
  apiFetch<Entry>(`${one(locationId, e.entryId)}/remove`, { method: 'POST', body: JSON.stringify({ version: e.version }) })
export const saveSettings = (locationId: string, s: Settings) =>
  apiFetch<Settings>(`${base(locationId)}/settings`, { method: 'PUT', body: JSON.stringify(s) })

export const ERRORS: Record<string, string> = {
  queue_full: 'Kön är full. Ta bort någon ur kön, eller höj max antal under Inställningar > Restaurangen > Bokning.',
  already_queued: 'Det numret står redan i kön i dag. Leta upp gästen i listan.',
  table_taken: 'Bordet hann bli upptaget. Välj ett annat bord.',
  hold_expired: 'Tiden för erbjudandet gick ut. Erbjud bordet igen.',
  invalid_state: 'Gästen har redan fått bord eller lämnat kön. Inget mer behövs.',
  invalid_party_size: 'Antal gäster ska vara mellan 1 och 20, till exempel 4.',
  invalid_phone: 'Mobilnumret ser fel ut. Skriv det så här: 070 123 45 67.',
  invalid_hold: 'Hålltiden ska vara mellan 5 och 30 minuter, till exempel 10.',
  invalid_max: 'Max antal ska vara mellan 1 och 200, till exempel 30.',
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  waiting: 'Väntar', offered: 'Erbjuden', seated: 'Placerad', booked: 'Bokad', expired: 'Tiden gick ut',
  left: 'Lämnade kön', removed: 'Borttagen',
}

export function newEntryId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' })
}
