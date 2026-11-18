import { errorText as commonError } from '../../shared/errors'
import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Bongar och skrivare (backend print-jobs, shared/routing.py i application).
 *
 * Varje plats har stationer (Kök, Bar, ...) med noll eller flera skrivare.
 * En betald beställning blir en bong per station: maten till köket, drycken
 * till baren, en egen allergibong när en rad har allergi. Skrivarna (Star
 * CloudPRNT, t.ex. mC-Print3, eller Epson Server Direct Print, t.ex.
 * TM-m30III) frågar Booqy efter bongar via internet; köksskärmen visar
 * samma bongar utan skrivare. Utan API (VITE_API_BASE_URL osatt) körs allt
 * på mockdata nedan.
 */

export type PaperWidth = 80 | 58
/** "sim" = en simulerad skrivare (bara i dev): bongarna syns på skärmen. */
export type PrinterProtocol = 'star' | 'epson' | 'sim'
/** Vad skrivaren är till för: Kök (maten), Dryck (baren) eller Annat (en egen station). */
export type PrinterKind = 'kok' | 'dryck' | 'annat'
export type Course = 'starters' | 'mains' | 'desserts' | 'drinks'
export type TicketState = 'sent' | 'preparing' | 'ready' | 'cancelled'
/** En stations id, eller "none" = ingen bong. */
export const NO_TICKET = 'none'
export const MAX_PRINTERS = 12
export type JobState = 'PENDING' | 'PRINTING' | 'FAILED'

export interface PrintSettings {
  autoPrint: boolean
  printerId: string | null
  paperWidth: PaperWidth
  version: number
}

export interface Printer {
  deviceId: string
  name: string
  mac?: string
  lastSeenAt?: string
  statusCode?: string
  createdAt?: string
  online: boolean
  /** Adressen som skrivs in i skrivarens CloudPRNT- eller Server Direct Print-inställning. */
  serverUrl?: string
  protocol?: PrinterProtocol
  /** Saknas på skrivare från innan sorterna: servern räknar ut den. */
  kind?: PrinterKind
  /** En simulerad skrivare (bara i dev). */
  simulated?: boolean
}

export interface Station {
  /** Saknas på en ny station tills den sparas. */
  stationId?: string
  name: string
  printerIds: string[]
  /** kok, dryck eller annat (från servern). */
  kind?: PrinterKind
  /** Skrivarnas namn, för den som inte ser skrivarna (Meny). */
  printerNames?: string[]
}

export interface TicketRouting {
  stations: Station[]
  /** Menykategori -> station eller "none"; saknas = standard (Dryck för drycker, annars Kök). */
  categories: Record<string, string>
  allergyTicket: boolean
  version: number
}

export interface TicketEntry {
  name: string
  quantity: number
  course: Course | null
  /** Rätten i menyn när raden är en del av en meny/combo. */
  partOf?: string
  /** Gästens tillval, "Storlek: Stor". */
  options?: string[]
  note?: string
  allergy?: string
}

export interface StationTicket {
  sourceId: string
  stationId: string
  stationName: string
  status: TicketState
  allergy: boolean
  entries: TicketEntry[]
  notes?: string
  orderId?: string
  number?: number
  mode?: 'pickup' | 'table'
  /** Bordets id i planritningen, när servern skickar det. */
  tableId?: string
  tableLabel?: string
  placedAt?: string
  createdAt?: string
  updatedAt?: string
}

/** En stations läge på en beställning (tavlan). */
export interface StationState {
  stationId: string
  stationName: string
  status: TicketState
  allergy: boolean
}

export interface PrintStatus {
  autoPrint: boolean
  printerConfigured: boolean
  online: boolean
  lastSeenAt?: string
  unprinted: number
  failed: number
  /** Beställningar som inte är utskrivna än: orderId -> läge. */
  orders: Record<string, JobState>
  /** Skrivare som inte har hört av sig (namn). */
  offline?: string[]
  /** Varje stations bong per beställning (senaste dygnet). */
  tickets?: Record<string, StationState[]>
  /** Antal skrivare (Kom igång). */
  printerCount?: number
  /** Ägaren valde "Inga skrivare än": steget står kvar som öppet men stoppar inget. */
  setupSkipped?: boolean
}

