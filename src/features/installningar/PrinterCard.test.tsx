import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrinterCard } from './PrinterCard'
import { ApiError } from '../../shared/api'
import type { PrintOverview } from '../bestallningar/printApi'
import { chooseOption } from '../../test/select'

const api = {
  getPrinting: vi.fn(),
  savePrintSettings: vi.fn(),
  addPrinter: vi.fn(),
  removePrinter: vi.fn(),
  rotatePrinter: vi.fn(),
  testPrint: vi.fn(),
  updatePrinter: vi.fn(),
  setPrinterSetupSkipped: vi.fn(),
  saveCategoryRouting: vi.fn(),
}
vi.mock('../bestallningar/printApi', async (orig) => ({
  ...(await orig<typeof import('../bestallningar/printApi')>()),
  getPrinting: (...a: unknown[]) => api.getPrinting(...a),
  savePrintSettings: (...a: unknown[]) => api.savePrintSettings(...a),
  addPrinter: (...a: unknown[]) => api.addPrinter(...a),
  removePrinter: (...a: unknown[]) => api.removePrinter(...a),
  rotatePrinter: (...a: unknown[]) => api.rotatePrinter(...a),
  testPrint: (...a: unknown[]) => api.testPrint(...a),
  updatePrinter: (...a: unknown[]) => api.updatePrinter(...a),
  setPrinterSetupSkipped: (...a: unknown[]) => api.setPrinterSetupSkipped(...a),
  saveCategoryRouting: (...a: unknown[]) => api.saveCategoryRouting(...a),
}))
vi.mock('../meny/menuApi', async (orig) => ({
  ...(await orig<typeof import('../meny/menuApi')>()),
  getMenuCategories: async () => ({
    categories: [
      { categoryId: 'starters', name: 'Förrätter' },
      { categoryId: 'mains', name: 'Varmrätter' },
      { categoryId: 'drinks', name: 'Drycker' },
      { categoryId: 'c0a1b2c3d4', name: 'Öl och vin' },
    ],
    version: 1,
  }),
}))

const PRINTER = { deviceId: 'd'.repeat(32), name: 'Köket', online: true, lastSeenAt: '2026-10-12T16:00:00Z', kind: 'kok' as const,
  serverUrl: `https://api.example/print/cloudprnt/${'d'.repeat(32)}` }
const ROUTING = {
  stations: [
    { stationId: 'kok', name: 'Kök', printerIds: [PRINTER.deviceId], kind: 'kok' as const },
    { stationId: 'bar', name: 'Dryck', printerIds: [PRINTER.deviceId], kind: 'dryck' as const },
  ],
  categories: { starters: 'kok', mains: 'kok', desserts: 'kok', drinks: 'bar' },
  allergyTicket: true,
  version: 2,
}
const EMPTY: PrintOverview = {
  settings: { autoPrint: false, printerId: null, paperWidth: 80, version: 0 },
  devices: [],
  status: { autoPrint: false, printerConfigured: false, online: false, unprinted: 0, failed: 0, orders: {}, printerCount: 0 },
  routing: { ...ROUTING, stations: ROUTING.stations.map((s) => ({ ...s, printerIds: [] })) },
}
const ONE: PrintOverview = {
  ...EMPTY,
  settings: { ...EMPTY.settings, printerId: PRINTER.deviceId, autoPrint: true, version: 1 },
  devices: [PRINTER],
  status: { ...EMPTY.status, printerCount: 1, printerConfigured: true },
  routing: ROUTING,
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.saveCategoryRouting.mockResolvedValue(ROUTING)
})

