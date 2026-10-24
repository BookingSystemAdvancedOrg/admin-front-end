import { ApiError, API_BASE_URL, apiFetch, isApiConfigured } from '../../shared/api'
import { getAccessToken } from '../auth/cognito'
import { busyEnd, busyStart } from '../../shared/motion/busy'
import { listMenuItems } from '../meny/menuApi'
import type { MenuCategory } from '../meny/menuApi'
import { createPayment } from '../tabetalt/cardApi'
import type { CardPayment } from '../tabetalt/cardApi'

/**
 * Kassan (backend functions/kassa, shared/kassa.py i application). Notor
 * per bord eller avhämtning, kortbetalning på restaurangens kortläsare,
 * kvitto med kontrollkod, retur, en kopia, övningsläge, X- och Z-rapport
 * och export av journalen (XML). Kortbetalningen frågas om, avbryts och
 * försöks igen via Ta betalts API (tabetalt/cardApi).
 *
 * Utan API (VITE_API_BASE_URL saknas) körs en enkel kassa i minnet.
 */

export type BillKind = 'table' | 'takeaway'
export type Delivery = 'print' | 'email' | 'screen'

export interface DocRow {
  text?: string
  pair?: [string, string]
  rule?: boolean
  bold?: boolean
  big?: boolean
  center?: boolean
}

export interface KassaDocument {
  kind: string
  title: string
  seq?: number
  total?: number
  rows: DocRow[]
}

export interface Register {
  registerId: string
  label: string
  serialNumber: string
  receiptSeq: number
  zSeq: number
  training?: boolean
  float?: number
  dayOpen?: string
  lastZAt?: string
  lastZDay?: string
  model: string
  program: string
  version: string
  today: string
  controlSystem: { ok: boolean; code: string; provider: string; serial: string; simulated: boolean }
  simulateDown?: boolean
}

export interface BillSummary {
  billId: string
  registerId: string
  kind: BillKind
  tableLabel?: string
  training: boolean
  lines: number
  total: number
  createdAt?: string
}

export interface BillLine {
  lineId: string
  menuItemId: string
  name: string
  category?: MenuCategory
  unitPrice: number
  quantity: number
  vatRate: number
  note?: string
  sent?: boolean
  gross: number
  discount: number
  total: number
  vat: number
}

export interface Discount {
  kind: 'percent' | 'amount'
  value: number
  label: string
}

export interface Bill {
  billId: string
  registerId: string
  kind: BillKind
  tableLabel?: string
  status: 'open' | 'closed' | 'void'
  training?: boolean
  version: number
  receiptSeq?: number
  discount?: Discount
  lines: BillLine[]
  gross: number
  discountAmount: number
  total: number
  vat: { rate: number; gross: number; net: number; vat: number }[]
  paid: number
  remaining: number
  payments: CardPayment[]
  locked: boolean
}

export interface KassaState {
  testMode: boolean
  testNotice: string
  registers: Register[]
  openBills: BillSummary[]
  printer: boolean
  cardReaders: boolean
  isOwner: boolean
  simulator: boolean
  canSimulate: boolean
}

export interface DayStatus {
  unclosedDays: string[]
  salesSinceZ: boolean
  dayOpen: boolean
}

export interface JournalItem {
  jseq: number
  kind: string
  title: string
  seq?: number
  total?: number
  at: string
}

export interface ReceiptInfo {
  document: KassaDocument
  lines: { lineId: string; name: string; quantity: number; total: number }[]
  returned: Record<string, { quantity: number; amount: number }>
  copyTaken: boolean
}

export interface Done {
  document: KassaDocument
  problems: string[]
}

export interface MenuChoice {
  menuItemId: string
  name: string
  price: number
  category: MenuCategory
  alcohol?: boolean
}

/** En rad som skickas till servern: befintlig (lineId) eller ny (menuItemId). */
export interface LineInput {
  lineId?: string
  menuItemId?: string
  quantity: number
  note?: string | null
}

