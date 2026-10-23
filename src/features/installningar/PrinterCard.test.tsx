import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrinterCard } from './PrinterCard'
import { ApiError } from '../../shared/api'
import type { PrintOverview } from '../bestallningar/printApi'

const api = {
  getPrinting: vi.fn(),
  savePrintSettings: vi.fn(),
  addPrinter: vi.fn(),
  removePrinter: vi.fn(),
  rotatePrinter: vi.fn(),
  testPrint: vi.fn(),
}
vi.mock('../bestallningar/printApi', async (orig) => ({
  ...(await orig<typeof import('../bestallningar/printApi')>()),
  getPrinting: (...a: unknown[]) => api.getPrinting(...a),
  savePrintSettings: (...a: unknown[]) => api.savePrintSettings(...a),
  addPrinter: (...a: unknown[]) => api.addPrinter(...a),
  removePrinter: (...a: unknown[]) => api.removePrinter(...a),
  rotatePrinter: (...a: unknown[]) => api.rotatePrinter(...a),
  testPrint: (...a: unknown[]) => api.testPrint(...a),
}))

const PRINTER = { deviceId: 'd'.repeat(32), name: 'Köket', online: true, lastSeenAt: '2026-10-12T16:00:00Z',
  serverUrl: `https://api.example/print/cloudprnt/${'d'.repeat(32)}` }
const EMPTY: PrintOverview = {
  settings: { autoPrint: false, printerId: null, paperWidth: 80, version: 0 },
  devices: [],
  status: { autoPrint: false, printerConfigured: false, online: false, unprinted: 0, failed: 0, orders: {} },
}
const ONE: PrintOverview = { ...EMPTY, settings: { ...EMPTY.settings, printerId: PRINTER.deviceId, version: 1 }, devices: [PRINTER] }

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()))

describe('PrinterCard', () => {
  it('adds a printer and shows its credentials once', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValueOnce(EMPTY).mockResolvedValue(ONE)
    api.addPrinter.mockResolvedValue({ device: PRINTER, username: PRINTER.deviceId, secret: 's3cret' })
    render(<PrinterCard locationId="loc-1" isOwner />)
    expect(await screen.findByText('Ingen skrivare är tillagd än.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Lägg till skrivare'), 'Köket')
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))
    expect(api.addPrinter).toHaveBeenCalledWith('loc-1', 'Köket')
    const box = await screen.findByRole('region', { name: 'Uppgifter till skrivaren' })
    expect(within(box).getByLabelText('Lösenord')).toHaveValue('s3cret')
    expect(within(box).getByLabelText('Server-URL (CloudPRNT)')).toHaveValue(PRINTER.serverUrl)
    await user.click(within(box).getByRole('button', { name: 'Klar, jag har skrivit in det' }))
    expect(screen.queryByDisplayValue('s3cret')).toBeNull()
  })

  it('turns on auto print with the version the screen showed', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.savePrintSettings.mockImplementation(async (_l, s) => ({ ...s, version: s.version + 1 }))
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('switch', { name: 'Skriv ut beställningar automatiskt' }))
    await user.selectOptions(screen.getByLabelText('Pappersbredd'), '58')
    await user.click(screen.getByRole('button', { name: 'Spara skrivare' }))
    expect(api.savePrintSettings).toHaveBeenCalledWith('loc-1',
      { autoPrint: true, printerId: PRINTER.deviceId, paperWidth: 58, version: 1 })
    expect(await screen.findByText('Sparat. Nya betalda beställningar skrivs ut.')).toBeInTheDocument()
  })

  it('removes a printer after confirming and explains conflicts', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.removePrinter.mockRejectedValue(new ApiError(409, 'changed_retry'))
    render(<PrinterCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Ta bort' }))
    await user.click(screen.getByRole('button', { name: 'Bekräfta: ta bort Köket' }))
    expect(api.removePrinter).toHaveBeenCalledWith('loc-1', PRINTER.deviceId)
    expect(await screen.findByText(/har just ändrats av någon annan/)).toBeInTheDocument()
  })

  it('lets staff test print but not change anything', async () => {
    const user = userEvent.setup()
    api.getPrinting.mockResolvedValue(ONE)
    api.testPrint.mockResolvedValue(undefined)
    render(<PrinterCard locationId="loc-1" isOwner={false} />)
    await user.click(await screen.findByRole('button', { name: 'Testutskrift' }))
    expect(api.testPrint).toHaveBeenCalledWith('loc-1', PRINTER.deviceId)
    expect(screen.queryByRole('button', { name: 'Ta bort' })).toBeNull()
    expect(screen.queryByLabelText('Lägg till skrivare')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Skriv ut beställningar automatiskt' })).toBeDisabled()
  })
})
