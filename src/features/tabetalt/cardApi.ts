import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
import { CARD_READER_KEY_PREFIX } from '../../shared/storageRegistry'

/**
 * Kortbetalning i restaurangen ("Ta betalt"), backend terminal-payments
 * (shared/card_payments.py i application).
 *
 * Personalen väljer belopp (fritt eller en obetald beställning) och en av
 * platsens kortläsare (Stripe Reader S700/S710, kopplade i Booqy Console).
 * Betalningen skickas till läsaren, gästen blippar eller sätter i kortet,
 * och sidan frågar efter resultatet tills det är "Betalt" eller "Nekat".
 * Varje kassaköp har ett eget checkoutId: samma id två gånger är samma
 * betalning, och "Försök igen" använder samma Stripe-betalning, så ingen
 * blir dragen två gånger.
 *
 * Utan API (VITE_API_BASE_URL saknas) körs en simulerad läsare i minnet.
 */

export type CardStatus = 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded'

/** Momssatser för ett fritt belopp: 12 % mat och dryck, 25 % alkohol. */
export type VatRate = 12 | 25

export interface CardPayment {
  paymentId: string
  locationId: string
  date: string
  /** Öre. */
  amount: number
  orderId?: string
  orderNumber?: number
  note?: string
  /** Ett fritt beloppets momssats, vald av personalen. */
  vatRate?: VatRate
  readerId: string
  readerLabel?: string
  status: CardStatus
  attempt?: number
  failure?: { code: string; message?: string }
  card?: { brand?: string; last4?: string; readMethod?: string; wallet?: string }
  refund?: { amount: number; at: string }
  simulated?: boolean
  createdAt?: string
  paidAt?: string
  receiptsSent?: number
}

export interface CardReader {
  id: string
  label: string
  deviceType?: string
  status: 'online' | 'offline'
  simulated?: boolean
}

export interface ReceiptRow {
  label: string
  value: string
}

export interface Receipt {
  title: string
  restaurant: string
  seller: { name: string; org?: string | null; address?: string | null }
  when: string
  reference: string
  orderNumber?: number | null
  note?: string | null
  lines: { quantity: number; name: string; total: number }[]
  vat: { rate: number; vat: number; net: number }[]
  total: number
  vatOnRegister: boolean
  card: ReceiptRow[]
  result: string
  refunded?: number | null
}

/** Obetald beställning som kan betalas i kassan. */
export interface PayableOrder {
  orderId: string
  totalAmount: number
  mode: 'pickup' | 'table'
  tableLabel?: string
  customerName?: string
  createdAt?: string
}

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/card-payments`
}

/** Ett nytt id per kassaköp (32 hex). */
export function newCheckoutId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const MIN_ORE = 300
export const MAX_ORE = 5_000_000

/**
 * "125", "125,5", "125,50" eller "1 250" kronor -> öre. null = inte ett
 * belopp (fler än två decimaler, bokstäver, tomt).
 */
export function parseKronor(text: string): number | null {
  const clean = text.replace(/[\s ]/g, '').replace(/kr$/i, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  const [whole, frac = ''] = clean.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

/** Senast valda läsare på den här enheten, per plats. */
export function rememberedReader(locationId: string): string | null {
  try {
    return localStorage.getItem(CARD_READER_KEY_PREFIX + locationId)
  } catch {
    return null
  }
}

export function rememberReader(locationId: string, readerId: string): void {
  try {
    localStorage.setItem(CARD_READER_KEY_PREFIX + locationId, readerId)
  } catch {
    // Privat läge e.d.: då väljs första läsaren nästa gång.
  }
}

// --- API ------------------------------------------------------------------

export function listReaders(locationId: string): Promise<{ enabled: boolean; readers: CardReader[] }> {
  if (!isApiConfigured()) return Promise.resolve(mock.readers())
  return apiFetch(`${base(locationId)}/readers`)
}

export function listPayments(locationId: string): Promise<{ date: string; enabled: boolean; payments: CardPayment[] }> {
  if (!isApiConfigured()) return Promise.resolve(mock.list())
  return apiFetch(base(locationId))
}

export function listPayableOrders(locationId: string): Promise<PayableOrder[]> {
  if (!isApiConfigured()) return Promise.resolve(mock.orders())
  return apiFetch<{ orders: (PayableOrder & { status: string; cardPaymentId?: string })[] }>(
    `/locations/${encodeURIComponent(locationId)}/orders?all=true`,
  ).then((r) => r.orders.filter((o) => o.status === 'pending_payment'))
}

function mockVat(gross: number, rate: number) {
  const vat = Math.round((gross * rate) / (100 + rate))
  return { rate, vat, net: gross - vat }
}

export function createPayment(
  locationId: string,
  input: { checkoutId: string; readerId: string; amount?: number; orderId?: string; note?: string; vatRate?: VatRate },
): Promise<CardPayment> {
  if (!isApiConfigured()) return mock.create(input)
  return apiFetch(base(locationId), { method: 'POST', body: JSON.stringify(input) })
}

export function getPayment(locationId: string, paymentId: string): Promise<CardPayment> {
  if (!isApiConfigured()) return mock.get(paymentId)
  return apiFetch(`${base(locationId)}/${paymentId}`)
}

type Action = 'cancel' | 'retry' | 'refund'

export function act(locationId: string, paymentId: string, action: Action, body?: object): Promise<CardPayment> {
  if (!isApiConfigured()) return mock.act(paymentId, action)
  return apiFetch(`${base(locationId)}/${paymentId}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