const base = (locationId: string) => `/locations/${encodeURIComponent(locationId)}/kassa`
const post = (body: object) => ({ method: 'POST', body: JSON.stringify(body) })

export const CATEGORY_LABEL: Record<MenuCategory, string> = {
  starters: 'Förrätter',
  mains: 'Varmrätter',
  desserts: 'Efterrätter',
  drinks: 'Drycker',
}

// --- API ------------------------------------------------------------------

export function getState(locationId: string): Promise<KassaState> {
  if (!isApiConfigured()) return mock.state()
  return apiFetch(base(locationId))
}

export async function getMenu(locationId: string): Promise<MenuChoice[]> {
  if (!isApiConfigured()) return mock.menu()
  const items = await listMenuItems(locationId)
  return items
    .filter((i) => i.active)
    .map((i) => ({ menuItemId: i.menuItemId, name: i.name, price: Math.round(i.price * 100), category: i.category, alcohol: i.alcohol }))
}

export function createRegister(locationId: string, label: string): Promise<{ register: Register }> {
  if (!isApiConfigured()) return mock.createRegister(label)
  return apiFetch(`${base(locationId)}/registers`, post({ label }))
}

export function getRegister(locationId: string, registerId: string): Promise<{ register: Register; day: DayStatus }> {
  if (!isApiConfigured()) return mock.register(registerId)
  return apiFetch(`${base(locationId)}/registers/${registerId}`)
}

export function registerAction(
  locationId: string,
  registerId: string,
  action: 'open-day' | 'training' | 'simulate',
  body: object,
): Promise<{ register: Register }> {
  if (!isApiConfigured()) return mock.registerAction(registerId, action, body)
  return apiFetch(`${base(locationId)}/registers/${registerId}/${action}`, post(body))
}

export function report(locationId: string, registerId: string, kind: 'x' | 'z', print: boolean): Promise<Done> {
  if (!isApiConfigured()) return mock.report(kind)
  return apiFetch(`${base(locationId)}/registers/${registerId}/${kind}`, post({ print }))
}

export function listJournal(locationId: string, registerId: string, date?: string): Promise<{ date: string; entries: JournalItem[] }> {
  if (!isApiConfigured()) return mock.journal()
  return apiFetch(`${base(locationId)}/registers/${registerId}/receipts${date ? `?date=${date}` : ''}`)
}

export function getReceipt(locationId: string, registerId: string, seq: number): Promise<ReceiptInfo> {
  if (!isApiConfigured()) return mock.receipt(seq)
  return apiFetch(`${base(locationId)}/registers/${registerId}/receipts/${seq}`)
}

export function copyReceipt(locationId: string, registerId: string, seq: number, delivery: Delivery, email?: string): Promise<Done> {
  if (!isApiConfigured()) return mock.copy(seq)
  return apiFetch(`${base(locationId)}/registers/${registerId}/receipts/${seq}/copy`, post({ delivery, email }))
}

export function returnReceipt(
  locationId: string,
  registerId: string,
  seq: number,
  input: { lines: { lineId: string; quantity: number }[]; reason: string; delivery: Delivery; email?: string },
): Promise<Done> {
  if (!isApiConfigured()) return mock.returnReceipt(seq, input.lines)
  return apiFetch(`${base(locationId)}/registers/${registerId}/receipts/${seq}/return`, post(input))
}

export function createBill(locationId: string, registerId: string, kind: BillKind, tableLabel?: string): Promise<Bill> {
  if (!isApiConfigured()) return mock.createBill(registerId, kind, tableLabel)
  return apiFetch(`${base(locationId)}/bills`, post({ registerId, kind, tableLabel }))
}

export function getBill(locationId: string, billId: string): Promise<Bill> {
  if (!isApiConfigured()) return mock.bill(billId)
  return apiFetch(`${base(locationId)}/bills/${billId}`)
}

