import { apiFetch } from '../../shared/api'

/** Telefonassistenten (CONTRACTS.md 6.L, L1-L12). */

export type Mode = 'after_hours' | 'overflow' | 'always'
export type Outcome = 'booked' | 'moved' | 'cancelled' | 'info' | 'transferred' | 'callback' | 'abandoned' | 'refused' | 'error'
export type CounterOffer = 'none' | 'other_time' | 'next_day' | 'nearby_table'
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface Span { from: string; to: string }

export interface Config {
  agentName: string
  tone: 'formal' | 'friendly'
  languages: ('sv' | 'en')[]
  recording: { enabled: boolean; purpose?: string; retentionDays?: number }
  minutesCapPerMonth: number
  version: number
}
export interface Overview {
  config: Config
  locations: { locationId: string; name: string; enabled: boolean; killSwitch: boolean; mode: Mode; number: string | null; minutesThisPeriod: number }[]
  usage: { minutes: number; cap: number; includedMinutes: number; periodEnd: string }
}
export interface LocationConfig {
  locationId: string
  enabled: boolean
  killSwitch: boolean
  mode: Mode
  agentHours: Partial<Record<Day, Span[]>>
  greetingExtraSv: string
  greetingExtraEn: string
  transferTo?: string | null
  maxCallSeconds: number
  counterOffers: { nearbyTables: boolean; phoneOnlyTables: boolean }
  number: string | null
  version: number
  forwarding?: { number: string | null; codes: { operator: string; label: string; on: string; off: string }[] }
}
export interface CallRow {
  callId: string
  startedAt: string
  durationSec: number
  language: string
  outcome: Outcome | null
  counterOffer: CounterOffer
  reservationId: string | null
  callbackId: string | null
  summary: string
  refusedReason?: string | null
  from?: string | null
}
export interface Turn { role: 'agent' | 'caller' | 'tool' | 'system'; text: string; at: string; toolName?: string; toolOk?: boolean }
export interface CallDetail extends CallRow {
  billedMinutes: number
  disclosure: { text?: string; playedAt?: string | null; spoken?: string; verbatim?: boolean; repeats?: number; languages?: string[] }
  turns: Turn[]
  recordingUrl?: string
}
export interface Callback {
  callbackId: string
  callId: string
  name: string
  phone: string
  topic: string
  preferredTime: string | null
  status: 'open' | 'closed'
  createdAt: string
  closedAt: string | null
  note: string
  version: number
}
export interface SimReply { reply: string; toolCalls: { name: string; ok: boolean }[]; state: { outcome?: string | null }; disclosure: boolean }

const loc = (id: string) => `/locations/${encodeURIComponent(id)}/phone-agent`

export const getOverview = () => apiFetch<Overview>('/tenant/phone-agent')
export const saveConfig = (c: Omit<Config, 'version'> & { version: number }) =>
  apiFetch<Config>('/tenant/phone-agent/config', { method: 'PUT', body: JSON.stringify(c) })
export const getLocation = (locationId: string) => apiFetch<LocationConfig>(loc(locationId))
export const saveLocation = (locationId: string, body: Omit<LocationConfig, 'locationId' | 'killSwitch' | 'number' | 'forwarding'>) =>
  apiFetch<LocationConfig>(loc(locationId), { method: 'PUT', body: JSON.stringify(body) })
export const setKillSwitch = (locationId: string, on: boolean, version: number) =>
  apiFetch<LocationConfig>(`${loc(locationId)}/kill-switch`, { method: 'POST', body: JSON.stringify({ on, version }) })
export const simulate = (locationId: string, sessionId: string, text: string, language?: 'sv' | 'en') =>
  apiFetch<SimReply>(`${loc(locationId)}/simulate`, { method: 'POST', body: JSON.stringify({ sessionId, text, ...(language ? { language } : {}) }) })
