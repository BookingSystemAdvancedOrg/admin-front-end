import { ApiError } from '../../../shared/api'
import { defaultTableSize } from '../../layout-editor/data'
import type { Floor, TableElement, TableShape } from '../../layout-editor/data'
import type {
  Course,
  HeldEdit,
  MockRound,
  NewItem,
  RoundTicket,
  SendResult,
  SendWarning,
  Tab,
  TabItem,
  TableGuest,
  TableState,
  TabMenu,
  TabMenuItem,
  TabRound,
  TabsResponse,
  TicketStatus,
  VoidReason,
} from './types'

/**
 * In-memory table orders for local development without an API
 * (VITE_API_BASE_URL unset). Behaves like the table-order Lambda: versions,
 * requestId replay, one open tab per table, 409 codes with the fresh tab.
 * Kitchen tickets are simulated per round (sent, preparing after 2 min,
 * ready after 12 min). Fake data only: no real guests.
 */

const MIN = 60_000
const WAITER = 'Test'

interface MockTicket extends RoundTicket {
  /** seeded rounds keep their status; new rounds age (sent -> preparing -> ready) */
  fixed?: boolean
}

interface StoredRound extends Omit<TabRound, 'tickets'> {
  tickets: MockTicket[]
}

interface StoredTab extends Omit<Tab, 'rounds'> {
  rounds: StoredRound[]
  nextRound: number
}

type MockTab = StoredTab

interface Store {
  version: number
  tabs: Map<string, StoredTab>
  /** OPEN#<tableId> -> tabId */
  locks: Map<string, string>
  /** REQ#<requestId> -> the result of that request */
  requests: Map<string, unknown>
  seq: number
}

let store: Store | null = null

/* --- Static data ---------------------------------------------------------- */

const FLOOR_MAIN = 'mock-floor-1'
const FLOOR_OUT = 'mock-floor-2'

function table(id: number, x: number, y: number, seats: number, shape: TableShape = 'square'): TableElement {
  const size = defaultTableSize(shape, seats)
  // a little larger than the editor's default, so the demo map reads well on a phone
  const w = Math.round(size.w * 1.3)
  const h = Math.round(size.h * 1.3)
  return { id: `mock-t${id}`, label: String(id), shape, seats, zone: '', x, y, rotation: 0, w, h }
}

/** The floor plan geometry (what the published layout would hold). */
export function mockFloors(): Floor[] {
  return [
    {
      id: FLOOR_MAIN,
      name: 'Matsal',
      grounds: [{ id: 'g1', x: -420, y: -240, w: 840, h: 480 }],
      walls: [
        { id: 'w1', dir: 'h', x: -420, y: -240, length: 840 },
        { id: 'w2', dir: 'h', x: -420, y: 240, length: 840 },
        { id: 'w3', dir: 'v', x: -420, y: -240, length: 480 },
        { id: 'w4', dir: 'v', x: 420, y: -240, length: 480 },
      ],
      openings: [],
      tables: [
        table(1, -320, -150, 2),
        table(2, -180, -150, 2),
        table(3, -20, -150, 4),
        table(4, 150, -150, 4),
        table(5, 310, -150, 4, 'round'),
        table(6, -320, 20, 4, 'round'),
        table(7, -160, 20, 2),
        table(8, 10, 20, 4),
        table(9, 180, 20, 2, 'round'),
        table(10, 40, 160, 6),
      ],
    },
    {
      id: FLOOR_OUT,
      name: 'Uteservering',
      grounds: [{ id: 'g2', x: -300, y: -140, w: 600, h: 280 }],
      walls: [{ id: 'w5', dir: 'h', x: -300, y: -140, length: 600 }],
      openings: [],
      tables: [
        table(11, -200, -40, 2, 'round'),
        table(12, -60, -40, 2, 'round'),
        table(13, 80, -40, 4, 'round'),
        table(14, 210, 50, 4, 'round'),
      ],
    },
  ]
}

