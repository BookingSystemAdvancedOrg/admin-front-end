import { apiFetch } from '../../shared/api'

/** Annonser på Facebook och Instagram (CONTRACTS.md 6.A). Alla anrop är bara för ägaren. */

export type Goal = 'bookings' | 'orders' | 'catering' | 'awareness'
export type CampaignStatus = 'publishing' | 'paused' | 'active' | 'completed' | 'failed' | 'rejected'

export interface Connection {
  status: 'connected' | 'needs_reauth' | 'disconnected'
  assets?: { adAccountId?: string; pageId?: string; instagramId?: string; businessId?: string }
  dsa: { beneficiary: string; payor: string }
  monthlyCapSek: number
  spendThisMonthSek: number
  killSwitch: boolean
  missingPermissions: string[]
  version: number
}

export interface Assets {
  businesses: { id: string; name: string }[]
  adAccounts: { id: string; name: string; currency?: string; has_payment_method?: boolean }[]
  pages: { id: string; name: string }[]
  instagram: { id: string; username?: string }[]
  missing: { kind: 'business' | 'ad_account' | 'page' | 'instagram' | 'payment_method'; deepLink: string }[]
}

export interface Campaign {
  campaignId: string
  locationId: string
  goal: Goal
  status: CampaignStatus
  creative: { menuItemId: string; imageKey: string; headline: string; primaryText: string; cta: string }
  budgetSek: number
  startDate: string
  endDate: string
  radiusKm: number
  utmCampaign: string
  version: number
  createdAt: string
  error?: { code: string }
  previewUrl?: string
}

export interface InsightRow {
  campaignId: string
  day: string
  spendSek: number
  reach: number
  clicks: number
  bookings: number
  orders: number
  costPerBookingSek: number | null
  costPerOrderSek: number | null
}

export interface Insights {
  rows: InsightRow[]
  totals: { spendSek: number; reach: number; clicks: number; bookings: number; orders: number; costPerBookingSek: number | null; costPerOrderSek: number | null }
}

const loc = (id: string) => `/locations/${encodeURIComponent(id)}/meta-ads`

export const getConnection = () => apiFetch<Connection>('/tenant/meta-ads/connection')
export const startConnect = () => apiFetch<{ authorizeUrl: string }>('/tenant/meta-ads/connection/start', { method: 'POST', body: '{}' })
export const finishConnect = (code: string, state: string) =>
  apiFetch<Connection>('/tenant/meta-ads/connection/callback', { method: 'POST', body: JSON.stringify({ code, state }) })
export const getAssets = () => apiFetch<Assets>('/tenant/meta-ads/assets')
export const saveConnection = (body: {
  adAccountId: string; pageId: string; instagramId?: string | null
  dsa: { beneficiary: string; payor: string }; monthlyCapSek: number; version: number
}) => apiFetch<Connection>('/tenant/meta-ads/connection', { method: 'PUT', body: JSON.stringify(body) })
export const disconnect = () => apiFetch<void>('/tenant/meta-ads/connection', { method: 'DELETE' })

export const suggestCopy = (locationId: string, menuItemId: string, goal: Goal) =>
  apiFetch<{ suggestions: { headline: string; primaryText: string }[] }>(`${loc(locationId)}/copy`, {
    method: 'POST', body: JSON.stringify({ menuItemId, goal }),
  })
export const createCampaign = (locationId: string, body: {
  campaignId: string; goal: Goal; menuItemId: string; headline: string; primaryText: string
  budgetSek: number; days: number; radiusKm: number
}) => apiFetch<Campaign>(`${loc(locationId)}/campaigns`, { method: 'POST', body: JSON.stringify(body) })
export const listCampaigns = (locationId: string) =>
  apiFetch<{ campaigns: Campaign[] }>(`${loc(locationId)}/campaigns`)
export const getCampaign = (locationId: string, campaignId: string) =>
  apiFetch<Campaign>(`${loc(locationId)}/campaigns/${encodeURIComponent(campaignId)}`)