export interface PrintOverview {
  settings: PrintSettings
  devices: Printer[]
  status: PrintStatus
  routing?: TicketRouting
  /** Simulerade skrivare tillåts (dev, aldrig prod). */
  simulatorAllowed?: boolean
}

/** Visas en gång när en skrivare läggs till eller får ny nyckel (en simulerad har inga). */
export interface PrinterCredentials {
  device: Printer
  username?: string
  secret?: string
}

/** En rad på den simulerade skrivarens papper. */
export interface PaperRow {
  text: string
  bold?: boolean
  big?: boolean
  center?: boolean
}

export interface SimTicket {
  jobId: string
  kind: 'station' | 'allergy' | 'test' | 'cancel'
  printedAt: string
  lines: PaperRow[]
}

export interface SimPaper {
  device: Printer
  paperWidth: PaperWidth
  tickets: SimTicket[]
}

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/print`
}

// --- mockdata (ingen backend) ---------------------------------------------------

const MOCK_URL = 'https://api.example.se/print/cloudprnt'
const MOCK_ORDER = 'mockorder00000000000000000000001'
let mockRouting: TicketRouting = {
  stations: [
    { stationId: 'kok', name: 'Kök', printerIds: ['mockprinter0000000000000000000001'], kind: 'kok' },
    { stationId: 'bar', name: 'Bar', printerIds: [], kind: 'dryck' },
  ],
  categories: { starters: 'kok', mains: 'kok', desserts: 'kok', drinks: 'bar' },
  allergyTicket: true,
  version: 1,
}
let mockTickets: StationTicket[] = [
  {
    sourceId: MOCK_ORDER, orderId: MOCK_ORDER, stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: true,
    number: 12, mode: 'pickup', placedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    entries: [
      { name: 'Toast Skagen', quantity: 2, course: 'starters' },
      { name: 'Burgare', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
      { name: 'Pommes', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
    ],
  },
  {
    sourceId: MOCK_ORDER, orderId: MOCK_ORDER, stationId: 'bar', stationName: 'Bar', status: 'sent', allergy: true,
    number: 12, mode: 'pickup', placedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    entries: [
      { name: 'Läsk', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
      { name: 'Lemonad', quantity: 1, course: 'drinks' },
    ],
  },
  {
    sourceId: 'mockorder00000000000000000000002', orderId: 'mockorder00000000000000000000002', stationId: 'kok',
    stationName: 'Kök', status: 'preparing', allergy: false, number: 11, mode: 'pickup',
    placedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
    entries: [{ name: 'Pizza Margherita', quantity: 2, course: 'mains' }],
  },
]
let mockSkipped = false
let mock: PrintOverview = {
  settings: { autoPrint: true, printerId: 'mockprinter0000000000000000000001', paperWidth: 80, version: 1 },
  devices: [
    {
      deviceId: 'mockprinter0000000000000000000001',
      name: 'Köket',
      mac: '00:11:62:1a:2b:3c',
      lastSeenAt: new Date().toISOString(),
      statusCode: '200 OK',
      online: true,
      serverUrl: `${MOCK_URL}/mockprinter0000000000000000000001`,
      kind: 'kok',
    },
  ],
  status: { autoPrint: true, printerConfigured: true, online: true, unprinted: 0, failed: 0, orders: {} },
}

function mockSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Samma som routing.kinds_config på servern. */
function mockApplyKinds() {
  const kinds = new Map(mock.devices.map((d) => [d.deviceId, d.kind ?? 'kok']))
  const of = (k: PrinterKind) => [...kinds].filter(([, v]) => v === k).map(([id]) => id)
  const food = of('kok'), drink = of('dryck'), other = of('annat')
  const foodP = food.length ? food : drink.length ? drink : other
  const drinkP = drink.length ? drink : food.length ? food : other
  const otherId = (id: string) => `a${id.slice(0, 12)}`
  const wanted = new Map(other.map((id) => [otherId(id), id]))
  const nameOf = (id: string) => (mock.devices.find((d) => d.deviceId === id)?.name ?? 'Annat').slice(0, 30)
  const stations: Station[] = []
  for (const s of mockRouting.stations) {
    const sid = s.stationId ?? ''
    if (/^a[0-9a-f]{12}$/.test(sid) && !wanted.has(sid)) continue
    if (sid === 'kok') stations.push({ ...s, printerIds: foodP, kind: 'kok' })
    else if (sid === 'bar') stations.push({ ...s, name: s.name === 'Bar' ? 'Dryck' : s.name, printerIds: drinkP, kind: 'dryck' })
    else if (wanted.has(sid)) stations.push({ ...s, name: nameOf(wanted.get(sid)!), printerIds: [wanted.get(sid)!], kind: 'annat' })
    else stations.push({ ...s, printerIds: s.printerIds.filter((id) => kinds.has(id)) })
  }
  if (!stations.some((s) => s.stationId === 'kok')) stations.unshift({ stationId: 'kok', name: 'Kök', printerIds: foodP, kind: 'kok' })
  if (!stations.some((s) => s.stationId === 'bar')) stations.splice(1, 0, { stationId: 'bar', name: 'Dryck', printerIds: drinkP, kind: 'dryck' })
  for (const [sid, id] of wanted) if (!stations.some((s) => s.stationId === sid)) stations.push({ stationId: sid, name: nameOf(id), printerIds: [id], kind: 'annat' })
  const ids = new Set(stations.map((s) => s.stationId))
  const categories = Object.fromEntries(Object.entries(mockRouting.categories).filter(([, t]) => t === NO_TICKET || ids.has(t)))
  mockRouting = { ...mockRouting, stations, categories, version: mockRouting.version + 1 }
}

function mockRoutingView(): TicketRouting {
  return {
    ...mockRouting,
    stations: mockRouting.stations.map((s) => ({
      ...s,
      printerNames: s.printerIds.map((id) => mock.devices.find((d) => d.deviceId === id)?.name ?? '').filter(Boolean),
    })),
  }
}

const mockPaper = new Map<string, SimTicket[]>()

function mockPrint(deviceId: string, kind: SimTicket['kind'], lines: PaperRow[]) {
  const list = mockPaper.get(deviceId) ?? []
  mockPaper.set(deviceId, [{ jobId: mockSecret().slice(0, 12), kind, printedAt: new Date().toISOString(), lines }, ...list].slice(0, 20))
}

/** En exempelbeställning på varje simulerad skrivare, efter vad den får. */
function mockSampleTickets(device: Printer) {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  for (const s of mockRouting.stations.filter((x) => x.printerIds.includes(device.deviceId))) {
    const kind = stationKindOf(s)
    const items = kind === 'dryck' ? ['2 x Cola', '1 x Mojito'] : kind === 'kok' ? ['2 x Toast Skagen', '1 x Burgare'] : ['1 x Pizza Margherita']
    mockPrint(device.deviceId, 'station', [
      { text: s.name.toUpperCase(), big: true, bold: true, center: true },
      { text: '#12  Avhämtning', big: true, bold: true },
      { text: `Beställd ${time}` },
      { text: '-'.repeat(32) },
      ...items.map((t) => ({ text: t, bold: true })),
      { text: '-'.repeat(32) },
      { text: 'Köksnota, ej kvitto', center: true },
    ])
  }
}

function stationKindOf(s: Station): PrinterKind {
  return s.kind ?? (s.stationId === 'kok' ? 'kok' : s.stationId === 'bar' ? 'dryck' : 'annat')
}

function mockStatus(): PrintStatus {
  const printer = mock.devices.find((d) => d.deviceId === mock.settings.printerId)
  const tickets: Record<string, StationState[]> = {}
  for (const t of mockTickets) {
    if (t.orderId) (tickets[t.orderId] ??= []).push({ stationId: t.stationId, stationName: t.stationName, status: t.status, allergy: t.allergy })
  }
  return {
    ...mock.status, autoPrint: mock.settings.autoPrint, printerConfigured: Boolean(printer), online: Boolean(printer?.online),
    offline: mock.devices.filter((d) => !d.online).map((d) => d.name), tickets,
    printerCount: mock.devices.length, setupSkipped: mockSkipped,
  }
}

// --- API ----------------------------------------------------------------------------

export async function getPrinting(locationId: string): Promise<PrintOverview> {
  if (!isApiConfigured()) return { ...mock, status: mockStatus(), routing: mockRoutingView(), simulatorAllowed: true }
  return apiFetch(base(locationId))
}

export async function getPrintStatus(locationId: string): Promise<PrintStatus> {
  if (!isApiConfigured()) return mockStatus()
  return apiFetch(`${base(locationId)}/status`)
}

export async function savePrintSettings(locationId: string, settings: PrintSettings): Promise<PrintSettings> {
  if (!isApiConfigured()) {
    mock = { ...mock, settings: { ...settings, version: settings.version + 1 } }
    return mock.settings
  }
  return apiFetch(`${base(locationId)}/settings`, { method: 'PUT', body: JSON.stringify(settings) })
}

export async function addPrinter(
  locationId: string,
  name: string,
  protocol: PrinterProtocol = 'star',
  kind?: PrinterKind,
): Promise<PrinterCredentials> {
  if (!isApiConfigured()) {
    if (mock.devices.length >= MAX_PRINTERS) throw new ApiError(409, 'too_many_printers')
    const deviceId = mockSecret().slice(0, 32)
    const sim = protocol === 'sim'
    const url = protocol === 'epson' ? MOCK_URL.replace('/cloudprnt', '/epson') : MOCK_URL
    const device: Printer = sim
      ? { deviceId, name, protocol, kind, online: true, simulated: true }
      : { deviceId, name, protocol, kind, online: false, serverUrl: `${url}/${deviceId}` }
    const first = !mock.settings.printerId
    mock = {
      ...mock,
      devices: [...mock.devices, device],
      settings: first ? { ...mock.settings, printerId: deviceId, autoPrint: kind ? true : mock.settings.autoPrint, version: mock.settings.version + 1 } : mock.settings,
    }
    if (kind) mockApplyKinds()
    if (sim) mockSampleTickets(device)
    return sim ? { device } : { device, username: deviceId, secret: mockSecret() }
  }
  return apiFetch(`${base(locationId)}/devices`, {
    method: 'POST',
    body: JSON.stringify(kind ? { name, protocol, kind } : { name, protocol }),
  })
}

/** Byt namn eller sort; en ny sort flyttar skrivarens bongar. */
export async function updatePrinter(
  locationId: string,
  deviceId: string,
  changes: { name?: string; kind?: PrinterKind },
): Promise<PrintOverview> {
  if (!isApiConfigured()) {
    if (!mock.devices.some((d) => d.deviceId === deviceId)) throw new ApiError(404, 'not found')
    mock = { ...mock, devices: mock.devices.map((d) => (d.deviceId === deviceId ? { ...d, ...changes } : d)) }
    mockApplyKinds()
    return getPrinting(locationId)
  }
  return apiFetch(`${base(locationId)}/devices/${encodeURIComponent(deviceId)}`, { method: 'PUT', body: JSON.stringify(changes) })
}

/** "Inga skrivare än" (true) i Kom igång; false tar bort valet. */
export async function setPrinterSetupSkipped(locationId: string, skipped: boolean): Promise<PrintStatus> {
  if (!isApiConfigured()) {
    mockSkipped = skipped
    return mockStatus()
  }
  return apiFetch(`${base(locationId)}/setup`, { method: 'POST', body: JSON.stringify({ skipped }) })
}

/** Vart hela kategorier går: {categoryId: station | "none" | null (standard)}. Ägaren eller personal med Meny. */
export async function saveCategoryRouting(locationId: string, categories: Record<string, string | null>): Promise<TicketRouting> {
  if (!isApiConfigured()) {
    const next = { ...mockRouting.categories }
    for (const [id, target] of Object.entries(categories)) {
      if (target === null) delete next[id]
      else next[id] = target
    }
    mockRouting = { ...mockRouting, categories: next, version: mockRouting.version + 1 }
    return mockRoutingView()
  }
  return apiFetch(`${base(locationId)}/routing/categories`, { method: 'PUT', body: JSON.stringify({ categories }) })
}

/** Den simulerade skrivarens papper: de senaste bongarna, nyast först. */
export async function getSimulatedPaper(locationId: string, deviceId: string): Promise<SimPaper> {
  if (!isApiConfigured()) {
    const device = mock.devices.find((d) => d.deviceId === deviceId)
    if (!device?.simulated) throw new ApiError(404, 'not found')
    return { device, paperWidth: mock.settings.paperWidth, tickets: mockPaper.get(deviceId) ?? [] }
  }
  return apiFetch(`${base(locationId)}/devices/${encodeURIComponent(deviceId)}/simulated`)
}

export async function removePrinter(locationId: string, deviceId: string): Promise<PrintOverview> {
  if (!isApiConfigured()) {
    const wasPrinter = mock.settings.printerId === deviceId
    const removed = mock.devices.find((d) => d.deviceId === deviceId)
    const rest = mock.devices.filter((d) => d.deviceId !== deviceId)
    const successor = removed?.kind && rest[0] ? rest[0].deviceId : null
    mock = {
      ...mock,
      devices: rest,
      routing: undefined,
      settings: wasPrinter
        ? successor
          ? { ...mock.settings, printerId: successor, version: mock.settings.version + 1 }
          : { ...mock.settings, printerId: null, autoPrint: false, version: mock.settings.version + 1 }
        : mock.settings,
    }
    mockRouting = {
      ...mockRouting, version: mockRouting.version + 1,
      stations: mockRouting.stations.map((s) => ({ ...s, printerIds: s.printerIds.filter((id) => id !== deviceId) })),
    }
    mockPaper.delete(deviceId)
    if (removed?.kind || rest.some((d) => d.kind)) mockApplyKinds()
    return { ...mock, status: mockStatus(), routing: mockRoutingView(), simulatorAllowed: true }
  }
  return apiFetch(`${base(locationId)}/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
}