const KOK = { stationId: 'kok', name: 'Kök', kind: 'kok' as const, printers: 1 }
const BAR = { stationId: 'bar', name: 'Bar', kind: 'dryck' as const, printers: 0 }

function dish(
  menuItemId: string,
  name: string,
  kr: number,
  categoryId: string,
  course: Course,
  extra: Partial<TabMenuItem> = {},
): TabMenuItem {
  const station = course === 'drinks' ? BAR : KOK
  return {
    menuItemId,
    name,
    description: '',
    price: kr * 100,
    categoryId,
    alcohol: false,
    allergens: [],
    options: [],
    imageKey: null,
    course,
    stationId: station.stationId,
    stationName: station.name,
    ...extra,
  }
}

export function mockMenu(): TabMenu {
  return {
    categories: [
      { categoryId: 'starters', name: 'Förrätter', course: 'starters' },
      { categoryId: 'mains', name: 'Varmrätter', course: 'mains' },
      { categoryId: 'desserts', name: 'Efterrätter', course: 'desserts' },
      { categoryId: 'drinks', name: 'Drycker', course: 'drinks' },
      { categoryId: 'ol', name: 'Öl', course: 'drinks' },
      { categoryId: 'vin', name: 'Vin', course: 'drinks' },
    ],
    items: [
      dish('m-skagen', 'Toast Skagen', 165, 'starters', 'starters', { allergens: ['Skaldjur', 'Gluten', 'Ägg'] }),
      dish('m-lojrom', 'Löjromstoast', 195, 'starters', 'starters', { allergens: ['Fisk', 'Gluten', 'Mjölk'] }),
      dish('m-burrata', 'Burrata', 145, 'starters', 'starters', { allergens: ['Mjölk'] }),
      dish('m-oxfile', 'Oxfilé', 325, 'mains', 'mains', {
        options: [
          {
            name: 'Stekgrad',
            required: true,
            maxChoices: 1,
            choices: [
              { name: 'Rare', price: 0 },
              { name: 'Medium rare', price: 0 },
              { name: 'Medium', price: 0 },
              { name: 'Välstekt', price: 0 },
            ],
          },
          { name: 'Tillbehör', required: false, maxChoices: 1, choices: [{ name: 'Extra pommes', price: 4500 }] },
        ],
        allergens: ['Mjölk'],
      }),
      dish('m-torsk', 'Torskrygg', 285, 'mains', 'mains', { allergens: ['Fisk', 'Mjölk'] }),
      dish('m-risotto', 'Svamprisotto', 235, 'mains', 'mains', { allergens: ['Mjölk'] }),
      dish('m-brulee', 'Crème brûlée', 115, 'desserts', 'desserts', { allergens: ['Mjölk', 'Ägg'] }),
      dish('m-fondant', 'Chokladfondant', 125, 'desserts', 'desserts', { allergens: ['Mjölk', 'Ägg', 'Gluten'] }),
      dish('m-vatten', 'Mineralvatten', 45, 'drinks', 'drinks'),
      dish('m-cola', 'Cola', 45, 'drinks', 'drinks'),
      dish('m-pilsner', 'Pilsner', 79, 'ol', 'drinks', { alcohol: true, allergens: ['Gluten'] }),
      dish('m-ipa', 'IPA', 89, 'ol', 'drinks', { alcohol: true, allergens: ['Gluten'] }),
      dish('m-rott', 'Husets röda glas', 115, 'vin', 'drinks', { alcohol: true, allergens: ['Sulfiter'] }),
    ],
    stations: [KOK, BAR],
  }
}