export function simulate(locationId: string, paymentId: string, outcome: 'approve' | 'decline'): Promise<unknown> {
  if (!isApiConfigured()) return mock.simulate(paymentId, outcome)
  return apiFetch(`${base(locationId)}/${paymentId}/simulate`, {
    method: 'POST',
    body: JSON.stringify({ outcome }),
  })
}

export function getReceipt(locationId: string, paymentId: string): Promise<{ payment: CardPayment; receipt: Receipt }> {
  if (!isApiConfigured()) return mock.receipt(paymentId)
  return apiFetch(`${base(locationId)}/${paymentId}/receipt`)
}

export function sendReceipt(locationId: string, paymentId: string, email: string): Promise<CardPayment> {
  if (!isApiConfigured()) return mock.get(paymentId)
  return apiFetch(`${base(locationId)}/${paymentId}/receipt`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

// --- texter ----------------------------------------------------------------

const FAILURES: Record<string, string> = {
  reader_offline: 'Läsaren är offline. Kontrollera att den är på och har nät, eller välj en annan läsare.',
  reader_busy: 'Läsaren är upptagen med en annan betalning. Vänta eller välj en annan läsare.',
  reader_timeout: 'Läsaren svarade inte i tid. Försök igen.',
  reader_fault: 'Läsaren rapporterade ett fel. Starta om den och försök igen.',
  reader_refused: 'Läsaren tog inte emot betalningen. Försök igen.',
  insufficient_funds: 'Kortet nekades: otillräckligt saldo.',
  expired_card: 'Kortet har gått ut.',
  incorrect_pin: 'Fel PIN-kod.',
  pin_try_exceeded: 'För många fel PIN-koder. Använd ett annat kort.',
  lost_card: 'Kortet nekades av banken.',
  stolen_card: 'Kortet nekades av banken.',
  card_declined: 'Kortet nekades. Be gästen prova igen eller använda ett annat kort.',
  generic_decline: 'Kortet nekades. Be gästen prova igen eller använda ett annat kort.',
  action_canceled: 'Betalningen avbröts på läsaren.',
  customer_canceled: 'Gästen avbröt på läsaren.',
}

export function failureText(payment: CardPayment): string {
  if (payment.status === 'canceled') return 'Betalningen avbröts. Inget har dragits.'
  const code = payment.failure?.code ?? ''
  return FAILURES[code] ?? 'Betalningen gick inte igenom. Inget har dragits.'
}

const ERRORS: Record<string, string> = {
  terminal_not_enabled: 'Kortterminaler är inte aktiverade för den här platsen ännu.',
  feature_not_in_plan: 'Kortterminaler ingår inte i restaurangens plan.',
  order_not_payable: 'Beställningen kan inte betalas här längre (den är redan betald eller avbruten).',
  order_already_paid: 'Gästen har redan betalat beställningen online. Inget har dragits.',
  order_other_account: 'Beställningen hör till ett annat Stripe-konto och kan inte betalas här.',
  order_checkout_open: 'Gästens onlinebetalning pågår fortfarande. Försök igen om en stund.',
  order_being_paid: 'Beställningen betalas redan i en annan kassa.',
  payment_canceled: 'Betalningen är stängd i Stripe. Starta en ny betalning.',
  changed_retry: 'Betalningen ändrades precis. Visar läget nu.',
  refund_via_order: 'Betalningen gäller en beställning: återbetala genom att avbryta beställningen under Beställningar.',
  refund_via_kassa: 'Betalningen gjordes i Kassan: gör en retur på kvittot under Kassa, Kvitton.',
  refund_failed: 'Stripe kunde inte återbetala just nu. Inget har ändrats, försök igen.',
  stripe_refused: 'Stripe tog inte emot betalningen. Försök igen eller kontakta support.',
  payment_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund.',
  receipt_limit: 'Kvittot har redan skickats fem gånger.',
  not_paid: 'Kvitto finns bara för betalda köp.',
  owner_only: 'Bara ägaren kan återbetala.',
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (ERRORS[err.message]) return ERRORS[err.message]
    if (err.status === 404) return 'Läsaren eller betalningen finns inte här. Uppdatera sidan.'
    if (err.status === 400) return 'Kontrollera beloppet och försök igen.'
  }
  return 'Något gick fel. Kontrollera betalningen i listan innan du försöker igen.'
}

// --- simulerad läsare utan API ----------------------------------------------

const mock = (() => {
  const payments = new Map<string, CardPayment>()
  const readers: CardReader[] = [
    { id: 'tmr_kassan', label: 'Kassan', status: 'online', deviceType: 'simulated_wisepos_e', simulated: true },
    { id: 'tmr_baren', label: 'Baren', status: 'offline', deviceType: 'stripe_s700' },
  ]
  const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 250))
  const fail = (code: string) => Promise.reject(new ApiError(409, code))
  const find = (id: string) => payments.get(id) ?? null
  const save = (p: CardPayment) => {
    payments.set(p.paymentId, p)
    return delay({ ...p })
  }
  return {
    readers: () => ({ enabled: true, readers }),
    list: () => ({
      date: new Date().toISOString().slice(0, 10),
      enabled: true,
      payments: [...payments.values()].reverse(),
    }),
    orders: (): PayableOrder[] => [
      { orderId: 'f'.repeat(32), totalAmount: 28550, mode: 'table', tableLabel: '5', customerName: 'Anna Svensson' },
    ],
    create(input: { checkoutId: string; readerId: string; amount?: number; orderId?: string; note?: string; vatRate?: VatRate }) {
      const existing = find(input.checkoutId)
      if (existing) return delay({ ...existing })
      const reader = readers.find((r) => r.id === input.readerId)
      const amount = input.orderId ? 28550 : input.amount ?? 0
      const p: CardPayment = {
        paymentId: input.checkoutId, locationId: 'mock', date: new Date().toISOString().slice(0, 10), amount,
        orderId: input.orderId, note: input.note, vatRate: input.vatRate, readerId: input.readerId, readerLabel: reader?.label,
        status: reader?.status === 'online' ? 'processing' : 'failed', attempt: 1,
        failure: reader?.status === 'online' ? undefined : { code: 'reader_offline' },
        simulated: reader?.simulated, createdAt: new Date().toISOString(),
      }
      return save(p)
    },
    get(id: string) {
      const p = find(id)
      return p ? delay({ ...p }) : Promise.reject(new ApiError(404, 'not found'))
    },
    act(id: string, action: Action) {
      const p = find(id)
      if (!p) return Promise.reject(new ApiError(404, 'not found'))
      if (action === 'cancel') return p.status === 'processing' ? save({ ...p, status: 'canceled' }) : fail('cannot_cancel')
      if (action === 'retry') {
        return p.status === 'failed' || p.status === 'canceled'
          ? save({ ...p, status: 'processing', failure: undefined, attempt: (p.attempt ?? 1) + 1 })
          : fail('cannot_retry')
      }
      if (p.orderId) return fail('refund_via_order')
      return p.status === 'succeeded'
        ? save({ ...p, status: 'refunded', refund: { amount: p.amount, at: new Date().toISOString() } })
        : fail('cannot_refund')
    },
    simulate(id: string, outcome: 'approve' | 'decline') {
      const p = find(id)
      if (!p || p.status !== 'processing') return fail('cannot_simulate')
      payments.set(id, outcome === 'approve'
        ? { ...p, status: 'succeeded', paidAt: new Date().toISOString(),
            card: { brand: 'visa', last4: '4242', readMethod: 'contactless_emv' } }
        : { ...p, status: 'failed', failure: { code: 'insufficient_funds' } })
      return delay({})
    },
    receipt(id: string) {
      const p = find(id)
      if (!p) return Promise.reject(new ApiError(404, 'not found'))
      const receipt: Receipt = {
        title: 'Kvitto', restaurant: 'Exempelrestaurangen', seller: { name: 'Exempel AB', org: '556000-0000', address: 'Götgatan 1, 118 21 Stockholm' },
        when: new Date(p.paidAt ?? p.createdAt ?? Date.now()).toLocaleString('sv-SE').slice(0, 16), reference: p.paymentId.slice(0, 12).toUpperCase(),
        note: p.note, lines: [], total: p.amount, vatOnRegister: !p.orderId && !p.vatRate,
        vat: p.vatRate ? [mockVat(p.amount, p.vatRate)] : [],
        card: [{ label: 'Kort', value: 'Visa **** 4242' }, { label: 'Läst', value: 'Kontaktlös' },
          { label: 'AID', value: 'A0000000031010' }, { label: 'Godkännandekod', value: '123456' }],
        result: 'Godkänd', refunded: p.refund?.amount ?? null,
      }
      return delay({ payment: { ...p }, receipt })
    },
  }
})()
