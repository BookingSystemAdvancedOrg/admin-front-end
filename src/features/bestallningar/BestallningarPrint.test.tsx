import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BestallningarPage from './BestallningarPage'
import { printBannerText } from './printApi'
import { ApiError } from '../../shared/api'
import type { Order } from './ordersApi'
import type { PrintStatus } from './printApi'

const listOrders = vi.fn()
const getPrintStatus = vi.fn()
const reprintOrder = vi.fn()
vi.mock('./ordersApi', async (orig) => ({
  ...(await orig<typeof import('./ordersApi')>()),
  listOrders: (...a: unknown[]) => listOrders(...a),
}))
vi.mock('./printApi', async (orig) => ({
  ...(await orig<typeof import('./printApi')>()),
  getPrintStatus: (...a: unknown[]) => getPrintStatus(...a),
  reprintOrder: (...a: unknown[]) => reprintOrder(...a),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))

const ORDER: Order = {
  orderId: 'a'.repeat(32), locationId: 'loc-1', number: 7, status: 'confirmed', mode: 'pickup',
  lines: [{ menuItemId: 'pizza', name: 'Margherita', unitPrice: 12500, quantity: 2, total: 25000, vatRate: 6 }],
  totalAmount: 25000, customerName: 'Anna', confirmedAt: '2026-10-12T16:00:00Z',
}
const STATUS: PrintStatus = {
  autoPrint: true, printerConfigured: true, online: false, lastSeenAt: '2026-10-12T15:00:00Z',
  unprinted: 1, failed: 0, orders: { [ORDER.orderId]: 'PENDING' },
}

beforeEach(() => {
  listOrders.mockReset().mockResolvedValue({ date: '2026-10-12', ordering: { open: true }, orders: [ORDER] })
  getPrintStatus.mockReset().mockResolvedValue(STATUS)
  reprintOrder.mockReset()
})

describe('BestallningarPage printing', () => {
  it('builds the banner text', () => {
    expect(printBannerText(null)).toBeNull()
    expect(printBannerText({ ...STATUS, printerConfigured: false })).toBeNull()
    expect(printBannerText({ ...STATUS, online: true, unprinted: 0 })).toBeNull()
    expect(printBannerText({ ...STATUS, failed: 2 })).toBe(
      'Skrivaren svarar inte · 1 outskrivna · 2 kunde inte skrivas ut (tryck Skriv ut igen)')
  })

  it('shows the printer banner and the order state, and prints again', async () => {
    const user = userEvent.setup()
    reprintOrder.mockResolvedValue(undefined)
    render(<BestallningarPage />)
    expect(await screen.findByText('Skrivaren svarar inte · 1 outskrivna')).toBeInTheDocument()
    const nya = screen.getByRole('region', { name: 'Nya' })
    expect(within(nya).getByText('Ej utskriven')).toBeInTheDocument()
    await user.click(within(nya).getByRole('button', { name: 'Skriv ut igen' }))
    expect(reprintOrder).toHaveBeenCalledWith('loc-1', ORDER.orderId)
    expect(await screen.findByText('#7 skickad till skrivaren igen.')).toBeInTheDocument()
  })

  it('explains a reprint without a printer', async () => {
    const user = userEvent.setup()
    reprintOrder.mockRejectedValue(new ApiError(409, 'no_printer'))
    render(<BestallningarPage />)
    await user.click(await screen.findByRole('button', { name: 'Skriv ut igen' }))
    expect(await screen.findByText(/Ingen skrivare är vald/)).toBeInTheDocument()
  })

  it('hides printing when no printer is set up', async () => {
    getPrintStatus.mockResolvedValue({ ...STATUS, printerConfigured: false, orders: {} })
    render(<BestallningarPage />)
    await screen.findByText('#7')
    expect(screen.queryByRole('button', { name: 'Skriv ut igen' })).toBeNull()
  })

  it('never offers a reprint for a cancelled order', async () => {
    listOrders.mockResolvedValue({ date: '2026-10-12', ordering: { open: true },
      orders: [{ ...ORDER, status: 'cancelled', cancelledAt: '2026-10-12T16:10:00Z' }] })
    render(<BestallningarPage />)
    expect(await screen.findByText('Avslutade idag (1)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skriv ut igen' })).toBeNull()
  })

  it('explains a refused reprint of a cancelled order', async () => {
    const user = userEvent.setup()
    reprintOrder.mockRejectedValue(new ApiError(409, 'order_cancelled'))
    render(<BestallningarPage />)
    await user.click(await screen.findByRole('button', { name: 'Skriv ut igen' }))
    expect(await screen.findByText('Beställningen är avbruten och skrivs inte ut igen.')).toBeInTheDocument()
  })
})
