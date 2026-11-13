import { apiFetch } from '../../shared/api'

/** Presentkort (CONTRACTS.md 6.E). Översikten och inställningarna är ägarens; gästen löser in kortet när hen beställer online. */

export type CardStatus = 'active' | 'used' | 'expired' | 'void'
export interface Settings { enabled: boolean; amountsSek: number[]; customMinSek: number; customMaxSek: number; validityMonths: number; version: number }
export interface Card {
  cardId: string; last4: string; initialSek: number; balanceSek: number; balanceOre: number; status: CardStatus
  expiresAt: string; soldAtLocationId?: string; purchasedAt?: string
}
export interface Tx { txId: string; kind: string; amountOre: number; balanceAfterOre: number; channel: string; at: string }
export interface CardDetail extends Card {
  recipientName?: string; buyerEmail?: string; recipientEmail?: string; message?: string; transactions: Tx[]
}
export interface Listing { cards: Card[]; liabilitySek: number; liabilityOre: number; cursor: string | null }

const card = (id: string) => `/tenant/gift-cards/${encodeURIComponent(id)}`

export const getSettings = () => apiFetch<Settings>('/tenant/gift-cards/settings')
export const saveSettings = (s: Settings) => apiFetch<Settings>('/tenant/gift-cards/settings', { method: 'PUT', body: JSON.stringify(s) })
export const listCards = (status?: CardStatus, cursor?: string | null) => {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (cursor) q.set('cursor', cursor)
  const qs = q.toString()
  return apiFetch<Listing>(`/tenant/gift-cards${qs ? `?${qs}` : ''}`)
}
export const getCard = (id: string) => apiFetch<CardDetail>(card(id))
export const extendCard = (id: string, expiresAt: string, reason: string) =>
  apiFetch<Card>(`${card(id)}/adjust`, { method: 'POST', body: JSON.stringify({ txId: newTxId(), expiresAt, reason }) })
export const refundCard = (id: string, reason: string) =>
  apiFetch<Card>(`${card(id)}/refund`, { method: 'POST', body: JSON.stringify({ txId: newTxId(), reason }) })
export const resendCode = (id: string, to: 'buyer' | 'recipient') =>
  apiFetch<{ last4: string }>(`${card(id)}/resend`, { method: 'POST', body: JSON.stringify({ to }) })

export function newTxId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function kr(ore: number): string {
  return `${(ore / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} kr`
}

export const STATUS_LABEL: Record<CardStatus, string> = { active: 'Aktivt', used: 'Förbrukat', expired: 'Utgånget', void: 'Makulerat' }
export const KIND_LABEL: Record<string, string> = {
  issue: 'Köpt', redeem: 'Inlöst', reverse: 'Tillbaka på kortet', expire: 'Gick ut', adjust: 'Giltighet ändrad',
  refund: 'Återbetalt', void: 'Makulerat',
}

export const ERRORS: Record<string, string> = {
  insufficient_balance: 'Det finns inte så mycket kvar på presentkortet.',
  card_expired: 'Presentkortet har gått ut.',
  card_void: 'Presentkortet är makulerat.',
  refund_window_passed: 'Ångerfristen på 14 dagar har gått ut.',
  invalid_validity: 'Giltigheten ska vara 12-60 månader.',
  invalid_amount: 'Beloppen ska vara 100-5 000 kr.',
  // E10: koden är redan bytt men mejlet gick inte ut; ett nytt försök byter koden igen och skickar den.
  notification_unavailable: 'Mejlet kunde inte skickas just nu. Försök igen om en stund.',
}
