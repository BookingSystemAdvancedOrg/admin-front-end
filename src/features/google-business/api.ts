import { apiFetch } from '../../shared/api'

/** Google-profil: öppettider till Google och omdömesförfrågningar (CONTRACTS.md 6.D). Bara för ägaren. */

export type ConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected'
export type Source = 'booking' | 'order'
export type Channel = 'email' | 'sms'

export interface Connection { status: ConnectionStatus; googleAccount?: string }
export interface GoogleLocation { googleLocation: string; title: string; address: string; linkedTo?: string }
export interface Link {
  googleLocation: string
  title: string
  syncStatus: 'pending' | 'ok' | 'error'
  lastSyncAt: string | null
  version: number
  lastError?: { code: string }
}
export interface ReviewSettings {
  enabled: boolean
  sources: Source[]
  channels: Channel[]
  delayMinutes: number
  minDaysBetween: number
  version: number
}
interface TimeOfDay { hours?: number; minutes?: number }
interface GDate { year: number; month: number; day: number }
export interface Preview {
  regularHours: { periods: { openDay: string; openTime: TimeOfDay; closeDay: string; closeTime: TimeOfDay }[] }
  specialHours: { specialHourPeriods: { startDate: GDate; closed: boolean; openTime?: TimeOfDay; closeTime?: TimeOfDay }[] }
}
export interface LocationView {
  link?: Link
  preview: Preview
  reviewSettings: ReviewSettings
  stats: { sent30d: number; skipped30d: number; clicks30d: number }
}

const loc = (id: string) => `/locations/${encodeURIComponent(id)}/google-business`

export const getConnection = () => apiFetch<Connection>('/tenant/google-business/connection')
export const startConnect = () =>
  apiFetch<{ authorizeUrl: string }>('/tenant/google-business/connection/start', { method: 'POST', body: '{}' })
export const finishConnect = (code: string, state: string) =>
  apiFetch<Connection>('/tenant/google-business/connection/callback', { method: 'POST', body: JSON.stringify({ code, state }) })
export const disconnect = () => apiFetch<void>('/tenant/google-business/connection', { method: 'DELETE' })
export const listGoogleLocations = () =>
  apiFetch<{ locations: GoogleLocation[] }>('/tenant/google-business/locations')
export const getLocationView = (locationId: string) => apiFetch<LocationView>(loc(locationId))
export const linkLocation = (locationId: string, googleLocation: string, version?: number) =>
  apiFetch<Link>(`${loc(locationId)}/link`, { method: 'PUT', body: JSON.stringify({ googleLocation, ...(version ? { version } : {}) }) })
export const unlinkLocation = (locationId: string) => apiFetch<void>(`${loc(locationId)}/link`, { method: 'DELETE' })
export const syncNow = (locationId: string) =>
  apiFetch<{ syncStatus: string; changed: boolean; lastSyncAt: string | null }>(`${loc(locationId)}/sync`, { method: 'POST', body: '{}' })
export const saveReviewSettings = (locationId: string, body: ReviewSettings) =>
  apiFetch<ReviewSettings>(`${loc(locationId)}/review-settings`, { method: 'PUT', body: JSON.stringify(body) })

export const ERRORS: Record<string, string> = {
  not_connected: 'Koppla Google först.',
  not_linked: 'Välj vilken Google-plats restaurangen är först.',
  already_linked: 'Den Google-platsen är redan kopplad till en annan restaurang.',
  google_unavailable: 'Google svarar inte just nu. Försök igen om en stund.',
  invalid_state: 'Kopplingen gick ut. Försök koppla igen.',
  invalid_delay: 'Fördröjningen ska vara mellan 30 minuter och 3 dygn.',
  invalid_days: 'Tiden mellan två förfrågningar ska vara 30-365 dagar.',
  invalid_channel: 'Välj e-post, SMS eller båda.',
  invalid_sources: 'Välj efter bokning, beställning eller båda.',
}

const DAY_LABEL: Record<string, string> = {
  MONDAY: 'Måndag', TUESDAY: 'Tisdag', WEDNESDAY: 'Onsdag', THURSDAY: 'Torsdag', FRIDAY: 'Fredag',
  SATURDAY: 'Lördag', SUNDAY: 'Söndag',
}
const DAYS = Object.keys(DAY_LABEL)

function clock(t?: TimeOfDay): string {
  return `${String(t?.hours ?? 0).padStart(2, '0')}:${String(t?.minutes ?? 0).padStart(2, '0')}`
}

/** Öppettiderna som Google kommer att visa, en rad per veckodag. */
export function weekLines(preview: Preview): { day: string; text: string }[] {
  return DAYS.map((day) => {
    const periods = preview.regularHours.periods.filter((p) => p.openDay === day)
    return {
      day: DAY_LABEL[day],
      text: periods.length ? periods.map((p) => `${clock(p.openTime)}-${clock(p.closeTime)}`).join(', ') : 'Stängt',
    }
  })
}

/** Avvikande dagar som skickas till Google (inom ett år). */
export function specialLines(preview: Preview): { date: string; text: string }[] {
  const byDate = new Map<string, string[]>()
  for (const p of preview.specialHours.specialHourPeriods) {
    const date = `${p.startDate.year}-${String(p.startDate.month).padStart(2, '0')}-${String(p.startDate.day).padStart(2, '0')}`
    const list = byDate.get(date) ?? []
    list.push(p.closed ? 'Stängt' : `${clock(p.openTime)}-${clock(p.closeTime)}`)
    byDate.set(date, list)
  }
  return [...byDate.entries()].map(([date, parts]) => ({ date, text: parts.join(', ') }))
}

export function syncedText(link: Link): string {
  if (link.syncStatus === 'error') return 'Kunde inte synka senast. Försök igen med Synka nu.'
  if (!link.lastSyncAt) return 'Synkas inom en timme.'
  const at = new Date(link.lastSyncAt)
  return `Synkat ${at.toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}