export async function rotatePrinter(locationId: string, deviceId: string): Promise<PrinterCredentials> {
  if (!isApiConfigured()) {
    const device = mock.devices.find((d) => d.deviceId === deviceId)
    if (!device) throw new ApiError(404, 'not found')
    return { device, username: deviceId, secret: mockSecret() }
  }
  return apiFetch(`${base(locationId)}/devices/${encodeURIComponent(deviceId)}/rotate`, { method: 'POST' })
}

export async function testPrint(locationId: string, deviceId: string): Promise<void> {
  if (!isApiConfigured()) {
    const device = mock.devices.find((d) => d.deviceId === deviceId)
    if (device?.simulated) {
      mockPrint(deviceId, 'test', [
        { text: 'TESTUTSKRIFT', big: true, bold: true, center: true },
        { text: device.name, center: true },
        { text: '-'.repeat(32) },
        { text: 'Skrivaren fungerar.', center: true },
      ])
    }
    return
  }
  await apiFetch(`${base(locationId)}/devices/${encodeURIComponent(deviceId)}/test`, { method: 'POST' })
}

export async function reprintOrder(locationId: string, orderId: string, stationId?: string): Promise<void> {
  if (!isApiConfigured()) return
  await apiFetch(`${base(locationId)}/jobs`, { method: 'POST', body: JSON.stringify(stationId ? { orderId, stationId } : { orderId }) })
}

