import { ApiError, apiFetch, DATA_CHANGED_EVENT, isApiConfigured } from '../../../shared/api'
import { describeError, rememberError } from '../../../shared/errors'
import { withBusy } from '../../../shared/motion/busy'
import { tablesFromLayout, tableTitle } from '../../../shared/tables'
import { toFloors } from '../../layout-editor/layoutApi'
import type { LayoutElement } from '../../layout-editor/layoutApi'
import type { Floor } from '../../layout-editor/data'
import {
  mockAdd,
  mockClose,
  mockClosed,
  mockEdit,
  mockGetFloors,
  mockGetMenu,
  mockGetTab,
  mockList,
  mockMove,
  mockOpen,
  mockRedispatch,
  mockReopen,
  mockSend,
  mockVoid,
} from './tableOrderMock'
import type { Course, HeldEdit, NewItem, SendResult, Tab, TabMenu, TabsResponse, VoidReason } from './types'

export { mockSentRounds } from './tableOrderMock'

/**
 * Table orders (backend table-order, docs/TABLE_ORDERS.md in application).
 * Staff take the order at the table; food goes to the kitchen and drinks to
 * the bar as tickets. Booqy never takes payment: the guest pays in the
 * restaurant's own POS and staff close the tab ("Betald i kassan, stäng").
 * Every write carries a requestId so a retry never makes a second ticket.
 * Without VITE_API_BASE_URL every function runs on the in-memory mock.
 */

/** Bord view, table picker and an open tab poll this often while visible. */
export const TAB_POLL_MS = 5000

/**
 * Klar on Köksskärm lives with the tickets and does not move the list's
 * version, so while any open tab waits on the kitchen or bar the poll loads
 * the whole list (no version) about this often.
 */
export const TICKET_POLL_MS = 15000

/** True while a sent ticket is not yet Klar (or cancelled). */
export function waitsOnTickets(tabs: Tab[] | undefined): boolean {
  return (tabs ?? []).some((t) =>
    t.rounds.some((r) => (r.tickets ?? []).some((k) => k.status === 'sent' || k.status === 'preparing')),
  )
}

