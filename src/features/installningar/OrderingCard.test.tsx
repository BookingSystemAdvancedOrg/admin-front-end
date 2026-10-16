import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderingCard } from './OrderingCard'

const getLocation = vi.fn()
const updateLocation = vi.fn()
const tableCodes = vi.fn()
vi.mock('./locationApi', async (orig) => ({
  ...(await orig<typeof import('./locationApi')>()),
  getLocation: (...a: unknown[]) => getLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
}))
vi.mock('../bestallningar/ordersApi', async (orig) => ({
  ...(await orig<typeof import('../bestallningar/ordersApi')>()),
  tableCodes: (...a: unknown[]) => tableCodes(...a),
}))
vi.mock('../../shared/tables', () => ({
  useTables: () => ({ tables: [{ tableId: 't1', label: '1', seats: 2 }, { tableId: 't2', label: 'Bar', seats: 4 }],
    labels: null, error: false }),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: async (url: string) => `data:image/png;base64,${btoa(url)}` } }))

const POLICY = { enabled: true, pickup: true, table: true, prepMinutes: 20, lastOrderMinutes: 15 }

beforeEach(() => {
  getLocation.mockReset()
  updateLocation.mockReset()
  tableCodes.mockReset()
})

describe('OrderingCard', () => {
  it('turns ordering on with a prep time', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('switch', { name: 'Ta emot beställningar' }))
    await user.clear(screen.getByLabelText('Tillagningstid som gästen ser (min)'))
    await user.type(screen.getByLabelText('Tillagningstid som gästen ser (min)'), '25')
    await user.click(screen.getByRole('button', { name: 'Spara beställning' }))
    expect(updateLocation).toHaveBeenCalledWith('loc-1', { ordering: { ...POLICY, prepMinutes: 25 } })
    expect(await screen.findByText('Sparat. Gästerna kan beställa.')).toBeInTheDocument()
  })

  it('needs at least one way to order', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('switch', { name: 'Avhämtning (beställ online, hämta i kassan)' }))
    await user.click(screen.getByRole('switch', { name: 'Beställning vid bordet (QR-kod)' }))
    await user.click(screen.getByRole('button', { name: 'Spara beställning' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Välj avhämtning')
    expect(updateLocation).not.toHaveBeenCalled()
  })

  it('makes a QR code per table from the signed codes', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    tableCodes.mockResolvedValue({ tables: [
      { tableId: 't1', label: '1', code: 'c1', url: 'https://roma.se/bestall?bord=c1' },
      { tableId: 't2', label: 'Bar', code: 'c2', url: 'https://roma.se/bestall?bord=c2' },
    ] })
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('button', { name: 'Skapa QR-koder (2 bord)' }))
    expect(tableCodes).toHaveBeenCalledWith('loc-1', [{ tableId: 't1', label: '1' }, { tableId: 't2', label: 'Bar' }])
    expect(await screen.findByAltText('QR-kod för Bord 1')).toBeInTheDocument()
    expect(screen.getByAltText('QR-kod för Bord Bar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skriv ut' })).toBeInTheDocument()
  })

  it('says when the restaurant has no site address yet', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    tableCodes.mockResolvedValue({ tables: [{ tableId: 't1', label: '1', code: 'c1', url: null }] })
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('button', { name: /Skapa QR-koder/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ingen webbadress')
  })

  it('is read-only for staff and warns without Stripe', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    render(<OrderingCard locationId="loc-1" isOwner={false} stripeReady={false} />)
    expect(await screen.findByText(/Kräver att restaurangens Stripe-konto är klart/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Ta emot beställningar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara beställning' })).not.toBeInTheDocument()
  })
})