export function updateBill(
  locationId: string,
  billId: string,
  input: { version: number; lines: LineInput[]; discount: Discount | null },
): Promise<Bill> {
  if (!isApiConfigured()) return mock.updateBill(billId, input)
  return apiFetch(`${base(locationId)}/bills/${billId}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function billAction(locationId: string, billId: string, action: 'send' | 'void'): Promise<Bill | { status: string }> {
  if (!isApiConfigured()) return mock.billAction(billId, action)
  return apiFetch(`${base(locationId)}/bills/${billId}/${action}`, post({}))
}

export function startPayment(
  locationId: string,
  billId: string,
  input: { checkoutId: string; readerId: string; amount: number },
): Promise<CardPayment> {
  if (!isApiConfigured()) return mock.startPayment(locationId, billId, input)
  return apiFetch(`${base(locationId)}/bills/${billId}/payments`, post(input))
}

export function undoPayment(locationId: string, billId: string, paymentId: string): Promise<CardPayment> {
  if (!isApiConfigured()) return Promise.reject(new ApiError(409, 'not_in_demo'))
  return apiFetch(`${base(locationId)}/bills/${billId}/payments/${paymentId}/undo`, post({}))
}

export function finalize(locationId: string, billId: string, delivery: Delivery, email?: string): Promise<Done> {
  if (!isApiConfigured()) return mock.finalize(billId, delivery)
  return apiFetch(`${base(locationId)}/bills/${billId}/finalize`, post({ delivery, email }))
}

/** Journalen som XML-fil (SKVFS 2021:16); bara ägaren. */
export async function downloadExport(locationId: string, registerId: string, from: string, to: string): Promise<{ name: string; blob: Blob }> {
  if (!API_BASE_URL) {
    return { name: `journal-${from}-${to}.xml`, blob: new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n<demo/>'], { type: 'application/xml' }) }
  }
  const token = await getAccessToken()
  busyStart()
  try {
    const res = await fetch(`${API_BASE_URL}${base(locationId)}/registers/${registerId}/export?from=${from}&to=${to}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let code = text
      try {
        code = (JSON.parse(text) as { error?: string }).error ?? text
      } catch {
        // inte JSON
      }
      throw new ApiError(res.status, code)
    }
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `journal-${from}-${to}.xml`
    return { name, blob: await res.blob() }
  } finally {
    busyEnd()
  }
}

// --- räkna som servern ----------------------------------------------------

/** Notans summa före servern svarat: samma rabattregel som shared/kassa.py. */
export function localTotals(lines: { unitPrice: number; quantity: number }[], discount: Discount | null) {
  const gross = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
  let off = 0
  if (discount && gross) {
    off = discount.kind === 'percent' ? Math.round((gross * discount.value) / 100) : Math.min(discount.value, gross)
  }
  return { gross, discount: off, total: gross - off }
}