export const activate = (locationId: string, c: Campaign) =>
  apiFetch<Campaign>(`${loc(locationId)}/campaigns/${encodeURIComponent(c.campaignId)}/activate`, {
    method: 'POST', body: JSON.stringify({ version: c.version }),
  })
export const pause = (locationId: string, c: Campaign) =>
  apiFetch<Campaign>(`${loc(locationId)}/campaigns/${encodeURIComponent(c.campaignId)}/pause`, {
    method: 'POST', body: JSON.stringify({ version: c.version }),
  })
export const getInsights = (locationId: string, from: string, to: string) =>
  apiFetch<Insights>(`${loc(locationId)}/insights?from=${from}&to=${to}`)

export const GOALS: { id: Goal; label: string; text: string }[] = [
  { id: 'bookings', label: 'Fler bokningar', text: 'Annonsen leder till bokningen på er webbplats.' },
  { id: 'orders', label: 'Fler beställningar', text: 'Annonsen leder till beställningen av mat.' },
  { id: 'catering', label: 'Fler cateringförfrågningar', text: 'Annonsen leder till cateringformuläret.' },
  { id: 'awareness', label: 'Fler som känner till er', text: 'Annonsen leder till er startsida.' },
]

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  publishing: 'Skapas hos Meta…', paused: 'Pausad', active: 'Visas', completed: 'Avslutad',
  failed: 'Kunde inte skapas', rejected: 'Nekad av Meta',
}

export const MISSING_LABEL: Record<Assets['missing'][number]['kind'], string> = {
  business: 'Skapa en företagsportfölj hos Meta',
  ad_account: 'Skapa annonskonto hos Meta',
  page: 'Skapa en Facebooksida',
  instagram: 'Koppla Instagram till sidan',
  payment_method: 'Lägg till ett betalsätt hos Meta',
}

export const FAILED_LABEL: Record<string, string> = {
  kill_switch: 'Annonser är pausade av Booqy just nu.',
  not_connected: 'Kopplingen till Meta saknas. Koppla igen.',
  assets_missing: 'Något saknas hos Meta (annonskonto, sida eller bild).',
  unknown_image: 'Bilden kunde inte användas.',
  feature_not_in_plan: 'Annonser ingår inte längre i er plan.',
  start_failed: 'Annonsen kom aldrig i gång. Skapa den igen.',
}

export const ERRORS: Record<string, string> = {
  not_connected: 'Koppla Meta först.',
  assets_missing: 'Något saknas: annonskonto, Facebooksida, en bild på rätten eller restaurangens adress (sparas under Catering > Leverans).',
  cap_exceeded: 'Budgeten skulle gå över ert månadstak. Sänk budgeten eller höj taket.',
  kill_switch: 'Annonser är pausade av Booqy just nu. Försök igen senare.',
  invalid_status: 'Annonsen kan inte ändras just nu.',
  changed_retry: 'Annonsen ändrades samtidigt. Det senaste visas nu; försök igen.',
  alcohol_not_allowed: 'Rätter med alkohol kan inte annonseras.',
  quota_exceeded: 'Månadens textförslag är slut. Skriv texten själv.',
  ai_unavailable: 'Textförslagen fungerar inte just nu. Skriv texten själv.',
  meta_unavailable: 'Meta svarar inte just nu. Försök igen om en stund.',
  invalid_state: 'Kopplingen gick ut. Försök koppla igen.',
  invalid_cap: 'Månadstaket är för högt eller för lågt.',
  unknown_asset: 'Välj ett konto och en sida från listan.',
  text_too_long: 'Texten är för lång.',
  invalid_budget: 'Budgeten ska vara 100-20 000 kr.',
  invalid_days: 'Annonsen ska visas 3-30 dagar.',
  invalid_radius: 'Området ska vara 1-40 km.',
}

export function newCampaignId(): string {
  return crypto.randomUUID()
}