export async function getRouting(locationId: string): Promise<TicketRouting> {
  if (!isApiConfigured()) return mockRoutingView()
  return apiFetch(`${base(locationId)}/routing`)
}

export async function saveRouting(locationId: string, routing: TicketRouting): Promise<TicketRouting> {
  if (!isApiConfigured()) {
    mockRouting = {
      ...routing,
      version: routing.version + 1,
      stations: routing.stations.map((s) => ({ ...s, stationId: s.stationId ?? `s${mockSecret().slice(0, 8)}` })),
    }
    return mockRoutingView()
  }
  return apiFetch(`${base(locationId)}/routing`, { method: 'PUT', body: JSON.stringify(routing) })
}

export async function listTickets(locationId: string): Promise<StationTicket[]> {
  if (!isApiConfigured()) return mockTickets
  return (await apiFetch<{ tickets: StationTicket[] }>(`${base(locationId)}/tickets`)).tickets
}

function ticketPath(locationId: string, t: { sourceId: string; stationId: string }): string {
  return `${base(locationId)}/tickets/${encodeURIComponent(t.sourceId)}/${encodeURIComponent(t.stationId)}`
}

export async function setTicketStatus(locationId: string, ticket: StationTicket, status: Exclude<TicketState, 'cancelled'>): Promise<StationTicket> {
  if (!isApiConfigured()) {
    const next = { ...ticket, status, updatedAt: new Date().toISOString() }
    mockTickets = mockTickets.map((t) => (t.sourceId === ticket.sourceId && t.stationId === ticket.stationId ? next : t))
    return next
  }
  return apiFetch(ticketPath(locationId, ticket), { method: 'PUT', body: JSON.stringify({ status }) })
}