function hhmm(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Today's bookings per table, relative to now so the demo always looks alive. */
function mockGuests(now: number): Map<string, TableGuest> {
  const g = (id: string, name: string, partySize: number, start: number, status: TableGuest['status'], upcoming?: boolean): TableGuest => ({
    reservationId: id,
    name,
    partySize,
    startTime: hhmm(start),
    endTime: hhmm(start + 120 * MIN),
    status,
    ...(upcoming ? { upcoming: true } : {}),
  })
  return new Map([
    ['mock-t3', g('mock-r1', 'Åsa Öberg', 4, now - 40 * MIN, 'arrived')],
    ['mock-t7', g('mock-r2', 'Erik Lind', 2, now + 45 * MIN, 'reserved', true)],
    ['mock-t10', g('mock-r3', 'Maja Holm', 6, now - 55 * MIN, 'arrived')],
    ['mock-t12', g('mock-r4', 'Omar Haddad', 2, now + 80 * MIN, 'reserved', true)],
  ])
}

function tablesWithFloors(): { table: TableElement; floor: Floor }[] {
  return mockFloors().flatMap((floor) => floor.tables.map((t) => ({ table: t, floor })))
}

/* --- Store ---------------------------------------------------------------- */

function hex(n: number, len: number): string {
  return n.toString(16).padStart(len, '0').slice(-len)
}

function nextId(s: Store, len: number): string {
  s.seq += 1
  return hex(s.seq, len)
}

function menuItem(id: string): TabMenuItem {
  return mockMenu().items.find((i) => i.menuItemId === id)!
}

function seedItem(s: Store, id: string, quantity: number, state: TabItem['state'], at: number, round?: number, options: TabItem['options'] = []): TabItem {
  const m = menuItem(id)
  const extra = options.reduce((n, o) => n + (m.options.find((g) => g.name === o.group)?.choices.find((c) => c.name === o.choice)?.price ?? 0), 0)
  return {
    itemId: `${nextId(s, 12)}`,
    menuItemId: id,
    name: m.name,
    unitPrice: m.price + extra,
    quantity,
    options,
    course: m.course,
    stationId: m.stationId,
    stationName: m.stationName,
    state,
    ...(round ? { round } : {}),
    addedAt: new Date(at).toISOString(),
    addedByName: WAITER,
  }
}

function seedRound(round: number, kind: TabRound['kind'], at: number, items: TabItem[], statuses: Record<string, TicketStatus>): StoredRound {
  return {
    round,
    kind,
    at: new Date(at).toISOString(),
    byName: WAITER,
    courses: [...new Set(items.map((i) => i.course))],
    itemIds: items.map((i) => i.itemId),
    dispatched: true,
    stations: stationsOf(items),
    tickets: stationsOf(items).map((st) => ({ stationId: st.stationId, stationName: st.stationName, status: statuses[st.stationId] ?? 'sent', fixed: true })),
  }
}

function seed(now: number): Store {
  const s: Store = { version: 1, tabs: new Map(), locks: new Map(), requests: new Map(), seq: 0x1000 }

  // Bord 3: Åsa, drinks and starters sent, mains held.
  {
    const at = now - 35 * MIN
    const tabId = `${'a'.repeat(26)}${nextId(s, 6)}`
    const sent = [
      seedItem(s, 'm-rott', 2, 'sent', at, 1),
      seedItem(s, 'm-vatten', 2, 'sent', at, 1),
      seedItem(s, 'm-skagen', 2, 'sent', at, 1),
      seedItem(s, 'm-burrata', 2, 'sent', at, 1),
    ]
    const held = [
      seedItem(s, 'm-oxfile', 2, 'held', at, undefined, [{ group: 'Stekgrad', choice: 'Medium rare' }]),
      seedItem(s, 'm-torsk', 2, 'held', at),
    ]
    const tab: StoredTab = baseTab(tabId, 'mock-t3', 4, 'Åsa Öberg', 'mock-r1', at)
    tab.items = [...sent, ...held]
    tab.rounds = [seedRound(1, 'order', at, sent, { kok: 'preparing', bar: 'ready' })]
    tab.nextRound = 2
    tab.referenceTotal = totalOf(tab.items)
    s.tabs.set(tabId, tab)
    s.locks.set('mock-t3', tabId)
  }

  // Bord 10: Maja, everything sent, starters ready, mains on the stove.
  {
    const at = now - 50 * MIN
    const tabId = `${'b'.repeat(26)}${nextId(s, 6)}`
    const first = [
      seedItem(s, 'm-pilsner', 4, 'sent', at, 1),
      seedItem(s, 'm-cola', 2, 'sent', at, 1),
      seedItem(s, 'm-lojrom', 3, 'sent', at, 1),
    ]
    const fireAt = now - 18 * MIN
    const mains = [
      seedItem(s, 'm-oxfile', 3, 'sent', at, 2, [{ group: 'Stekgrad', choice: 'Medium' }]),
      seedItem(s, 'm-risotto', 3, 'sent', at, 2),
    ]
    const tab: StoredTab = baseTab(tabId, 'mock-t10', 6, 'Maja Holm', 'mock-r3', at)
    tab.items = [...first, ...mains]
    tab.rounds = [
      seedRound(1, 'order', at, first, { kok: 'ready', bar: 'ready' }),
      { ...seedRound(2, 'fire', fireAt, mains, { kok: 'preparing' }), courses: ['mains'] },
    ]
    tab.nextRound = 3
    tab.referenceTotal = totalOf(tab.items)
    s.tabs.set(tabId, tab)
    s.locks.set('mock-t10', tabId)
  }
  return s
}

function baseTab(tabId: string, tableId: string, covers: number | null, guestName: string | null, reservationId: string | null, at: number): MockTab {
  const t = tablesWithFloors().find((x) => x.table.id === tableId)!
  return {
    tabId,
    status: 'open',
    tableId,
    tableLabel: t.table.label,
    floorName: t.floor.name,
    covers,
    guestName,
    reservationId,
    items: [],
    rounds: [],
    referenceTotal: 0,
    openedAt: new Date(at).toISOString(),
    openedByName: WAITER,
    version: 1,
    updatedAt: new Date(at).toISOString(),
    history: [{ action: 'open', at: new Date(at).toISOString(), byName: WAITER }],
    nextRound: 1,
  }
}

function db(): Store {
  if (!store) store = seed(Date.now())
  return store
}

/** Tests: start over with the seeded tabs. */
export function resetMockStore(): void {
  store = null
}

/* --- Helpers -------------------------------------------------------------- */

function totalOf(items: TabItem[]): number {
  return items.filter((i) => i.state !== 'void').reduce((n, i) => n + i.unitPrice * i.quantity, 0)
}

function stationsOf(items: TabItem[]): TabRound['stations'] {
  const seen = new Map<string, TabRound['stations'][number]>()
  for (const i of items) {
    if (!i.stationId || seen.has(i.stationId)) continue
    const st = mockMenu().stations.find((x) => x.stationId === i.stationId)
    const printers = st?.printers ?? 0
    seen.set(i.stationId, {
      stationId: i.stationId,
      stationName: i.stationName ?? st?.name ?? i.stationId,
      printers,
      // a station without a printer prints on the kitchen's printer (BAR heading)
      fallback: printers === 0,
    })
  }
  return [...seen.values()]
}

function ticketStatus(t: MockTicket, round: StoredRound, now: number): TicketStatus {
  if (t.fixed || t.status === 'cancelled') return t.status
  const age = now - Date.parse(round.at)
  return age >= 12 * MIN ? 'ready' : age >= 2 * MIN ? 'preparing' : 'sent'
}

function view(tab: StoredTab, now = Date.now()): Tab {
  const { nextRound: _next, ...copy } = structuredClone(tab)
  void _next
  return {
    ...copy,
    rounds: copy.rounds.map((r) => ({
      ...r,
      tickets: r.tickets.map((t) => ({ stationId: t.stationId, stationName: t.stationName, status: ticketStatus(t, r, now) })),
    })),
  }
}

function fail(status: number, code: string, message: string, tab?: StoredTab): never {
  throw new ApiError(status, code, {
    code,
    fromServer: true,
    details: { error: code, message, ...(tab ? { tab: view(tab) } : {}) },
  })
}

function tableTitle(label: string): string {
  return /^\d/.test(label) ? `Bord ${label}` : label
}

function getOpen(s: Store, tabId: string): MockTab {
  const tab = s.tabs.get(tabId) as MockTab | undefined
  if (!tab) fail(404, 'not_found', 'Beställningen finns inte längre. Uppdatera sidan.')
  return tab
}

function mustBeOpen(tab: StoredTab): void {
  if (tab.status !== 'open') fail(409, 'tab_closed', 'Beställningen är redan stängd.', tab)
}

function checkVersion(tab: StoredTab, expected: number): void {
  if (tab.version !== expected) {
    fail(409, 'changed_retry', 'Någon annan ändrade beställningen. Se de senaste ändringarna och försök igen.', tab)
  }
}

function replay<T extends object>(requestId: string, run: () => T): T {
  const s = db()
  if (!/^[0-9a-f]{32}$/.test(requestId)) fail(400, 'invalid_request', 'Något i beställningen saknas. Kontrollera och försök igen.')
  if (s.requests.has(requestId)) {
    const prev = s.requests.get(requestId) as T & { tab?: Tab }
    // the current tab, as the server answers a replay
    const tabId = prev.tab?.tabId ?? (prev as unknown as Tab).tabId
    const current = tabId ? s.tabs.get(tabId) : undefined
    if (current && 'tab' in prev) return { ...prev, tab: view(current), replayed: true }
    if (current) return { ...(view(current) as unknown as T), replayed: true }
    return prev
  }
  const result = run()
  s.requests.set(requestId, result)
  return result
}

function touch(s: Store, tab: StoredTab, action: string, now: number): void {
  tab.version += 1
  tab.updatedAt = new Date(now).toISOString()
  tab.referenceTotal = totalOf(tab.items)
  tab.history = [...(tab.history ?? []), { action, at: tab.updatedAt, byName: WAITER }].slice(-100)
  s.version += 1
}

function buildItems(s: Store, items: NewItem[], now: number, tab: StoredTab): TabItem[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    fail(400, 'invalid_request', 'Något i beställningen saknas. Kontrollera och försök igen.')
  }
  if (tab.items.length + items.length > 150) {
    fail(413, 'tab_full', 'Beställningen är full. Stäng den och öppna en ny för bordet.', tab)
  }
  const menu = mockMenu()
  return items.map((n) => {
    const m = menu.items.find((i) => i.menuItemId === n.menuItemId)
    if (!m) {
      throw new ApiError(409, 'menu_item_unavailable', {
        code: 'menu_item_unavailable',
        fromServer: true,
        details: { error: 'menu_item_unavailable', menuItemId: n.menuItemId, message: 'Rätten går inte att beställa just nu.' },
      })
    }
    if (!Number.isInteger(n.quantity) || n.quantity < 1 || n.quantity > 20) {
      fail(400, 'invalid_request', 'Något i beställningen saknas. Kontrollera och försök igen.')
    }
    for (const g of m.options) {
      if (g.required && !(n.options ?? []).some((o) => o.group === g.name)) {
        fail(400, 'option_required', `Välj tillval för ${m.name}.`)
      }
    }
    let extra = 0
    for (const o of n.options ?? []) {
      const c = m.options.find((g) => g.name === o.group)?.choices.find((x) => x.name === o.choice)
      if (!c) fail(400, 'option_invalid', `Välj tillval för ${m.name}.`)
      extra += c.price
    }
    return {
      itemId: nextId(s, 12),
      menuItemId: m.menuItemId,
      name: m.name,
      unitPrice: m.price + extra,
      quantity: n.quantity,
      options: n.options ?? [],
      ...(n.note ? { note: n.note.slice(0, 140) } : {}),
      ...(n.allergy ? { allergy: true } : {}),
      course: n.course ?? m.course,
      stationId: m.stationId,
      stationName: m.stationName,
      state: n.hold ? 'held' : 'sent',
      addedAt: new Date(now).toISOString(),
      addedByName: WAITER,
    }
  })
}

