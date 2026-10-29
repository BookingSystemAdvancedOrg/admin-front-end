import { errorText as commonError } from '../../shared/errors'
import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Köksskrivaren (backend print-jobs, docs/ORDERS.md i application).
 *
 * Restaurangens Star-skrivare (CloudPRNT, t.ex. mC-Print3) frågar Booqy
 * efter nya köksnotor via internet. Betalda beställningar skrivs ut av sig
 * själva när "Skriv ut automatiskt" är på. Utan API (VITE_API_BASE_URL
 * osatt) körs allt på mockdata nedan.
 */

export type PaperWidth = 80 | 58
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
  /** Adressen som skrivs in i skrivarens CloudPRNT-inställning. */
  serverUrl?: string
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
}

export interface PrintOverview {
  settings: PrintSettings
  devices: Printer[]
  status: PrintStatus
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
  return { ...mock.status, autoPrint: mock.settings.autoPrint, printerConfigured: Boolean(printer), online: Boolean(printer?.online) }
}

// --- API ----------------------------------------------------------------------------

export async function getPrinting(locationId: string): Promise<PrintOverview> {
  if (!isApiConfigured()) return { ...mock, status: mockStatus() }
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

export async function addPrinter(locationId: string, name: string): Promise<PrinterCredentials> {
  if (!isApiConfigured()) {
    const deviceId = mockSecret().slice(0, 32)
    const device: Printer = { deviceId, name, online: false, serverUrl: `${MOCK_URL}/${deviceId}` }
    mock = {
      ...mock,
      devices: [...mock.devices, device],
      settings: mock.settings.printerId ? mock.settings : { ...mock.settings, printerId: deviceId, version: mock.settings.version + 1 },
    }
    return { device, username: deviceId, secret: mockSecret() }
  }
  return apiFetch(`${base(locationId)}/devices`, { method: 'POST', body: JSON.stringify({ name }) })
}

export async function removePrinter(locationId: string, deviceId: string): Promise<PrintOverview> {
  if (!isApiConfigured()) {
    const wasPrinter = mock.settings.printerId === deviceId
    mock = {
      ...mock,
      devices: mock.devices.filter((d) => d.deviceId !== deviceId),
      settings: wasPrinter ? { ...mock.settings, printerId: null, autoPrint: false, version: mock.settings.version + 1 } : mock.settings,
    }
    return { ...mock, status: mockStatus() }
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

export async function reprintOrder(locationId: string, orderId: string): Promise<void> {
  if (!isApiConfigured()) return
  await apiFetch(`${base(locationId)}/jobs`, { method: 'POST', body: JSON.stringify({ orderId }) })
}

/** "Skrivaren svarar inte" / "N outskrivna" ovanför kolumnerna. */
export function printBannerText(status: PrintStatus | null): string | null {
  if (!status?.printerConfigured) return null
  const parts: string[] = []
  if (!status.online) parts.push('Skrivaren svarar inte')
  if (status.unprinted) parts.push(`${status.unprinted} outskrivna`)
  if (status.failed) parts.push(`${status.failed} kunde inte skrivas ut (tryck Skriv ut igen)`)
  return parts.length ? parts.join(' · ') : null
}

const PRINT_ERRORS: Record<string, string> = {
  no_printer: 'Ingen skrivare är vald. Lägg till en under Inställningar → Skrivare.',
  order_not_paid: 'Beställningen är inte betald och kan inte skrivas ut.',
  order_cancelled: 'Beställningen är avbruten och skrivs inte ut igen.',
  too_many_printers: 'Platsen har redan fem skrivare. Ta bort en först.',
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