export async function reprintTicket(locationId: string, ticket: StationTicket): Promise<void> {
  if (!isApiConfigured()) return
  await apiFetch(`${ticketPath(locationId, ticket)}/print`, { method: 'POST' })
}

export const TICKET_TEXT: Record<TicketState, string> = {
  sent: 'skickad',
  preparing: 'tillagas',
  ready: 'klar',
  cancelled: 'avbruten',
}

export const COURSE_TEXT: Record<Course, string> = {
  starters: 'Förrätt',
  mains: 'Varmrätt',
  desserts: 'Efterrätt',
  drinks: 'Dryck',
}

const COURSE_ORDER: Course[] = ['starters', 'mains', 'desserts', 'drinks']

/** Bongens rader per rätt (förrätt, varmrätt, ...); en grupp utan namn när allt är samma. */
export function byCourse(entries: TicketEntry[]): { course: string | null; entries: TicketEntry[] }[] {
  const keys = [...COURSE_ORDER.filter((c) => entries.some((e) => e.course === c)), ...(entries.some((e) => !e.course) ? [null] : [])]
  if (keys.length <= 1) return [{ course: null, entries }]
  return keys.map((k) => ({ course: k ? COURSE_TEXT[k] : 'Övrigt', entries: entries.filter((e) => (e.course ?? null) === k) }))
}

