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
export type PrinterProtocol = 'star' | 'epson'
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
}

export interface Station {
  /** Saknas på en ny station tills den sparas. */
  stationId?: string
  name: string
  printerIds: string[]
}

export interface TicketRouting {
  stations: Station[]
  /** Kategori -> station eller "none". */
  categories: Partial<Record<Course, string>>
  allergyTicket: boolean
  version: number
}

export interface TicketEntry {
  name: string
  quantity: number
  course: Course | null
  /** Rätten i menyn när raden är en del av en meny/combo. */
  partOf?: string
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
  billId?: string
  number?: number
  mode?: 'pickup' | 'table'
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
}

export interface PrintOverview {
  settings: PrintSettings
  devices: Printer[]
  status: PrintStatus
  routing?: TicketRouting
}

/** Visas en gång när en skrivare läggs till eller får ny nyckel. */
export interface PrinterCredentials {
  device: Printer
  username: string
  secret: string
}

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/print`
}

// --- mockdata (ingen backend) ---------------------------------------------------

const MOCK_URL = 'https://api.example.se/print/cloudprnt'
const MOCK_ORDER = 'mockorder00000000000000000000001'
let mockRouting: TicketRouting = {
  stations: [
    { stationId: 'kok', name: 'Kök', printerIds: ['mockprinter0000000000000000000001'] },
    { stationId: 'bar', name: 'Bar', printerIds: [] },
  ],
  categories: { starters: 'kok', mains: 'kok', desserts: 'kok', drinks: 'bar' },
  allergyTicket: true,
  version: 1,
}
let mockTickets: StationTicket[] = [
  {
    sourceId: MOCK_ORDER, orderId: MOCK_ORDER, stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: true,
    number: 12, mode: 'table', tableLabel: '7', placedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    entries: [
      { name: 'Toast Skagen', quantity: 2, course: 'starters' },
      { name: 'Burgare', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
      { name: 'Pommes', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
    ],
  },
  {
    sourceId: MOCK_ORDER, orderId: MOCK_ORDER, stationId: 'bar', stationName: 'Bar', status: 'sent', allergy: true,
    number: 12, mode: 'table', tableLabel: '7', placedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    entries: [
      { name: 'Läsk', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
      { name: 'Mojito', quantity: 1, course: 'drinks' },
    ],
  },
  {
    sourceId: 'mockorder00000000000000000000002', orderId: 'mockorder00000000000000000000002', stationId: 'kok',
    stationName: 'Kök', status: 'preparing', allergy: false, number: 11, mode: 'pickup',
    placedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
    entries: [{ name: 'Pizza Margherita', quantity: 2, course: 'mains' }],
  },
]
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
    },
  ],
  status: { autoPrint: true, printerConfigured: true, online: true, unprinted: 0, failed: 0, orders: {} },
}

function mockSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
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
  }
}

// --- API ----------------------------------------------------------------------------

export async function getPrinting(locationId: string): Promise<PrintOverview> {
  if (!isApiConfigured()) return { ...mock, status: mockStatus(), routing: mockRouting }
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

export async function addPrinter(locationId: string, name: string, protocol: PrinterProtocol = 'star'): Promise<PrinterCredentials> {
  if (!isApiConfigured()) {
    const deviceId = mockSecret().slice(0, 32)
    const url = protocol === 'epson' ? MOCK_URL.replace('/cloudprnt', '/epson') : MOCK_URL
    const device: Printer = { deviceId, name, protocol, online: false, serverUrl: `${url}/${deviceId}` }
    mock = {
      ...mock,
      devices: [...mock.devices, device],
      settings: mock.settings.printerId ? mock.settings : { ...mock.settings, printerId: deviceId, version: mock.settings.version + 1 },
    }
    return { device, username: deviceId, secret: mockSecret() }
  }
  return apiFetch(`${base(locationId)}/devices`, { method: 'POST', body: JSON.stringify({ name, protocol }) })
}

export async function removePrinter(locationId: string, deviceId: string): Promise<PrintOverview> {
  if (!isApiConfigured()) {
    const wasPrinter = mock.settings.printerId === deviceId
    mock = {
      ...mock,
      devices: mock.devices.filter((d) => d.deviceId !== deviceId),
      routing: undefined,
      settings: wasPrinter ? { ...mock.settings, printerId: null, autoPrint: false, version: mock.settings.version + 1 } : mock.settings,
    }
    mockRouting = {
      ...mockRouting, version: mockRouting.version + 1,
      stations: mockRouting.stations.map((s) => ({ ...s, printerIds: s.printerIds.filter((id) => id !== deviceId) })),
    }
    return { ...mock, status: mockStatus(), routing: mockRouting }
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
  if (!isApiConfigured()) return
  await apiFetch(`${base(locationId)}/devices/${encodeURIComponent(deviceId)}/test`, { method: 'POST' })
}

export async function reprintOrder(locationId: string, orderId: string, stationId?: string): Promise<void> {
  if (!isApiConfigured()) return
  await apiFetch(`${base(locationId)}/jobs`, { method: 'POST', body: JSON.stringify(stationId ? { orderId, stationId } : { orderId }) })
}

export async function getRouting(locationId: string): Promise<TicketRouting> {
  if (!isApiConfigured()) return mockRouting
  return apiFetch(`${base(locationId)}/routing`)
}

export async function saveRouting(locationId: string, routing: TicketRouting): Promise<TicketRouting> {
  if (!isApiConfigured()) {
    mockRouting = {
      ...routing,
      version: routing.version + 1,
      stations: routing.stations.map((s) => ({ ...s, stationId: s.stationId ?? `s${mockSecret().slice(0, 8)}` })),
    }
    return mockRouting
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
  no_printer: 'Ingen skrivare är vald. Lägg till en under Inställningar → Skrivare.',
  order_not_paid: 'Beställningen är inte betald och kan inte skrivas ut.',
  order_cancelled: 'Beställningen är avbruten och skrivs inte ut igen.',
  too_many_printers: `Platsen har redan ${MAX_PRINTERS} skrivare. Ta bort en först.`,
  changed_retry: 'Inställningen har just ändrats av någon annan. Sidan är uppdaterad, försök igen.',
}

export function printErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (PRINT_ERRORS[err.message]) return PRINT_ERRORS[err.message]
    if (err.status === 403) return 'Bara restaurangens ägare kan ändra skrivarna.'
    if (err.status === 404) return 'Hittades inte längre. Ladda om sidan.'
  }
  return commonError(err, 'Kunde inte nå skrivartjänsten.')
}
