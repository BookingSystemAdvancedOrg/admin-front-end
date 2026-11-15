import { apiFetch } from '../../shared/api'

/** Personalliggare (CONTRACTS.md 6.H, H1-H8). Under juridisk granskning. */

export type Kind = 'check_in' | 'check_out'
export interface Row {
  seq: number
  kind: Kind | 'correction' | 'system_note'
  personId: string | null
  name: string
  personalIdentity?: string
  eventTime: string
  localTime?: string
  recordedAt: string
  recordedBy: { role?: string }
  reason?: string
  late?: boolean
  correctedBySeq?: number
  original?: Row
}
export interface Present { personId: string; name: string; since: string; checkInSeq: number; personalIdentity?: string }
export interface Day {
  day: string
  present: Present[]
  records: Row[]
  me: { personId: string; name: string; present: boolean; worksHere: boolean } | null
}
export interface Inspection {
  day: string
  employer: { legalName: string; orgNumber: string }
  premises: { name: string; address: string }
  present: Present[]
  records: Row[]
  generatedAt: string
}
export interface Person {
  personId: string
  name: string
  personalIdentity?: string
  userSub: string | null
  locationIds: string[]
  active: boolean
  version: number
}
export interface PersonInput {
  name: string
  personalIdentity: string
  userSub: string | null
  locationIds: string[]
  active: boolean
  version: number
}
export interface ExportFile {
  filename: string
  format: 'csv' | 'json'
  count: number
  chainOk: boolean
  firstBadSeq?: number
  content?: string
}

const loc = (id: string) => `/locations/${encodeURIComponent(id)}/personalliggare`

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export const getDay = (locationId: string, day: string) => apiFetch<Day>(`${loc(locationId)}?day=${day}`)
export const checkIn = (locationId: string, personId?: string) =>
  apiFetch<Row>(`${loc(locationId)}/check-in`, { method: 'POST', body: JSON.stringify({ recordId: newId(), ...(personId ? { personId } : {}) }) })
export const checkOut = (locationId: string, personId?: string) =>
  apiFetch<Row>(`${loc(locationId)}/check-out`, { method: 'POST', body: JSON.stringify({ recordId: newId(), ...(personId ? { personId } : {}) }) })
export const correct = (locationId: string, body: { personId: string; kind: Kind; eventTime: string; reason: string; correctsSeq?: number }) =>
  apiFetch<Row>(`${loc(locationId)}/corrections`, { method: 'POST', body: JSON.stringify({ recordId: newId(), ...body }) })
export const getInspection = (locationId: string, day: string) => apiFetch<Inspection>(`${loc(locationId)}/inspection?day=${day}`)
export const exportLedger = (locationId: string, from: string, to: string) =>
  apiFetch<ExportFile>(`${loc(locationId)}/export?from=${from}&to=${to}&format=csv`)
export const listPersons = () => apiFetch<{ persons: Person[] }>('/tenant/personalliggare/persons').then((r) => r.persons)
export const savePerson = (personId: string, input: PersonInput) =>
  apiFetch<Person>(`/tenant/personalliggare/persons/${encodeURIComponent(personId)}`, { method: 'PUT', body: JSON.stringify(input) })

export const ERRORS: Record<string, string> = {
  already_checked_in: 'Personen är redan incheckad.',
  not_checked_in: 'Personen är inte incheckad.',
  no_person_for_user: 'Din inloggning är inte kopplad till någon i liggaren. Be ägaren lägga till dig under Personer.',
  changed_retry: 'Någon annan registrerade samtidigt. Försök igen.',
  reason_required: 'Skriv en orsak på 5-300 tecken.',
  invalid_event_time: 'Tiden kan inte ligga i framtiden eller för långt bak i tiden.',
  wrong_person: 'Rättelsen måste gälla samma person som den ursprungliga registreringen.',
  invalid_personal_identity: 'Personnumret stämmer inte. Kontrollera siffrorna.',
  user_already_linked: 'Inloggningen är redan kopplad till en annan person.',
  invalid_range: 'Välj ett datumintervall på högst ett år där från-datumet kommer först.',
  owner_only: 'Bara ägaren kan göra det här.',
}

/** Klockslag i Stockholmstid, "08:15". */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' })
}

/** Dagens datum i Stockholm, "2026-11-05". */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

export const KIND_LABEL: Record<Kind, string> = { check_in: 'In', check_out: 'Ut' }

/** "2026-11-05" + "08:15" i Stockholmstid -> ISO i UTC. */
export function stockholmIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return new Date(guess - (shown - guess)).toISOString().replace('.000Z', 'Z')
}