/** A new round for items that go out now; null when nothing does. */
function newRound(tab: MockTab, kind: TabRound['kind'], items: TabItem[], now: number): StoredRound | null {
  if (kind !== 'move' && items.length === 0) return null
  const round = tab.nextRound
  tab.nextRound += 1
  for (const i of items) if (kind === 'order' || kind === 'fire') i.round = round
  const stations = stationsOf(items)
  const r: StoredRound = {
    round,
    kind,
    at: new Date(now).toISOString(),
    byName: WAITER,
    courses: [...new Set(items.map((i) => i.course))],
    itemIds: items.map((i) => i.itemId),
    dispatched: true,
    stations,
    tickets: stations.map((st) => ({
      stationId: st.stationId,
      stationName: st.stationName,
      status: kind === 'void' ? 'cancelled' : 'sent',
    })),
  }
  tab.rounds.push(r)
  return r
}

function result(tab: StoredTab, round: StoredRound | null): SendResult {
  const warnings: SendWarning[] = []
  const v = view(tab)
  return { tab: v, round: round ? v.rounds.find((r) => r.round === round.round) ?? null : null, warnings }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const LATENCY = import.meta.env.MODE === 'test' ? 0 : 300

async function later<T>(run: () => T): Promise<T> {
  await wait(LATENCY)
  return run()
}

/* --- API ------------------------------------------------------------------ */

function tableStates(s: Store, now: number): TableState[] {
  const guests = mockGuests(now)
  return tablesWithFloors().map(({ table, floor }) => ({
    tableId: table.id,
    label: table.label,
    seats: table.seats,
    floorId: floor.id,
    floorName: floor.name,
    tabId: s.locks.get(table.id) ?? null,
    guest: guests.get(table.id) ?? null,
  }))
}

export function mockList(sinceVersion?: number): Promise<TabsResponse | { unchanged: true; version: number }> {
  return later(() => {
    const s = db()
    const now = Date.now()
    if (sinceVersion !== undefined && sinceVersion === s.version) return { unchanged: true as const, version: s.version }
    const all = [...s.tabs.values()]
    return {
      version: s.version,
      serverTime: new Date(now).toISOString(),
      tabs: all.filter((t) => t.status === 'open').sort((a, b) => a.openedAt.localeCompare(b.openedAt)).map((t) => view(t, now)),
      closedToday: all
        .filter((t) => t.status === 'closed' && t.closedAt && now - Date.parse(t.closedAt) < 12 * 60 * MIN)
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
        .slice(0, 30)
        .map((t) => view(t, now)),
      tables: tableStates(s, now),
    }
  })
}

export function mockGetTab(tabId: string): Promise<Tab> {
  return later(() => view(getOpen(db(), tabId)))
}

export function mockGetMenu(): Promise<TabMenu> {
  return later(() => mockMenu())
}

export function mockClosed(): Promise<Tab[]> {
  return later(() => [...db().tabs.values()].filter((t) => t.status === 'closed').map((t) => view(t)))
}

export function mockGetFloors(): Promise<Floor[]> {
  return later(() => mockFloors())
}

export function mockOpen(body: {
  requestId: string
  tableId: string
  covers?: number
  guestName?: string
  reservationId?: string
  note?: string
  items: NewItem[]
}): Promise<SendResult> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const t = tablesWithFloors().find((x) => x.table.id === body.tableId)
      if (!t) fail(409, 'table_not_found', 'Bordet finns inte i planritningen längre. Välj ett annat bord.')
      const lock = s.locks.get(body.tableId)
      if (lock) {
        const open = s.tabs.get(lock)!
        fail(409, 'table_has_open_order', `${tableTitle(open.tableLabel)} har redan en öppen beställning.`, open)
      }
      const guest = mockGuests(now).get(body.tableId)
      const tabId = `${hex(Math.floor(Math.random() * 0xffffffff), 8)}${'0'.repeat(18)}${nextId(s, 6)}`
      const tab = baseTab(
        tabId,
        body.tableId,
        body.covers ?? guest?.partySize ?? null,
        body.guestName?.trim() || guest?.name || null,
        body.reservationId ?? guest?.reservationId ?? null,
        now,
      )
      if (body.note) tab.note = body.note.slice(0, 200)
      const items = buildItems(s, body.items, now, tab)
      tab.items = items
      const round = newRound(tab, 'order', items.filter((i) => i.state === 'sent'), now)
      tab.referenceTotal = totalOf(tab.items)
      s.tabs.set(tabId, tab)
      s.locks.set(body.tableId, tabId)
      s.version += 1
      return result(tab, round)
    }),
  )
}

