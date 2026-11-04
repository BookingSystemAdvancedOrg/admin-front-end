import { apiFetch } from '../../shared/api'

/** Gästregistret (CONTRACTS.md 6.C). Kontaktuppgifter skickas bara i bodyn, aldrig i adressen. */

export interface GuestSummary {
  guestId: string
  name: string
  lastSeenAt: string | null
  visits: number
  returning: boolean
}

export interface GuestHistoryRow {
  kind: 'booking' | 'order' | 'catering'
  sourceId: string
  locationId: string | null
  date: string | null
  status: string | null
  at: string | null
  partySize?: number
  amountOre?: number
}

export type ConsentState = 'granted' | 'withdrawn' | 'none'

export interface GuestProfile extends GuestSummary {
  firstSeenAt: string | null
  noShows: number
  orders: number
  cateringRequests: number
  locations: string[]
  tags: string[]
  note: string | null
  birthday: string | null
  segmentsExcluded: boolean
  version: number
  spendSek?: { bookingFees: number; orders: number; catering: number }
}

export interface GuestDetail extends GuestProfile {
  history: GuestHistoryRow[]
  contact: { email?: string; phone?: string }
  consent: { email: ConsentState; sms: ConsentState }
}

export interface SegmentRules {
  lapsedDays?: number
  birthdayWithinDays?: number
  minSpendSek?: number
  minVisits?: number
  locationId?: string
  optedIn?: true
}

export interface Segment {
  segmentId: string
  name: string
  rules: SegmentRules
  version: number
  updatedAt?: string
}

export interface SegmentTemplate {
  templateId: string
  name: string
  rules: SegmentRules
}

/** Klientens id för idempotenta anrop (segment, export, ombyggnad). */
export function newId(): string {
  return crypto.randomUUID()
}

export function listGuests(params: { cursor?: string | null; locationId?: string | null }) {
  const q = new URLSearchParams()
  if (params.cursor) q.set('cursor', params.cursor)
  if (params.locationId) q.set('locationId', params.locationId)
  const qs = q.toString()
  return apiFetch<{ guests: GuestSummary[]; cursor: string | null }>(`/tenant/guests${qs ? `?${qs}` : ''}`)
}

export function searchGuests(body: { email: string } | { phone: string } | { name: string }) {
  return apiFetch<{ guests: GuestSummary[] }>('/tenant/guests/search', { method: 'POST', body: JSON.stringify(body) })
}

export function getGuest(guestId: string) {
  return apiFetch<GuestDetail>(`/tenant/guests/${encodeURIComponent(guestId)}`)
}

export function updateGuest(
  guestId: string,
  edit: { note?: string | null; tags?: string[]; birthday?: string | null; segmentsExcluded?: boolean; version: number },
) {
  return apiFetch<GuestProfile>(`/tenant/guests/${encodeURIComponent(guestId)}`, {
    method: 'PATCH',
    body: JSON.stringify(edit),
  })
}

export function lookupGuests(locationId: string, contacts: { key: string; email?: string; phone?: string }[]) {
  return apiFetch<{ results: Record<string, { status: 'new' | 'returning'; visits: number; guestId?: string }> }>(
    `/locations/${encodeURIComponent(locationId)}/guests/lookup`,
    { method: 'POST', body: JSON.stringify({ contacts }) },
  )
}

export function listSegments() {
  return apiFetch<{ segments: Segment[]; templates: SegmentTemplate[] }>('/tenant/guest-segments')
}

export function saveSegment(segmentId: string, body: { name: string; rules: SegmentRules; version?: number }) {
  return apiFetch<Segment>(`/tenant/guest-segments/${encodeURIComponent(segmentId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteSegment(segmentId: string) {
  return apiFetch<void>(`/tenant/guest-segments/${encodeURIComponent(segmentId)}`, { method: 'DELETE' })
}

export function previewSegment(segmentId: string) {
  return apiFetch<{ total: number; reachable: number; sample: { guestId: string; name: string }[] }>(
    `/tenant/guest-segments/${encodeURIComponent(segmentId)}/preview`,
  )
}

export function exportSegment(segmentId: string, exportId: string) {
  return apiFetch<{ exportId: string; count: number }>(
    `/tenant/guest-segments/${encodeURIComponent(segmentId)}/exports`,
    { method: 'POST', body: JSON.stringify({ exportId }) },
  )
}

export function rebuildGuests(runId: string) {
  return apiFetch<{ status: string }>('/tenant/guests/rebuild', { method: 'POST', body: JSON.stringify({ runId }) })
}

/** "Inte varit här på 90 dagar", ... - samma ord som mallarna. */
export function describeRules(rules: SegmentRules, locationName?: (id: string) => string): string {
  const parts: string[] = []
  if (rules.lapsedDays) parts.push(`inte varit här på ${rules.lapsedDays} dagar`)
  if (rules.birthdayWithinDays) parts.push(`fyller år inom ${rules.birthdayWithinDays} dagar`)
  if (rules.minSpendSek) parts.push(`handlat för minst ${rules.minSpendSek.toLocaleString('sv-SE')} kr`)
  if (rules.minVisits) parts.push(`minst ${rules.minVisits} besök`)
  if (rules.locationId) parts.push(`på ${locationName ? locationName(rules.locationId) : rules.locationId}`)
  if (rules.optedIn) parts.push('vill ha erbjudanden')
  const text = parts.join(', ')
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('sv-SE')
}

/** Formuläret för en målgrupp (tomma fält betyder att regeln inte används). */
export interface Draft {
  segmentId: string
  version?: number
  name: string
  lapsedDays: string
  birthdayWithinDays: string
  minSpendSek: string
  minVisits: string
  locationId: string
  optedIn: boolean
}

export function draftFrom(segmentId: string, name: string, rules: SegmentRules, version?: number): Draft {
  return {
    segmentId, version, name,
    lapsedDays: rules.lapsedDays ? String(rules.lapsedDays) : '',
    birthdayWithinDays: rules.birthdayWithinDays ? String(rules.birthdayWithinDays) : '',
    minSpendSek: rules.minSpendSek ? String(rules.minSpendSek) : '',
    minVisits: rules.minVisits ? String(rules.minVisits) : '',
    locationId: rules.locationId ?? '',
    optedIn: Boolean(rules.optedIn),
  }
}

export function rulesFrom(d: Draft): SegmentRules {
  const rules: SegmentRules = {}
  const n = (v: string) => (v.trim() ? Number(v) : undefined)
  if (n(d.lapsedDays)) rules.lapsedDays = n(d.lapsedDays)
  if (n(d.birthdayWithinDays)) rules.birthdayWithinDays = n(d.birthdayWithinDays)
  if (n(d.minSpendSek)) rules.minSpendSek = n(d.minSpendSek)
  if (n(d.minVisits)) rules.minVisits = n(d.minVisits)
  if (d.locationId) rules.locationId = d.locationId
  if (d.optedIn) rules.optedIn = true
  return rules
}