/** "Skrivaren svarar inte" / "N outskrivna" ovanför kolumnerna. */
export function printBannerText(status: PrintStatus | null): string | null {
  if (!status?.printerConfigured) return null
  const parts: string[] = []
  const offline = status.offline ?? []
  if (offline.length) parts.push(`Svarar inte: ${offline.join(', ')}`)
  else if (!status.online) parts.push('Skrivaren svarar inte')
  if (status.unprinted) parts.push(`${status.unprinted} outskrivna`)
  if (status.failed) parts.push(`${status.failed} kunde inte skrivas ut (tryck Skriv ut igen)`)
  return parts.length ? parts.join(' · ') : null
}

const PRINT_ERRORS: Record<string, string> = {
  no_printer: 'Det finns ingen skrivare. Lägg till en under Inställningar, Beställning, Kvittoskrivare.',
  simulated_printer: 'En simulerad skrivare har ingen nyckel.',
  simulator_dev_only: 'Simulerade skrivare finns bara i testmiljön. Lägg till en riktig skrivare.',
  order_not_paid: 'Beställningen är inte betald än, så den skrivs inte ut.',
  order_cancelled: 'Beställningen är avbruten, så den skrivs inte ut igen.',
  too_many_printers: `Platsen har redan ${MAX_PRINTERS} skrivare, som är max. Ta bort en först.`,
  changed_retry: 'Någon annan ändrade samma inställning nyss. Nu syns det senaste. Försök igen.',
}

export function printErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (PRINT_ERRORS[err.message]) return PRINT_ERRORS[err.message]
    if (err.status === 403) return 'Bara restaurangens ägare kan ändra det här. Be ägaren göra det.'
    if (err.status === 404 && err.code !== 'route_not_found') return 'Skrivaren finns inte längre, någon har tagit bort den. Nu syns det som finns kvar.'
  }
  return commonError(err, 'Utskriften gick inte.')
}