export function mockAdd(tabId: string, body: { requestId: string; items: NewItem[] }): Promise<SendResult> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      mustBeOpen(tab)
      const items = buildItems(s, body.items, now, tab)
      tab.items.push(...items)
      const round = newRound(tab, 'order', items.filter((i) => i.state === 'sent'), now)
      touch(s, tab, 'add', now)
      return result(tab, round)
    }),
  )
}

export function mockSend(tabId: string, body: { requestId: string; courses?: Course[]; itemIds?: string[] }): Promise<SendResult> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      mustBeOpen(tab)
      const held = tab.items.filter(
        (i) =>
          i.state === 'held' &&
          (body.courses ? body.courses.includes(i.course) : true) &&
          (body.itemIds ? body.itemIds.includes(i.itemId) : true),
      )
      for (const i of held) i.state = 'sent'
      const round = newRound(tab, 'fire', held, now)
      if (round) touch(s, tab, 'fire', now)
      return result(tab, round)
    }),
  )
}

export function mockEdit(
  tabId: string,
  body: { requestId: string; expectedVersion: number; covers?: number; guestName?: string; note?: string; items?: HeldEdit[] },
): Promise<Tab> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      mustBeOpen(tab)
      checkVersion(tab, body.expectedVersion)
      if (body.covers !== undefined) tab.covers = body.covers
      if (body.guestName !== undefined) tab.guestName = body.guestName.trim() || null
      if (body.note !== undefined) tab.note = body.note
      for (const e of body.items ?? []) {
        const item = tab.items.find((i) => i.itemId === e.itemId)
        if (!item || item.state !== 'held') fail(409, 'changed_retry', 'Någon annan ändrade beställningen. Se de senaste ändringarna och försök igen.', tab)
        if (e.remove) {
          item.state = 'void'
          item.voidReason = 'before_send'
          item.voidedAt = new Date(now).toISOString()
          item.voidedByName = WAITER
          continue
        }
        if (e.quantity !== undefined) item.quantity = e.quantity
        if (e.note !== undefined) item.note = e.note
        if (e.allergy !== undefined) item.allergy = e.allergy
        if (e.course !== undefined) item.course = e.course
        if (e.hold === false) item.state = 'sent'
      }
      touch(s, tab, 'edit', now)
      return view(tab)
    }),
  )
}

