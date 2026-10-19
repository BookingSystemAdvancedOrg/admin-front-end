import { API_BASE_URL, ApiError, apiFetch } from '../../shared/api'
import { getAccessToken } from '../auth/cognito'

/**
 * Marknadsföring (planfunktionen "marketing", bara ägare) - GET/POST/PUT/DELETE
 * /marketing/*. Backend: application/functions/marketing.
 *
 *  - Statistik: besök på restaurangens webbplats utan cookies, per dag och
 *    kanal, och vad de ledde till (bokningar, beställningar, omsättning).
 *  - Mallar: e-postmallar byggda av block (rubrik, text, bild, knapp, rätt
 *    från menyn, linje, mellanrum).
 *  - Kampanjer: en mall + en målgrupp. Skickas nu eller schemaläggs; det som
 *    skickas låses när ägaren trycker Skicka.
 *  - Mottagare: gäster som kryssat i "erbjudanden" när de bokade.
 */

// --- statistik ------------------------------------------------------------

export interface StatCounts {
  visits: number
  pageviews: number
  bookings: number
  guests: number
  orders: number
  catering: number
  revenueOre: number
}

export interface Overview {
  from: string
  to: string
  totals: StatCounts
  previous: StatCounts
  channels: (StatCounts & { channel: string })[]
  campaigns: (StatCounts & { campaign: string; channel: string | null })[]
  series: (StatCounts & { date: string })[]
  subscribers: number
  emailsThisMonth: number
  monthlyLimit: number
}

export function getOverview(from: string, to: string, locationId?: string | null): Promise<Overview> {
  const q = new URLSearchParams({ from, to })
  if (locationId) q.set('locationId', locationId)
  return apiFetch<Overview>(`/marketing/overview?${q}`)
}

export const CHANNEL_LABEL: Record<string, string> = {
  direct: 'Direkt',
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  tripadvisor: 'Tripadvisor',
  thefork: 'TheFork',
  'apple-maps': 'Apple Kartor',
  email: 'E-post',
  qr: 'QR-kod',
  sms: 'SMS',
  other: 'Övrigt',
}

export function channelLabel(channel: string | null | undefined): string {
  return CHANNEL_LABEL[channel ?? 'direct'] ?? channel ?? 'Direkt'
}

// --- mallar -----------------------------------------------------------------

export type Destination = 'home' | 'book' | 'order' | 'menu' | 'catering' | 'custom'

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'button'; label: string; destination: Destination; url?: string }
  | { type: 'dish'; menuItemId: string; locationId: string }
  | { type: 'divider' }
  | { type: 'spacer'; size: 's' | 'm' | 'l' }

export type BlockType = Block['type']

export interface TemplateInput {
  name: string
  subject: string
  preheader: string
  blocks: Block[]
}

export interface Template extends TemplateInput {
  templateId: string
  createdAt: string
  updatedAt: string
}

export interface Starter extends TemplateInput {
  key: string
}

export const MAX_BLOCKS = 40

export const BLOCK_LABEL: Record<BlockType, string> = {
  heading: 'Rubrik',
  text: 'Text',
  image: 'Bild',
  button: 'Knapp',
  dish: 'Rätt från menyn',
  divider: 'Linje',
  spacer: 'Mellanrum',
}

export const DESTINATION_LABEL: Record<Destination, string> = {
  home: 'Startsidan',
  book: 'Boka bord',
  order: 'Beställ mat',
  menu: 'Menyn',
  catering: 'Catering',
  custom: 'Egen länk',
}

export function newBlock(type: BlockType, locationId: string | null): Block {
  switch (type) {
    case 'heading':
      return { type, text: 'Ny rubrik' }
    case 'text':
      return { type, text: 'Hej {förnamn}!' }
    case 'image':
      return { type, url: '', alt: '' }
    case 'button':
      return { type, label: 'Boka bord', destination: 'book' }
    case 'dish':
      return { type, menuItemId: '', locationId: locationId ?? '' }
    case 'divider':
      return { type }
    case 'spacer':
      return { type, size: 'm' }
  }
}