export const listCalls = (locationId: string, from: string, to: string, cursor?: string | null) => {
  const q = new URLSearchParams({ from, to })
  if (cursor) q.set('cursor', cursor)
  return apiFetch<{ calls: CallRow[]; cursor: string | null }>(`${loc(locationId)}/calls?${q}`)
}
export const getCall = (locationId: string, callId: string) => apiFetch<CallDetail>(`${loc(locationId)}/calls/${encodeURIComponent(callId)}`)
export const deleteRecording = (locationId: string, callId: string) =>
  apiFetch<void>(`${loc(locationId)}/calls/${encodeURIComponent(callId)}/recording`, { method: 'DELETE' })
export const listCallbacks = (locationId: string, status: 'open' | 'closed' | 'all' = 'open') =>
  apiFetch<{ callbacks: Callback[] }>(`${loc(locationId)}/callbacks?status=${status}`).then((r) => r.callbacks)
export const closeCallback = (locationId: string, cb: Callback, note?: string) =>
  apiFetch<Callback>(`${loc(locationId)}/callbacks/${encodeURIComponent(cb.callbackId)}/close`, {
    method: 'POST', body: JSON.stringify({ version: cb.version, ...(note ? { note } : {}) }),
  })

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/** Dagens datum i Stockholm, "2026-11-05". */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

export function daysAgo(n: number): string {
  const d = new Date(`${today()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' })
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  booked: 'Bokade bord',
  moved: 'Flyttade bokning',
  cancelled: 'Avbokade',
  info: 'Svarade på frågor',
  transferred: 'Kopplad till er',
  callback: 'Vill bli uppringd',
  abandoned: 'Lade på',
  refused: 'Inte besvarat',
  error: 'Något gick fel',
}
export const COUNTER_LABEL: Record<CounterOffer, string> = {
  none: '',
  other_time: 'Erbjöd annan tid',
  next_day: 'Erbjöd dagen efter',
  nearby_table: 'Erbjöd bord bredvid',
}
export const REFUSED_LABEL: Record<string, string> = {
  cap: 'minuterna för perioden var slut',
  kill_switch: 'assistenten var avstängd',
  hours: 'utanför assistentens tider',
  paused: 'pausad av Booqy',
  entitlement: 'assistenten är inte på',
}
export const MODE_LABEL: Record<Mode, string> = {
  after_hours: 'När ni har stängt',
  overflow: 'När ni inte hinner svara',
  always: 'Alltid',
}
export const DAYS: { key: Day; label: string }[] = [
  { key: 'mon', label: 'Måndag' }, { key: 'tue', label: 'Tisdag' }, { key: 'wed', label: 'Onsdag' },
  { key: 'thu', label: 'Torsdag' }, { key: 'fri', label: 'Fredag' }, { key: 'sat', label: 'Lördag' }, { key: 'sun', label: 'Söndag' },
]
export const ERRORS: Record<string, string> = {
  changed_retry: 'Någon annan ändrade samtidigt. Ladda om och försök igen.',
  purpose_required: 'Skriv varför samtalen spelas in.',
  invalid_retention: 'Välj hur länge inspelningarna sparas: 7, 30 eller 90 dagar.',
  invalid_cap: 'Minuttaket måste vara ett heltal och högst det Booqy tillåter.',
  invalid_hours: 'Kontrollera tiderna: varje period måste sluta efter att den börjar.',
  invalid_phone: 'Skriv numret som +46 följt av numret, till exempel +46812345678.',
  invalid_max_call: 'Ett samtal får vara 2–15 minuter långt.',
  text_too_long: 'Texten är för lång.',
  number_unavailable: 'Det finns inget ledigt nummer just nu. Försök igen senare eller kontakta oss.',
  telephony_unavailable: 'Telefonileverantören svarar inte just nu. Försök igen om en stund.',
  voice_provider_unavailable: 'Röstleverantören svarar inte just nu. Försök igen om en stund.',
  ai_unavailable: 'Assistenten svarar inte just nu. Försök igen om en stund.',
  invalid_state: 'Återuppringningen ändrades nyss. Ladda om listan.',
}