export function mockVoid(
  tabId: string,
  body: { requestId: string; expectedVersion: number; items: { itemId: string; quantity: number }[]; reason: VoidReason; note?: string },
): Promise<SendResult> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      mustBeOpen(tab)
      checkVersion(tab, body.expectedVersion)
      const voided: TabItem[] = []
      for (const v of body.items) {
        const item = tab.items.find((i) => i.itemId === v.itemId)
        if (!item || item.state !== 'sent' || v.quantity < 1 || v.quantity > item.quantity) {
          fail(400, 'invalid_request', 'Något i beställningen saknas. Kontrollera och försök igen.')
        }
        const stamp = { voidedAt: new Date(now).toISOString(), voidedByName: WAITER, voidReason: body.reason }
        if (v.quantity === item.quantity) {
          Object.assign(item, { state: 'void' }, stamp)
          voided.push(item)
        } else {
          item.quantity -= v.quantity
          const part: TabItem = { ...item, itemId: nextId(s, 12), quantity: v.quantity, state: 'void', ...stamp }
          tab.items.push(part)
          voided.push(part)
        }
      }
      const round = newRound(tab, 'void', voided, now)
      touch(s, tab, 'void', now)
      return result(tab, round)
    }),
  )
}

export function mockMove(tabId: string, body: { requestId: string; expectedVersion: number; tableId: string }): Promise<SendResult> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      mustBeOpen(tab)
      checkVersion(tab, body.expectedVersion)
      const t = tablesWithFloors().find((x) => x.table.id === body.tableId)
      if (!t) fail(409, 'table_not_found', 'Bordet finns inte i planritningen längre. Välj ett annat bord.')
      const other = s.locks.get(body.tableId)
      if (other && other !== tabId) {
        const open = s.tabs.get(other)!
        fail(409, 'table_has_open_order', `${tableTitle(open.tableLabel)} har redan en öppen beställning.`, open)
      }
      const fromLabel = tab.tableLabel
      s.locks.delete(tab.tableId)
      s.locks.set(body.tableId, tabId)
      tab.tableId = body.tableId
      tab.tableLabel = t.table.label
      tab.floorName = t.floor.name
      const round = newRound(tab, 'move', [], now)!
      round.fromLabel = fromLabel
      round.toLabel = t.table.label
      touch(s, tab, 'move', now)
      return result(tab, round)
    }),
  )
}

