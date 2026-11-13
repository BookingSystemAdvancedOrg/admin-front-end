import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderingCard } from './OrderingCard'

const getLocation = vi.fn()
const updateLocation = vi.fn()
const listTableCodes = vi.fn()
vi.mock('./locationApi', async (orig) => ({
  ...(await orig<typeof import('./locationApi')>()),
  getLocation: (...a: unknown[]) => getLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
}))
vi.mock('../table-qr/tableQrApi', async (orig) => ({
  ...(await orig<typeof import('../table-qr/tableQrApi')>()),
  listTableCodes: (...a: unknown[]) => listTableCodes(...a),
}))
vi.mock('../../shared/tables', () => ({
  useTables: () => ({ tables: [{ tableId: 't1', label: '1', seats: 2 }, { tableId: 't2', label: 'Bar', seats: 4 }],
    labels: null, error: false }),
}))

vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant: { name: 'Roma', locations: [{ locationId: 'loc-1', name: 'Roma' }] }, locationId: 'loc-1' }),
}))

const POLICY = { enabled: true, pickup: true, table: true, prepMinutes: 20, lastOrderMinutes: 15 }

beforeEach(() => {
  getLocation.mockReset()
  updateLocation.mockReset()
  listTableCodes.mockReset()
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

  it('opens the QR cards of the published tables', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    listTableCodes.mockResolvedValue([
      { tableId: 't1', label: '1', title: 'Bord 1', seats: 2, code: 'a'.repeat(22), url: 'https://roma.booqy.se/bestall?bord=aaa' },
      { tableId: 't2', label: 'Bar', title: 'Bar', seats: 4, code: 'b'.repeat(22), url: 'https://roma.booqy.se/bestall?bord=bbb' },
    ])
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('button', { name: 'Visa och skriv ut QR-koder (2 bord)' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(listTableCodes).toHaveBeenCalledWith('loc-1', expect.any(Array))
    expect(await screen.findByRole('img', { name: 'QR-kort för Bord 1' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'QR-kort för Bar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skriv ut alla (2)' })).toBeInTheDocument()
  })

  it('says so when the restaurant has no site address yet', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    listTableCodes.mockResolvedValue([{ tableId: 't1', label: '1', title: 'Bord 1', seats: 2, code: 'c'.repeat(22), url: null }])
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('button', { name: /Visa och skriv ut QR-koder/ }))
    expect((await screen.findAllByText(/ingen webbadress/)).length).toBeGreaterThan(0)
  })

  it('is read-only for staff and warns without Stripe', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    render(<OrderingCard locationId="loc-1" isOwner={false} stripeReady={false} />)
    expect(await screen.findByText(/Kräver att restaurangens Stripe-konto är klart/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Ta emot beställningar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara beställning' })).not.toBeInTheDocument()
  })
})