/** The version to poll with: none (a full load) when ticket states may have moved. */
export function pollVersion(
  version: number | undefined,
  tabs: Tab[] | undefined,
  lastFullAt: number,
  now = Date.now(),
): number | undefined {
  if (version === undefined) return undefined
  return waitsOnTickets(tabs) && now - lastFullAt >= TICKET_POLL_MS ? undefined : version
}

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/table-orders`
}

function tabPath(locationId: string, tabId: string, rest = ''): string {
  return `${base(locationId)}/${encodeURIComponent(tabId)}${rest}`
}

/** Mock writes behave like apiFetch writes: busy bar, then pages refetch. */
async function mockWrite<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    const out = await withBusy(run)
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { path } }))
    return out
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { path, conflict: true } }))
    }
    throw err
  }
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export function listTabs(
  locationId: string,
  sinceVersion?: number,
): Promise<TabsResponse | { unchanged: true; version: number }> {
  if (!isApiConfigured()) return mockList(sinceVersion)
  const q = sinceVersion !== undefined ? `?version=${sinceVersion}` : ''
  return apiFetch(`${base(locationId)}${q}`)
}

export function getTab(locationId: string, tabId: string): Promise<Tab> {
  if (!isApiConfigured()) return mockGetTab(tabId)
  return apiFetch<{ tab: Tab }>(tabPath(locationId, tabId)).then((r) => r.tab)
}

export function getTabMenu(locationId: string): Promise<TabMenu> {
  if (!isApiConfigured()) return mockGetMenu()
  return apiFetch(`${base(locationId)}/menu`)
}

export function listClosed(locationId: string, date?: string): Promise<Tab[]> {
  if (!isApiConfigured()) return mockClosed()
  const q = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiFetch<{ tabs: Tab[] }>(`${base(locationId)}/closed${q}`).then((r) => r.tabs)
}

export function openTab(
  locationId: string,
  body: { requestId: string; tableId: string; covers?: number; guestName?: string; reservationId?: string; note?: string; items: NewItem[] },
): Promise<SendResult> {
  if (!isApiConfigured()) return mockWrite(base(locationId), () => mockOpen(body))
  return post(base(locationId), body)
}

export function addItems(locationId: string, tabId: string, body: { requestId: string; items: NewItem[] }): Promise<SendResult> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockAdd(tabId, body))
  return post(tabPath(locationId, tabId, '/items'), body)
}

export function sendHeld(
  locationId: string,
  tabId: string,
  body: { requestId: string; courses?: Course[]; itemIds?: string[] },
): Promise<SendResult> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockSend(tabId, body))
  return post(tabPath(locationId, tabId, '/send'), body)
}

export function editTab(
  locationId: string,
  tabId: string,
  body: { requestId: string; expectedVersion: number; covers?: number; guestName?: string; note?: string; items?: HeldEdit[] },
): Promise<Tab> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockEdit(tabId, body))
  return apiFetch<{ tab: Tab }>(tabPath(locationId, tabId), { method: 'PATCH', body: JSON.stringify(body) }).then((r) => r.tab)
}

export function voidItems(
  locationId: string,
  tabId: string,
  body: { requestId: string; expectedVersion: number; items: { itemId: string; quantity: number }[]; reason: VoidReason; note?: string },
): Promise<SendResult> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockVoid(tabId, body))
  return post(tabPath(locationId, tabId, '/void'), body)
}

export function moveTab(
  locationId: string,
  tabId: string,
  body: { requestId: string; expectedVersion: number; tableId: string },
): Promise<SendResult> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockMove(tabId, body))
  return post(tabPath(locationId, tabId, '/move'), body)
}

export function closeTab(
  locationId: string,
  tabId: string,
  body: { requestId: string; expectedVersion: number; dropHeld?: boolean },
): Promise<Tab> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockClose(tabId, body))
  return post<{ tab: Tab }>(tabPath(locationId, tabId, '/close'), body).then((r) => r.tab)
}

export function reopenTab(locationId: string, tabId: string, body: { requestId: string }): Promise<Tab> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockReopen(tabId, body))
  return post<{ tab: Tab }>(tabPath(locationId, tabId, '/reopen'), body).then((r) => r.tab)
}

export function redispatchRound(locationId: string, tabId: string, round: number): Promise<SendResult> {
  if (!isApiConfigured()) return mockWrite(tabPath(locationId, tabId), () => mockRedispatch(tabId, round))
  return post(tabPath(locationId, tabId, `/rounds/${round}/dispatch`), {})
}

interface PublicLayout {
  floors: { floorId: string; name?: string; level: number }[]
  elements: (Omit<LayoutElement, 'updatedBy' | 'updatedAt'> & { label?: string })[]
}

/**
 * The published floor plan's geometry for the table map (same plan the
 * guests book against). Table ids match TableState.tableId; labels come
 * from TableState. [] when nothing is published.
 */
export async function getFloorPlan(locationId: string): Promise<Floor[]> {
  if (!isApiConfigured()) return mockGetFloors()
  let layout: PublicLayout
  try {
    layout = await apiFetch<PublicLayout>(`/locations/${encodeURIComponent(locationId)}/layout/active`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
  if (layout.floors.length === 0 && layout.elements.length === 0) return []
  const stamp = { updatedBy: '', updatedAt: '' }
  const elements: LayoutElement[] = [
    ...layout.floors.map((f) => ({
      elementId: f.floorId, type: 'floor' as const, name: f.name, level: f.level,
      x: 0, y: 0, z: 0, width: 0, height: 0, depth: 0, rotationY: 0, ...stamp,
    })),
    ...layout.elements.map((e) => ({ ...e, ...stamp })),
  ]
  const labels = new Map(tablesFromLayout(layout).map((t) => [t.tableId, t.label]))
  return toFloors(elements).map((floor) => ({
    ...floor,
    tables: floor.tables.map((t) => ({ ...t, label: labels.get(t.id) ?? t.label })),
  }))
}

/** 32 lowercase hex: a new id for every write the waiter starts (kept for retries). */
export function newRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').toLowerCase()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const PLAN_LINK = { to: '/layout', label: 'Öppna Planritning' }

/** Texts per code (spec 6), Swedish, saying who acts. */
const KNOWN: Record<string, string> = {
  invalid_request: 'Något i beställningen saknas. Kontrollera och försök igen.',
  not_found: 'Beställningen finns inte längre. Uppdatera sidan.',
  table_not_found: 'Bordet finns inte i planritningen längre. Välj ett annat bord.',
  no_tables: 'Det finns inga bord. Rita och publicera bord i Planritning.',
  menu_item_unavailable: 'En rätt går inte att beställa just nu. Ta bort den och skicka igen.',
  changed_retry: 'Någon annan ändrade beställningen. Se de senaste ändringarna och försök igen.',
  held_items: 'Det finns rätter som inte har skickats.',
  tab_closed: 'Beställningen är redan stängd.',
  reopen_expired: 'Det går bara att ångra inom 15 minuter.',
  tab_full: 'Beställningen är full. Stäng den och öppna en ny för bordet.',
  option_required: 'Välj tillval för rätten och skicka igen.',
  option_invalid: 'Välj tillval för rätten och skicka igen.',
}

function tabOf(err: unknown): Tab | undefined {
  const tab = err instanceof ApiError ? (err.details?.tab as Tab | undefined) : undefined
  return tab && typeof tab === 'object' && typeof tab.tabId === 'string' ? tab : undefined
}

/**
 * A table order error as text plus who acts: the restaurant (steps they
 * can take) or Booqy ("Booqys fel", ErrorNote shows Rapportera till Booqy).
 * `tab` is the fresh tab a 409 carries (open tab on the table, changed, held).
 */
export function tabErrorText(err: unknown): { text: string; who: 'restaurant' | 'booqy'; tab?: Tab } {
  const tab = tabOf(err)
  const code = err instanceof ApiError ? err.code : ''
  if (code === 'table_has_open_order') {
    const text = `${tab ? tableTitle(tab.tableLabel) : 'Bordet'} har redan en öppen beställning.`
    rememberError({ text, actor: 'user', code, status: 409 })
    return { text, who: 'restaurant', ...(tab ? { tab } : {}) }
  }
  if (code === 'internal' || code === 'internal_error') {
    const info = describeError(new ApiError(500, 'internal_error', { code: 'internal_error' }), 'Booqys fel.')
    rememberError(info)
    return { text: info.text, who: 'booqy', ...(tab ? { tab } : {}) }
  }
  const info = describeError(err, 'Det gick inte.', KNOWN)
  // Every code above is something the restaurant can act on ("menu_item_unavailable"
  // would otherwise count as a service being down).
  if (err instanceof ApiError && KNOWN[code] && err.status < 500) info.actor = 'user'
  if (code === 'no_tables') info.link = PLAN_LINK
  rememberError(info)
  return { text: info.text, who: info.actor === 'booqy' ? 'booqy' : 'restaurant', ...(tab ? { tab } : {}) }
}