export function mockClose(tabId: string, body: { requestId: string; expectedVersion: number; dropHeld?: boolean }): Promise<Tab> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      mustBeOpen(tab)
      checkVersion(tab, body.expectedVersion)
      const held = tab.items.filter((i) => i.state === 'held')
      if (held.length && !body.dropHeld) fail(409, 'held_items', 'Det finns rätter som inte har skickats.', tab)
      for (const i of held) Object.assign(i, { state: 'void', voidReason: 'closed', voidedAt: new Date(now).toISOString(), voidedByName: WAITER })
      tab.status = 'closed'
      tab.closedAt = new Date(now).toISOString()
      tab.closedByName = WAITER
      s.locks.delete(tab.tableId)
      touch(s, tab, 'close', now)
      return view(tab)
    }),
  )
}

export function mockReopen(tabId: string, body: { requestId: string }): Promise<Tab> {
  return later(() =>
    replay(body.requestId, () => {
      const s = db()
      const now = Date.now()
      const tab = getOpen(s, tabId)
      if (tab.status === 'open') return view(tab)
      if (!tab.closedAt || now - Date.parse(tab.closedAt) > 15 * MIN) fail(409, 'reopen_expired', 'Det går bara att ångra inom 15 minuter.')
      if (s.locks.has(tab.tableId)) {
        const open = s.tabs.get(s.locks.get(tab.tableId)!)!
        fail(409, 'table_has_open_order', `${tableTitle(open.tableLabel)} har redan en öppen beställning.`, open)
      }
      tab.status = 'open'
      delete tab.closedAt
      delete tab.closedByName
      s.locks.set(tab.tableId, tabId)
      touch(s, tab, 'reopen', now)
      return view(tab)
    }),
  )
}

export function mockRedispatch(tabId: string, round: number): Promise<SendResult> {
  return later(() => {
    const s = db()
    const tab = getOpen(s, tabId)
    const r = tab.rounds.find((x) => x.round === round)
    if (!r) fail(404, 'not_found', 'Beställningen finns inte längre. Uppdatera sidan.')
    r.dispatched = true
    return result(tab, r)
  })
}

/** Sent rounds of every open tab, for the kitchen display mock (admin-board). */
export function mockSentRounds(): MockRound[] {
  const s = db()
  const out: MockRound[] = []
  for (const tab of s.tabs.values()) {
    for (const r of tab.rounds) {
      if (r.kind === 'move') continue
      out.push({
        tabId: tab.tabId,
        round: r.round,
        kind: r.kind,
        tableId: tab.tableId,
        tableLabel: tab.tableLabel,
        waiter: r.byName,
        placedAt: r.at,
        ...(r.kind === 'fire' && r.courses.length === 1 ? { fire: r.courses[0] } : {}),
        items: structuredClone(tab.items.filter((i) => r.itemIds.includes(i.itemId))),
      })
    }
  }
  return out
}