const HTTPS = /^https:\/\/[^\s<>"']{3,500}$/

/** Samma regler som servern, så att fel syns innan något sparas. */
export function templateErrors(t: TemplateInput): string[] {
  const errors: string[] = []
  if (!t.name.trim()) errors.push('Mallen behöver ett namn.')
  if (!t.subject.trim()) errors.push('Ämnesraden får inte vara tom.')
  if (t.subject.trim().length > 120) errors.push('Ämnesraden får vara högst 120 tecken.')
  if (t.preheader.trim().length > 140) errors.push('Förhandstexten får vara högst 140 tecken.')
  if (t.blocks.length === 0) errors.push('Lägg till minst ett block.')
  if (t.blocks.length > MAX_BLOCKS) errors.push(`Högst ${MAX_BLOCKS} block.`)
  t.blocks.forEach((b, i) => {
    const n = `Block ${i + 1} (${BLOCK_LABEL[b.type].toLowerCase()})`
    if ((b.type === 'heading' || b.type === 'text') && !b.text.trim()) errors.push(`${n}: texten är tom.`)
    if (b.type === 'heading' && b.text.trim().length > 120) errors.push(`${n}: högst 120 tecken.`)
    if (b.type === 'text' && b.text.trim().length > 2000) errors.push(`${n}: högst 2000 tecken.`)
    if (b.type === 'image' && !HTTPS.test(b.url.trim())) errors.push(`${n}: ange en bildadress som börjar med https://.`)
    if (b.type === 'button') {
      if (!b.label.trim()) errors.push(`${n}: knappen behöver en text.`)
      if (b.label.trim().length > 40) errors.push(`${n}: knapptexten får vara högst 40 tecken.`)
      if (b.destination === 'custom' && !HTTPS.test((b.url ?? '').trim())) {
        errors.push(`${n}: ange en länk som börjar med https://.`)
      }
    }
    if (b.type === 'dish' && (!b.menuItemId || !b.locationId)) errors.push(`${n}: välj en rätt.`)
  })
  return errors
}

/** Det servern tar emot: inga tomma valfria fält. */
export function cleanTemplate(t: TemplateInput): TemplateInput {
  return {
    name: t.name.trim(),
    subject: t.subject.trim(),
    preheader: t.preheader.trim(),
    blocks: t.blocks.map((b) => {
      if (b.type === 'button' && b.destination !== 'custom') return { type: b.type, label: b.label.trim(), destination: b.destination }
      if (b.type === 'button') return { ...b, label: b.label.trim(), url: (b.url ?? '').trim() }
      if (b.type === 'image') return { type: b.type, url: b.url.trim(), alt: (b.alt ?? '').trim() }
      if (b.type === 'heading' || b.type === 'text') return { ...b, text: b.text.trim() }
      return b
    }),
  }
}

export async function listStarters(): Promise<Starter[]> {
  return (await apiFetch<{ starters: Starter[] }>('/marketing/starters')).starters
}

export async function listTemplates(): Promise<Template[]> {
  return (await apiFetch<{ templates: Template[] }>('/marketing/templates')).templates
}

export function createTemplate(t: TemplateInput): Promise<Template> {
  return apiFetch<Template>('/marketing/templates', { method: 'POST', body: JSON.stringify(cleanTemplate(t)) })
}

export function updateTemplate(id: string, t: TemplateInput): Promise<Template> {
  return apiFetch<Template>(`/marketing/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(cleanTemplate(t)),
  })
}

export function deleteTemplate(id: string): Promise<void> {
  return apiFetch<void>(`/marketing/templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function previewTemplate(t: TemplateInput): Promise<{ subject: string; html: string }> {
  return apiFetch('/marketing/preview', { method: 'POST', body: JSON.stringify({ template: cleanTemplate(t) }) })
}

// --- målgrupper och kampanjer ----------------------------------------------

export type AudienceType = 'all' | 'recent' | 'lapsed'

export interface Audience {
  type: AudienceType
  days?: number
  locationId?: string
}

export const AUDIENCE_LABEL: Record<AudienceType, string> = {
  all: 'Alla som prenumererar',
  recent: 'Har besökt oss nyligen',
  lapsed: 'Har inte besökt oss på länge',
}

export function audienceText(a: Audience | null | undefined): string {
  if (!a) return AUDIENCE_LABEL.all
  if (a.type === 'recent') return `Besökt oss senaste ${a.days} dagarna`
  if (a.type === 'lapsed') return `Inte besökt oss på ${a.days} dagar`
  return AUDIENCE_LABEL.all
}

export async function audienceSize(a: Audience): Promise<number> {
  const q = new URLSearchParams({ type: a.type })
  if (a.days) q.set('days', String(a.days))
  if (a.locationId) q.set('locationId', a.locationId)
  return (await apiFetch<{ count: number }>(`/marketing/audience?${q}`)).count
}

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused_limit'
  | 'sent'
  | 'cancelled'

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Utkast',
  scheduled: 'Schemalagd',
  sending: 'Skickas',
  paused_limit: 'Månadsgränsen nådd',
  sent: 'Skickad',
  cancelled: 'Avbruten',
}

export const CAMPAIGN_STATUS_CLASS: Record<CampaignStatus, string> = {
  draft: 'invited',
  scheduled: 'waiting',
  sending: 'arrived',
  paused_limit: 'cancelled',
  sent: 'reserved',
  cancelled: 'cancelled',
}

export interface CampaignStats {
  targeted: number
  sent: number
  failed: number
  delivered: number
  bounced: number
  complained: number
  clicked: number
  unsubscribed: number
  bookings: number
  guests: number
  orders: number
  revenueOre: number
}

export interface CampaignInput {
  name: string
  templateId: string
  subject?: string | null
  audience: Audience
}

export interface Campaign {
  campaignId: string
  name: string
  templateId: string
  subject: string | null
  audience: Audience
  status: CampaignStatus
  scheduledAt: string | null
  startedAt: string | null
  sentAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  stats: Partial<CampaignStats> | null
}

export async function listCampaigns(): Promise<Campaign[]> {
  return (await apiFetch<{ campaigns: Campaign[] }>('/marketing/campaigns')).campaigns
}

function campaignBody(c: CampaignInput): string {
  const subject = c.subject?.trim()
  return JSON.stringify({ name: c.name.trim(), templateId: c.templateId, audience: c.audience, ...(subject ? { subject } : {}) })
}

export function createCampaign(c: CampaignInput): Promise<Campaign> {
  return apiFetch<Campaign>('/marketing/campaigns', { method: 'POST', body: campaignBody(c) })
}

export function updateCampaign(id: string, c: CampaignInput): Promise<Campaign> {
  return apiFetch<Campaign>(`/marketing/campaigns/${encodeURIComponent(id)}`, { method: 'PUT', body: campaignBody(c) })
}

export function deleteCampaign(id: string): Promise<void> {
  return apiFetch<void>(`/marketing/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function sendTest(id: string): Promise<{ sentTo: string }> {
  return apiFetch(`/marketing/campaigns/${encodeURIComponent(id)}/test`, { method: 'POST' })
}

export function sendCampaign(id: string, scheduledAt?: string | null): Promise<Campaign & { audienceSize: number }> {
  return apiFetch(`/marketing/campaigns/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: JSON.stringify(scheduledAt ? { scheduledAt } : {}),
  })
}

/** Fortsätter en kampanj som stannade vid månadsgränsen (ingen får den två gånger). */
export function resumeCampaign(id: string): Promise<{ status: 'scheduled'; scheduledAt: string }> {
  return apiFetch(`/marketing/campaigns/${encodeURIComponent(id)}/resume`, { method: 'POST' })
}

export function cancelCampaign(id: string): Promise<{ status: 'cancelled' }> {
  return apiFetch(`/marketing/campaigns/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
}

// --- mottagare --------------------------------------------------------------

export type SubscriberStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained'

export const SUBSCRIBER_STATUS_LABEL: Record<SubscriberStatus, string> = {
  subscribed: 'Prenumererar',
  unsubscribed: 'Avregistrerad',
  bounced: 'Studsar',
  complained: 'Markerade som skräppost',
}

export const SUBSCRIBER_STATUS_CLASS: Record<SubscriberStatus, string> = {
  subscribed: 'reserved',
  unsubscribed: 'invited',
  bounced: 'cancelled',
  complained: 'cancelled',
}

export interface Subscriber {
  subscriberId: string
  email: string
  name: string | null
  status: SubscriberStatus
  consentAt: string | null
  consentSource: string | null
  lastVisit: string | null
  locations: string[]
  unsubscribedAt: string | null
}

export function listSubscribers(
  status?: SubscriberStatus | '',
  cursor?: string | null,
): Promise<{ subscribers: Subscriber[]; cursor: string | null }> {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (cursor) q.set('cursor', cursor)
  const qs = q.toString()
  return apiFetch(`/marketing/subscribers${qs ? `?${qs}` : ''}`)
}

export function unsubscribe(id: string): Promise<void> {
  return apiFetch<void>(`/marketing/subscribers/${encodeURIComponent(id)}/unsubscribe`, { method: 'POST' })
}

export function eraseSubscriber(id: string): Promise<void> {
  return apiFetch<void>(`/marketing/subscribers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Hämtar mottagarlistan som CSV (med inloggningen) och sparar den som fil. */
export async function exportSubscribers(): Promise<void> {
  if (!API_BASE_URL) throw new Error('API:t är inte konfigurerat.')
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE_URL}/marketing/subscribers/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mottagare.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// --- länkar -----------------------------------------------------------------

export const LINK_SOURCES: { value: string; label: string; medium: string }[] = [
  { value: 'instagram', label: 'Instagram', medium: 'social' },
  { value: 'facebook', label: 'Facebook', medium: 'social' },
  { value: 'tiktok', label: 'TikTok', medium: 'social' },
  { value: 'qr', label: 'QR-kod (affisch, meny, flyer)', medium: 'qr' },
  { value: 'sms', label: 'SMS', medium: 'sms' },
  { value: 'newsletter', label: 'Eget nyhetsbrev', medium: 'email' },
  { value: 'google', label: 'Google-profil', medium: 'organic' },
]

/** utm-taggarna API:t räknar: små bokstäver, siffror, - och _. */
export function campaignSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const PATHS: Record<Exclude<Destination, 'custom'>, string> = {
  home: '/',
  book: '/boka-bord',
  order: '/bestall',
  menu: '/meny',
  catering: '/catering',
}

/** En spårbar länk till restaurangens webbplats, eller null om något saknas. */
export function trackedLink(
  siteUrl: string,
  page: Exclude<Destination, 'custom'>,
  source: string,
  campaign: string,
): string | null {
  let base: URL
  try {
    base = new URL(siteUrl.trim())
  } catch {
    return null
  }
  if (base.protocol !== 'https:') return null
  const src = LINK_SOURCES.find((s) => s.value === source)
  const slug = campaignSlug(campaign)
  if (!src || !slug) return null
  const url = new URL(PATHS[page], base.origin)
  // Förhandsvisningsadresser behåller ?restaurang=<slug>.
  base.searchParams.forEach((v, k) => url.searchParams.set(k, v))
  url.searchParams.set('utm_source', src.value)
  url.searchParams.set('utm_medium', src.medium)
  url.searchParams.set('utm_campaign', slug)
  return url.toString()
}

// --- format -----------------------------------------------------------------

export function kronorFromOre(ore: number): string {
  return `${Math.round(ore / 100).toLocaleString('sv-SE')} kr`
}

export function percent(part: number, whole: number): string {
  if (!whole) return '-'
  return `${Math.round((part / whole) * 1000) / 10} %`.replace('.', ',')
}

/** Förändring mot föregående period, t.ex. "+12 %". */
export function change(now: number, before: number): string | null {
  if (!before) return now ? 'ny' : null
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct > 0 ? '+' : ''}${pct} %`
}

export function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Stockholm',
  }).format(d)
}

export const ERROR_TEXT: Record<string, string> = {
  campaign_not_draft: 'Kampanjen är redan skickad eller schemalagd.',
  campaign_not_cancellable: 'Kampanjen kan inte avbrytas längre.',
  campaign_not_paused: 'Kampanjen är inte pausad.',
  'monthly limit reached': 'Månadens gräns för utskick är nådd. Fortsätt nästa månad.',
  'no subscribers in this audience': 'Ingen i målgruppen prenumererar ännu.',
  'the restaurant has no website address yet for the buttons':
    'Restaurangen har ingen webbadress än, så knapparna har ingenstans att leda.',
  "your account has no email address to send a test to": 'Ditt konto saknar e-postadress för testutskick.',
  "the campaign's template no longer exists": 'Mallen kampanjen använder finns inte längre.',
}

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (ERROR_TEXT[err.message]) return ERROR_TEXT[err.message]
    if (err.status === 403) return 'Marknadsföring ingår inte i er plan, eller så är du inte ägare.'
    if (err.status === 400 && err.message) return `${fallback} (${err.message})`
  }
  return fallback
}