describe('PrinterCard', () => {
  it('loads again after a failed first load when Försök igen is tapped', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockRejectedValueOnce(new ApiError(500, 'internal_error')).mockResolvedValue(ONE)
    render(<PrinterCard locationId="loc-1" isOwner />)
    expect(await screen.findByText(/Skrivarna kunde inte visas\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByRole('list', { name: 'Skrivare' })).toHaveTextContent('Köket')
  })

  it('adds a Kök printer in three taps, shows its credentials once and sends drink categories to Dryck', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValueOnce(EMPTY).mockResolvedValue(ONE)
    api.addPrinter.mockResolvedValue({ device: PRINTER, username: PRINTER.deviceId, secret: 's3cret' })
    api.saveCategoryRouting.mockResolvedValue(ROUTING)
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Lägg till skrivare' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Sort' })).getByRole('radio', { name: 'Kök' }))
    expect(screen.getByLabelText('Namn')).toHaveValue('Kök 1')
    expect(screen.queryByRole('radio', { name: 'Simulerad' })).toBeNull() // not offered unless the API allows it
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))
    expect(api.addPrinter).toHaveBeenCalledWith('loc-1', 'Kök 1', 'star', 'kok')
    expect(api.saveCategoryRouting).toHaveBeenCalledWith('loc-1', { c0a1b2c3d4: 'bar' })
    expect(await screen.findByRole('status')).toHaveTextContent('Kök · Kök 1 är klar')
    const box = screen.getByRole('region', { name: 'Uppgifter till skrivaren' })
    expect(within(box).getByLabelText('Lösenord')).toHaveValue('s3cret')
    expect(within(box).getByLabelText('Server-URL (CloudPRNT)')).toHaveValue(PRINTER.serverUrl)
    await user.click(within(box).getByRole('button', { name: 'Klar, jag har skrivit in det' }))
    expect(screen.queryByDisplayValue('s3cret')).toBeNull()
  })

  it('offers a simulated printer only when the API allows it', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue({ ...EMPTY, simulatorAllowed: true })
    api.addPrinter.mockResolvedValue({ device: { ...PRINTER, kind: 'dryck', simulated: true, protocol: 'sim' } })
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Lägg till skrivare' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Sort' })).getByRole('radio', { name: 'Dryck' }))
    expect(screen.getByLabelText('Namn')).toHaveValue('Bar')
    await user.click(screen.getByRole('radio', { name: 'Simulerad' }))
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))
    expect(api.addPrinter).toHaveBeenCalledWith('loc-1', 'Bar', 'sim', 'dryck')
    expect(screen.queryByRole('region', { name: 'Uppgifter till skrivaren' })).toBeNull()
  })

  it('lets the owner go on without a printer: Inga skrivare än', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(EMPTY)
    api.setPrinterSetupSkipped.mockResolvedValue({ ...EMPTY.status, setupSkipped: true })
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Inga skrivare än' }))
    expect(api.setPrinterSetupSkipped).toHaveBeenCalledWith('loc-1', true)
    expect(await screen.findByText('Inga skrivare än', { selector: '.pset-later-pill' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ångra' })).toBeInTheDocument()
  })

  it('changes a printer from Kök to Dryck with one tap and shows what it gets', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.updatePrinter.mockResolvedValue({ ...ONE, devices: [{ ...PRINTER, kind: 'dryck' }] })
    render(<PrinterCard locationId="loc-1" isOwner />)
    const card = (await screen.findByRole('list', { name: 'Skrivare' })).querySelector('li')!
    expect(card).toHaveTextContent('Förrätter')
    await user.click(within(screen.getByRole('radiogroup', { name: 'Sort för Köket' })).getByRole('radio', { name: 'Dryck' }))
    expect(api.updatePrinter).toHaveBeenCalledWith('loc-1', PRINTER.deviceId, { kind: 'dryck' })
  })

  it('sends a whole category with one tap under Vad skickas vart?', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    const healed = { ...ROUTING, categories: { ...ROUTING.categories, c0a1b2c3d4: 'bar' } }
    api.saveCategoryRouting
      .mockResolvedValueOnce(healed) // Öl och vin hade inget val: Dryck när sidan öppnas
      .mockResolvedValue({ ...healed, categories: { ...healed.categories, mains: 'none' } })
    render(<PrinterCard locationId="loc-1" isOwner />)
    await vi.waitFor(() => expect(api.saveCategoryRouting).toHaveBeenCalledWith('loc-1', { c0a1b2c3d4: 'bar' }))
    const row = await screen.findByRole('radiogroup', { name: 'Varmrätter skickas till' })
    expect(within(row).getByRole('radio', { name: 'Kök' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(row).getByRole('radio', { name: 'Ingen bong' }))
    expect(api.saveCategoryRouting).toHaveBeenCalledWith('loc-1', { mains: 'none' })
    expect(await screen.findByRole('radiogroup', { name: 'Varmrätter skickas till' })).toHaveTextContent('Ingen bong')
  })

  it('turns off auto print with the version the screen showed', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.savePrintSettings.mockImplementation(async (_l, s) => ({ ...s, version: s.version + 1 }))
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByText('Mer inställningar'))
    await user.click(screen.getByRole('switch', { name: 'Skriv ut bongar automatiskt' }))
    await chooseOption(screen.getByLabelText('Pappersbredd'), '58')
    await user.click(screen.getByRole('button', { name: 'Spara skrivare' }))
    expect(api.savePrintSettings).toHaveBeenCalledWith('loc-1',
      { autoPrint: false, printerId: PRINTER.deviceId, paperWidth: 58, version: 1 })
    expect(await screen.findByText('Sparat. Automatisk utskrift är avstängd.')).toBeInTheDocument()
  })

  it('removes a printer after confirming and explains conflicts', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.removePrinter.mockRejectedValue(new ApiError(409, 'changed_retry'))
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Ta bort Köket' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Ta bort Kök · Köket?')
    await user.click(within(dialog).getByRole('button', { name: 'Ta bort' }))
    expect(api.removePrinter).toHaveBeenCalledWith('loc-1', PRINTER.deviceId)
    expect(await screen.findByText(/Någon annan ändrade samma inställning/)).toBeInTheDocument()
  })

  it('lets staff test print but not change anything', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.testPrint.mockResolvedValue(undefined)
    render(<PrinterCard locationId="loc-1" isOwner={false} />)
    await user.click(await screen.findByRole('button', { name: 'Testutskrift' }))
    expect(api.testPrint).toHaveBeenCalledWith('loc-1', PRINTER.deviceId)
    expect(screen.queryByRole('button', { name: 'Ta bort Köket' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lägg till skrivare' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Sort för Köket' })).toBeNull()
    expect(within(screen.getByRole('radiogroup', { name: 'Varmrätter skickas till' })).getByRole('radio', { name: 'Kök' })).toBeDisabled()
  })

  it('sends an older drink category with no choice to Dryck when the owner opens the page', async () => {
    api.getPrinting.mockResolvedValue({ ...EMPTY, routing: ROUTING })
    render(<PrinterCard locationId="loc-1" isOwner />)
    await vi.waitFor(() => expect(api.saveCategoryRouting).toHaveBeenCalledWith('loc-1', { c0a1b2c3d4: 'bar' }))
    expect(api.saveCategoryRouting).toHaveBeenCalledTimes(1)
  })

  it('leaves the routing alone for staff', async () => {
    api.getPrinting.mockResolvedValue({ ...EMPTY, routing: ROUTING })
    render(<PrinterCard locationId="loc-1" isOwner={false} />)
    await screen.findByText('Öl och vin')
    expect(api.saveCategoryRouting).not.toHaveBeenCalled()
  })
})
