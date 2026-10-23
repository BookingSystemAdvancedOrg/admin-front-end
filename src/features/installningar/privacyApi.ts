import { apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Gästernas integritet (functions/guest-privacy, bara ägare):
 * restaurangens integritetspolicy och samtycken till erbjudanden.
 * Utan API (VITE_API_BASE_URL osatt) körs allt på mockdata nedan.
 */

export interface PrivacyNotice {
  body: string
  version: number
  updatedAt: string | null
  /** false = standardmallen (ingen egen text sparad). */
  custom: boolean
}

export type ConsentChannel = 'email' | 'sms'

export interface ConsentRecord {
  at: string
  action: 'grant' | 'withdraw' | 'suppressed'
  channel: ConsentChannel
  source: string
  text?: string
  textVersion?: string
  by: 'guest' | 'restaurant' | 'system'
}

export interface ChannelConsent {
  state: 'granted' | 'withdrawn' | 'none'
  history: ConsentRecord[]
}

export type ConsentLookup = Partial<Record<ConsentChannel, ChannelConsent>>

export const NOTICE_MAX = 20_000

// --- mockdata --------------------------------------------------------------------

const MOCK_TEMPLATE = [
  '## Personuppgiftsansvarig',
  'Demorestaurangen AB (org.nr 556000-0000), Storgatan 1, 111 22 Stockholm ansvarar för behandlingen av dina personuppgifter. Kontakt: hej@demo.se.',
  '',
  '## Vilka uppgifter vi behandlar och varför',
  '- Bokning: namn, e-post, telefonnummer, antal gäster, datum och tid samt ditt eventuella meddelande (rättslig grund: avtal).',
  '- Beställning: namn, e-post, telefonnummer och det du beställer (avtal och bokföring).',
  '',
  '## Hur länge uppgifterna sparas',
  '- Bokningar raderas cirka 13 månader efter besöket.',
  '- Kvitton sparas i 7 år enligt bokföringslagen, utan dina kontaktuppgifter.',
  '',
  '## Dina rättigheter',
  'Du har rätt att få veta vilka uppgifter vi har om dig, få dem rättade eller raderade. Kontakta oss på hej@demo.se.',
].join('\n')

let mockNotice: PrivacyNotice = { body: MOCK_TEMPLATE, version: 0, updatedAt: null, custom: false }
const mockLog: Record<string, ConsentRecord[]> = {
  'email:anna@example.se': [{
    at: '2026-09-14T18:02:11.000Z', action: 'grant', channel: 'email', source: 'booking', by: 'guest',
    textVersion: 'offers_v1',
    text: 'Ja, Demorestaurangen får skicka mig erbjudanden och nyheter. Frivilligt, och jag kan ta tillbaka samtycket när jag vill.',
  }],
  'sms:+46701234567': [{
    at: '2026-09-14T18:02:11.000Z', action: 'grant', channel: 'sms', source: 'booking', by: 'guest',
    textVersion: 'offers_v1',
    text: 'Ja, Demorestaurangen får skicka mig erbjudanden och nyheter. Frivilligt, och jag kan ta tillbaka samtycket när jag vill.',
  }],
}

function mockLookup(email?: string, phone?: string): ConsentLookup {
  const out: ConsentLookup = {}
  for (const [channel, id] of [['email', email], ['sms', phone]] as const) {
    if (!id) continue
    const history = [...(mockLog[`${channel}:${id}`] ?? [])].reverse()
    out[channel] = {
      state: history.length === 0 ? 'none' : history[0].action === 'grant' ? 'granted' : 'withdrawn',
      history,
    }
  }
  return out
}

// --- API ---------------------------------------------------------------------------

export async function getPrivacyNotice(): Promise<{ notice: PrivacyNotice; template: string }> {
  if (!isApiConfigured()) return { notice: mockNotice, template: MOCK_TEMPLATE }
  return apiFetch('/privacy/notice')
}

export async function savePrivacyNotice(body: string): Promise<PrivacyNotice> {
  if (!isApiConfigured()) {
    mockNotice = { body, version: mockNotice.version + 1, updatedAt: new Date().toISOString(), custom: true }
    return mockNotice
  }
  return (await apiFetch<{ notice: PrivacyNotice }>('/privacy/notice', {
    method: 'PUT',
    body: JSON.stringify({ body }),
  })).notice
}

export async function resetPrivacyNotice(): Promise<PrivacyNotice> {
  if (!isApiConfigured()) {
    mockNotice = { body: MOCK_TEMPLATE, version: 0, updatedAt: null, custom: false }
    return mockNotice
  }
  return (await apiFetch<{ notice: PrivacyNotice }>('/privacy/notice', { method: 'DELETE' })).notice
}

export async function lookupConsent(email?: string, phone?: string): Promise<ConsentLookup> {
  if (!isApiConfigured()) return mockLookup(email, phone)
  const q = new URLSearchParams()
  if (email) q.set('email', email)
  if (phone) q.set('phone', phone)
  return apiFetch(`/privacy/consents?${q.toString()}`)
}

export async function withdrawConsent(
  channels: ConsentChannel[],
  email?: string,
  phone?: string,
): Promise<ConsentLookup & { withdrawn: ConsentChannel[] }> {
  if (!isApiConfigured()) {
    const withdrawn: ConsentChannel[] = []
    for (const [channel, id] of [['email', email], ['sms', phone]] as const) {
      const log = id ? (mockLog[`${channel}:${id}`] ??= []) : null
      if (!log || !channels.includes(channel) || log.at(-1)?.action !== 'grant') continue
      log.push({ at: new Date().toISOString(), action: 'withdraw', channel, source: 'admin', by: 'restaurant' })
      withdrawn.push(channel)
    }
    return { ...mockLookup(email, phone), withdrawn }
  }
  return apiFetch('/privacy/consents/withdraw', {
    method: 'POST',
    body: JSON.stringify({ channels, ...(email ? { email } : {}), ...(phone ? { phone } : {}) }),
  })
}

// --- export och radering (GDPR art. 15, 17, 20) ------------------------------

export interface GuestExport {
  email: string | null
  phone: string | null
  exportedAt: string
  consents: ConsentLookup
  subscriber: Record<string, unknown> | null
  welcomeOfferCode: Record<string, unknown> | null
  bookings: Record<string, unknown>[]
  orders: Record<string, unknown>[]
  cateringRequests: Record<string, unknown>[]
}

export interface KeptItem {
  kind: 'booking' | 'order' | 'catering'
  locationId: string
  status: string | null
  date: string | null
  id: string | null
}

export interface EraseResult {
  consentWithdrawn: ConsentChannel[]
  marketingRowsDeleted: number
  anonymised: number
  kept: KeptItem[]
}

function guestQuery(email?: string, phone?: string): URLSearchParams {
  const q = new URLSearchParams()
  if (email) q.set('email', email)
  if (phone) q.set('phone', phone)
  return q
}

/** Allt som finns sparat om gästen hos restaurangen. */
export async function exportGuest(email?: string, phone?: string): Promise<GuestExport> {
  if (!isApiConfigured()) {
    return {
      email: email ?? null, phone: phone ?? null, exportedAt: new Date().toISOString(),
      consents: mockLookup(email, phone), subscriber: null, welcomeOfferCode: null,
      bookings: email === 'anna@example.se'
        ? [{ reservationId: 'r1', date: '2026-09-20', time: '18:00', partySize: 2, customerName: 'Anna Andersson',
             customerEmail: email, status: 'arrived' }]
        : [],
      orders: [], cateringRequests: [],
    }
  }
  return apiFetch(`/privacy/guests?${guestQuery(email, phone).toString()}`)
}

/** Sparar exporten som en JSON-fil hos ägaren (inget lämnar webbläsaren). */
export function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Raderar gästens uppgifter: kvitton och påskrivna avtal finns kvar utan kontaktuppgifter. */
export async function eraseGuest(email?: string, phone?: string): Promise<EraseResult> {
  if (!isApiConfigured()) {
    const consentWithdrawn: ConsentChannel[] = []
    for (const [channel, id] of [['email', email], ['sms', phone]] as const) {
      const log = id ? mockLog[`${channel}:${id}`] : undefined
      if (!log?.length) continue
      log.push({ at: new Date().toISOString(), action: 'withdraw', channel, source: 'erasure', by: 'restaurant' })
      consentWithdrawn.push(channel)
    }
    return { consentWithdrawn, marketingRowsDeleted: email ? 1 : 0, anonymised: email === 'anna@example.se' ? 1 : 0, kept: [] }
  }
  return apiFetch('/privacy/guests/erase', {
    method: 'POST',
    body: JSON.stringify({ ...(email ? { email } : {}), ...(phone ? { phone } : {}) }),
  })
}

/** Vad en radering gjorde, i en mening (plus det som behölls). */
export function eraseSummary(r: EraseResult): string {
  const parts = [`${r.anonymised} ${r.anonymised === 1 ? 'post' : 'poster'} anonymiserades`]
  if (r.marketingRowsDeleted) parts.push('gästen togs bort från mottagarlistan')
  if (r.consentWithdrawn.length) parts.push('samtycket till erbjudanden återkallades')
  const kept = r.kept.length
    ? ` ${r.kept.length} pågående ${r.kept.length === 1 ? 'post' : 'poster'} finns kvar: avboka eller avsluta och radera igen.`
    : ''
  return `Klart: ${parts.join(', ')}.${kept}`
}
