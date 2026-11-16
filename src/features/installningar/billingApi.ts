import { apiFetch, isApiConfigured } from '../../shared/api'
import type { TenantBilling } from '../../shared/tenant'

/** En öppen faktura från Booqy, med Stripes betalsida. */
export interface BooqyInvoice {
  number: string | null
  amountDueSek: number
  dueDate: string | null
  overdue: boolean
  collection: 'card' | 'invoice'
  url: string | null
  description: string | null
}

export interface BooqyBilling {
  billing: TenantBilling
  invoices: BooqyInvoice[]
}

/** Påhittade fakturor för lokal utveckling utan API (aldrig när API:t finns). */
const MOCK: BooqyBilling = {
  billing: {
    customer: true, hasCard: false, cardBrand: null, cardLast4: null,
    collection: 'invoice', preference: 'card', daysUntilDue: 10, pastDue: false,
  },
  invoices: [
    {
      number: 'DEMO-0001', amountDueSek: 1237.5, dueDate: '2026-12-11', overdue: false, collection: 'invoice',
      url: null, description: 'Booqy, 1 dec till 31 dec 2026, betalas i förskott',
    },
  ],
}

/** GET /tenant/billing (bara ägare): öppna fakturor från Booqy. */
export function getBooqyBilling(): Promise<BooqyBilling> {
  if (!isApiConfigured()) return Promise.resolve(MOCK)
  return apiFetch<BooqyBilling>('/tenant/billing')
}

/**
 * POST /tenant/billing/card-session (bara ägare): Stripes sida där ägaren
 * lägger till kortet som månadsavgiften dras från. 409 `no_billing_customer`
 * = Booqy har inte startat avtalet än.
 */
export function createCardSession(): Promise<{ url: string }> {
  if (!isApiConfigured()) return Promise.resolve({ url: '/installningar?kort=klart' })
  return apiFetch<{ url: string }>('/tenant/billing/card-session', { method: 'POST' })
}