/** "1 234,50" (alltid två decimaler i kassan). */
export function kr(ore: number): string {
  const sign = ore < 0 ? '-' : ''
  const [whole, frac] = (Math.abs(ore) / 100).toFixed(2).split('.')
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${frac}`
}

// --- texter ----------------------------------------------------------------

const ERRORS: Record<string, string> = {
  control_system_unreachable: 'Kontrollsystemet svarar inte. Kvitto kan inte skapas just nu. Försök igen om en stund.',
  not_fully_paid: 'Notan är inte fullt betald än.',
  payment_in_progress: 'En kortbetalning pågår. Vänta tills den är klar.',
  bill_has_payments: 'Notan har en kortbetalning och kan inte ändras.',
  bill_closed: 'Notan är redan stängd.',
  bill_empty: 'Notan är tom.',
  changed_retry: 'Notan ändrades på en annan enhet. Visar den senaste.',
  line_sent: 'Raden är redan skickad till köket. Ta bort den och lägg till en ny i stället.',
  menu_item_unavailable: 'Rätten finns inte på menyn längre.',
  alcohol_not_for_takeaway: 'Alkohol kan inte säljas till avhämtning.',
  amount_too_large: 'Beloppet är större än det som är kvar att betala.',
  training_no_payment: 'I övningsläge tas ingen betalning.',
  no_printer: 'Ingen skrivare är kopplad. Koppla en under Inställningar eller mejla kvittot.',
  nothing_to_send: 'Allt är redan skickat till köket.',
  receipt_must_be_printed: 'Kvittot måste skrivas ut eller mejlas.',
  org_number_missing: 'Organisationsnummer saknas. Kontakta Booqy support så läggs det in.',
  address_missing: 'Platsen saknar adress. Lägg till den under Inställningar.',
  copy_exists: 'Det här kvittot har redan en kopia. Det får bara finnas en.',
  return_too_large: 'Det går inte att returnera fler än som såldes.',
  nothing_to_refund: 'Det finns inget kvar att återbetala på kvittot.',
  register_busy: 'Kassan är upptagen en sekund. Försök igen.',
  register_limit: 'Platsen har redan fem kassor.',
  label_taken: 'Det finns redan en kassa med det namnet.',
  terminal_not_enabled: 'Kortläsare är inte aktiverade för den här platsen ännu.',
  feature_not_in_plan: 'Kassan ingår inte i restaurangens plan ännu.',
  owner_only: 'Bara ägaren kan göra det.',
  nothing_to_export: 'Det finns inga registreringar under perioden.',
  payment_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund.',
  stripe_refused: 'Stripe tog inte emot betalningen. Försök igen.',
  refund_too_large: 'Återbetalningen är större än betalningen.',
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (ERRORS[err.message]) return ERRORS[err.message]
    if (err.status === 404) return 'Hittades inte. Uppdatera sidan.'
    if (err.status === 400) return 'Kontrollera uppgifterna och försök igen.'
  }
  return 'Något gick fel. Kontrollera notan innan du försöker igen.'
}

export const PROBLEMS: Record<string, string> = {
  print_failed: 'Kvittot är sparat men kunde inte skickas till skrivaren. Skriv ut en kopia under Kvitton.',
  email_failed: 'Kvittot är sparat men mejlet kunde inte skickas. Skriv ut en kopia under Kvitton.',
  kitchen_print_failed: 'Köksnotan kunde inte skickas till skrivaren.',
  no_printer: 'Ingen skrivare är kopplad, rapporten skrevs inte ut.',
}

// --- kassa i minnet utan API ------------------------------------------------

const mock = (() => {
  const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), 120))
  const fail = (code: string) => Promise.reject(new ApiError(409, code))
  const today = new Date().toISOString().slice(0, 10)
  const menu: MenuChoice[] = [
    { menuItemId: 'm1', name: 'Toast Skagen', price: 14500, category: 'starters' },
    { menuItemId: 'm2', name: 'Dagens soppa', price: 8950, category: 'starters' },
    { menuItemId: 'm3', name: 'Pasta carbonara', price: 14900, category: 'mains' },
    { menuItemId: 'm4', name: 'Köttbullar med potatismos', price: 16500, category: 'mains' },
    { menuItemId: 'm5', name: 'Halstrad lax, dillsås', price: 21500, category: 'mains' },
    { menuItemId: 'm6', name: 'Vegetarisk risotto', price: 15900, category: 'mains' },
    { menuItemId: 'm7', name: 'Chokladfondant', price: 9500, category: 'desserts' },
    { menuItemId: 'm8', name: 'Kaffe', price: 3500, category: 'drinks' },
    { menuItemId: 'm9', name: 'Husets rött, glas', price: 9500, category: 'drinks', alcohol: true },
    { menuItemId: 'm10', name: 'Lättöl', price: 4500, category: 'drinks' },
  ]
  const registers: Register[] = []
  const bills = new Map<string, Bill & { _payments: string[] }>()
  const receipts: { seq: number; bill: Bill; doc: KassaDocument; copy: boolean }[] = []
  let ids = 0
  const id = () => `${(++ids).toString(16).padStart(8, '0')}${'0'.repeat(24)}`

  function priced(b: Bill & { _payments: string[] }): Bill & { _payments: string[] } {
    const t = localTotals(b.lines, b.discount ?? null)
    let left = t.discount
    const lines = b.lines.map((l, i) => {
      const gross = l.unitPrice * l.quantity
      const share = i === b.lines.length - 1 ? left : Math.round((t.discount * gross) / (t.gross || 1))
      left -= share
      const total = gross - share
      return { ...l, gross, discount: share, total, vat: Math.round((total * l.vatRate) / (100 + l.vatRate)) }
    })
    const rates = [...new Set(lines.map((l) => l.vatRate))].sort()
    const vat = rates.map((rate) => {
      const gross = lines.filter((l) => l.vatRate === rate).reduce((s, l) => s + l.total, 0)
      const v = Math.round((gross * rate) / (100 + rate))
      return { rate, gross, net: gross - v, vat: v }
    })
    return { ...b, lines, gross: t.gross, discountAmount: t.discount, total: t.total, vat, remaining: t.total - b.paid }
  }

  function doc(title: string, b: Bill, seq: number): KassaDocument {
    const rows: DocRow[] = [
      { text: 'Testläge - inte ett certifierat kassaregister än', bold: true, center: true },
      { text: 'Exempelrestaurangen', bold: true, center: true },
      { text: 'Org.nr 556677-8899', center: true },
      { text: 'Götgatan 1, Stockholm', center: true },
      { rule: true },
      { pair: [title, `Nr ${seq}`], bold: true },
      { pair: ['Datum', new Date().toLocaleString('sv-SE').slice(0, 16)] },
      { pair: ['Kassa', registers[0]?.label ?? 'Kassa 1'] },
      { rule: true },
      ...b.lines.map((l) => ({ pair: [`${l.quantity} x ${l.name}`, kr(l.gross)] as [string, string] })),
      { rule: true },
      { pair: ['Totalt', kr(b.total)], bold: true, big: true },
      ...b.vat.map((v) => ({ pair: [`Moms ${v.rate} % (netto ${kr(v.net)})`, kr(v.vat)] as [string, string] })),
      { rule: true },
      { pair: ['Betalt, Kort Visa **** 4242', kr(b.total)] },
      { rule: true },
      { text: 'Kontrollkod:' },
      { text: '9F3A1C77E0B2D4A6C8E19F3A1C77E0B2D4A6C8E19F3A1C77E0B2D4A6C8E' },
      { text: 'Kontrollsystem: BOOQYSIMULATOR001' },
      { text: 'Tack för besöket!', center: true },
    ]
    return { kind: 'kassakvitto', title, seq, total: b.total, rows }
  }

  return {
    menu: () => delay(menu),
    state: (): Promise<KassaState> => delay({
      testMode: true, testNotice: 'Testläge - inte ett certifierat kassaregister än', registers,
      openBills: [...bills.values()].filter((b) => b.status === 'open').map((b) => ({
        billId: b.billId, registerId: b.registerId, kind: b.kind, tableLabel: b.tableLabel, training: Boolean(b.training),
        lines: b.lines.reduce((s, l) => s + l.quantity, 0), total: b.total,
      })),
      printer: true, cardReaders: true, isOwner: true, simulator: true, canSimulate: true,
    }),
    createRegister(label: string) {
      const r: Register = {
        registerId: id(), label, serialNumber: 'BQ1A2B3C4D5E6F7A8', receiptSeq: 0, zSeq: 0, training: false, float: 0,
        model: 'Booqy Kassa SE', program: 'Booqy Kassa', version: '1.0.0+demo', today,
        controlSystem: { ok: true, code: 'STATUS_OK', provider: 'simulator', serial: 'BOOQYSIMULATOR001', simulated: true },
      }
      registers.push(r)
      return delay({ register: r })
    },
    register(registerId: string) {
      const r = registers.find((x) => x.registerId === registerId)
      return r ? delay({ register: r, day: { unclosedDays: [], salesSinceZ: receipts.length > 0, dayOpen: r.dayOpen === today } })
        : Promise.reject(new ApiError(404, 'not found'))
    },
    registerAction(registerId: string, action: string, body: object) {
      const r = registers.find((x) => x.registerId === registerId)
      if (!r) return Promise.reject(new ApiError(404, 'not found'))
      const b = body as { float?: number; on?: boolean; down?: boolean }
      if (action === 'open-day') Object.assign(r, { float: b.float, dayOpen: today })
      if (action === 'training') r.training = Boolean(b.on)
      if (action === 'simulate') {
        r.simulateDown = Boolean(b.down)
        r.controlSystem = { ...r.controlSystem, ok: !b.down, code: b.down ? 'EJ_KONTAKT_MED_KS' : 'STATUS_OK' }
      }
      return delay({ register: r })
    },
    report(kind: 'x' | 'z') {
      const total = receipts.reduce((s, r) => s + r.bill.total, 0)
      if (kind === 'z' && registers[0]) registers[0].zSeq += 1
      const rows: DocRow[] = [
        { text: kind === 'z' ? 'Z-dagrapport' : 'X-dagrapport', bold: true, big: true, center: true },
        { text: 'Exempel AB', bold: true, center: true }, { rule: true },
        { pair: ['Total försäljning', kr(total)], bold: true }, { pair: ['Kassakvitton, antal', String(receipts.length)] },
        { pair: ['Grand total netto', kr(total)], bold: true },
      ]
      return delay({ document: { kind, title: kind === 'z' ? 'Z-dagrapport' : 'X-dagrapport', rows }, problems: [] })
    },
    journal: () => delay({
      date: today,
      entries: receipts.map((r) => ({ jseq: r.seq, kind: 'kassakvitto', title: 'Kvitto', seq: r.seq, total: r.bill.total,
        at: new Date().toISOString().slice(0, 19) })).reverse(),
    }),
    receipt(seq: number) {
      const r = receipts.find((x) => x.seq === seq)
      if (!r) return Promise.reject(new ApiError(404, 'not found'))
      return delay({ document: r.doc, lines: r.bill.lines.map((l) => ({ lineId: l.lineId, name: l.name, quantity: l.quantity, total: l.total })),
        returned: {}, copyTaken: r.copy })
    },
    copy(seq: number) {
      const r = receipts.find((x) => x.seq === seq)
      if (!r) return Promise.reject(new ApiError(404, 'not found'))
      if (r.copy) return fail('copy_exists')
      r.copy = true
      return delay({ document: { ...r.doc, title: 'Kopia av kvitto', rows: [{ text: 'KOPIA', big: true, bold: true, center: true }, ...r.doc.rows] }, problems: [] })
    },
    returnReceipt(seq: number, lines: { lineId: string; quantity: number }[]) {
      const r = receipts.find((x) => x.seq === seq)
      if (!r) return Promise.reject(new ApiError(404, 'not found'))
      const total = lines.reduce((s, x) => s + (r.bill.lines.find((l) => l.lineId === x.lineId)?.unitPrice ?? 0) * x.quantity, 0)
      const next = receipts.length + 1
      const rows: DocRow[] = [{ pair: ['Returkvitto', `Nr ${next}`], bold: true }, { pair: ['Totalt', kr(-total)], bold: true, big: true }]
      return delay<Done>({ document: { kind: 'returkvitto', title: 'Returkvitto', seq: next, total: -total, rows }, problems: [] })
    },
    createBill(registerId: string, kind: BillKind, tableLabel?: string) {
      const b = priced({ billId: id(), registerId, kind, tableLabel, status: 'open', version: 1, lines: [], gross: 0, discountAmount: 0,
        total: 0, vat: [], paid: 0, remaining: 0, payments: [], locked: false, _payments: [],
        training: Boolean(registers.find((r) => r.registerId === registerId)?.training) })
      bills.set(b.billId, b)
      return delay(b)
    },
    bill(billId: string) {
      const b = bills.get(billId)
      return b ? delay(b) : Promise.reject(new ApiError(404, 'not found'))
    },
    updateBill(billId: string, input: { version: number; lines: LineInput[]; discount: Discount | null }) {
      const b = bills.get(billId)
      if (!b) return Promise.reject(new ApiError(404, 'not found'))
      if (b.version !== input.version) return fail('changed_retry')
      const lines = input.lines.map((l) => {
        const old = b.lines.find((x) => x.lineId === l.lineId)
        if (old) return { ...old, quantity: l.quantity, note: l.note ?? undefined }
        const m = menu.find((x) => x.menuItemId === l.menuItemId)!
        if (m.alcohol && b.kind === 'takeaway') throw new ApiError(409, 'alcohol_not_for_takeaway')
        return { lineId: id().slice(0, 8), menuItemId: m.menuItemId, name: m.name, category: m.category, unitPrice: m.price, quantity: l.quantity,
          note: l.note ?? undefined, vatRate: m.alcohol ? 25 : b.kind === 'table' ? 12 : 6, sent: false, gross: 0, discount: 0, total: 0, vat: 0 }
      })
      const next = priced({ ...b, lines, discount: input.discount ?? undefined, version: b.version + 1 })
      bills.set(billId, next)
      return delay(next)
    },
    billAction(billId: string, action: 'send' | 'void') {
      const b = bills.get(billId)
      if (!b) return Promise.reject(new ApiError(404, 'not found'))
      if (action === 'void') {
        bills.set(billId, { ...b, status: 'void' })
        return delay({ status: 'void' })
      }
      const next = { ...b, version: b.version + 1, lines: b.lines.map((l) => ({ ...l, sent: true })) }
      bills.set(billId, next)
      return delay(next)
    },
    async startPayment(locationId: string, billId: string, input: { checkoutId: string; readerId: string; amount: number }) {
      const b = bills.get(billId)
      if (!b) return Promise.reject(new ApiError(404, 'not found'))
      if (registers.find((r) => r.registerId === b.registerId)?.simulateDown) {
        return Promise.reject(new ApiError(503, 'control_system_unreachable'))
      }
      const payment = await createPayment(locationId, { ...input, note: 'Kassa' })
      b._payments.push(payment.paymentId)
      return payment
    },
    finalize(billId: string, delivery: Delivery) {
      const b = bills.get(billId)
      if (!b) return Promise.reject(new ApiError(404, 'not found'))
      if (registers.find((r) => r.registerId === b.registerId)?.simulateDown) {
        return Promise.reject(new ApiError(503, 'control_system_unreachable'))
      }
      const seq = receipts.length + 1
      const title = b.training ? 'Övningskvitto' : 'Kvitto'
      const d = doc(title, b, seq)
      if (delivery === 'email') d.rows.splice(-1, 0, { text: 'Elektroniskt kassakvitto', bold: true })
      receipts.push({ seq, bill: b, doc: d, copy: false })
      bills.set(billId, { ...b, status: 'closed', receiptSeq: seq })
      if (registers[0]) registers[0].receiptSeq = seq
      return delay({ document: d, problems: [] })
    },
    /** Kortbetalningen räknas in när läsaren godkänt (tabetalt-mocken). */
    paid(billId: string, payment: CardPayment) {
      const b = bills.get(billId)
      if (!b) return
      const payments = [...b.payments.filter((p) => p.paymentId !== payment.paymentId), payment]
      const paid = payments.filter((p) => p.status === 'succeeded').reduce((s, p) => s + p.amount, 0)
      bills.set(billId, { ...b, payments, paid, remaining: b.total - paid, locked: payments.some((p) => p.status === 'processing' || p.status === 'succeeded') })
    },
  }
})()

/** Utan API: läsarens svar förs in på notan (servern läser kortposten själv). */
export function mockPaymentSettled(billId: string, payment: CardPayment): void {
  if (!isApiConfigured()) mock.paid(billId, payment)
}
