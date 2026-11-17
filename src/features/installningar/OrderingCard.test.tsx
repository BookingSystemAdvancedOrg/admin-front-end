import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderingCard } from './OrderingCard'

const getLocation = vi.fn()
const updateLocation = vi.fn()
vi.mock('./locationApi', async (orig) => ({
  ...(await orig<typeof import('./locationApi')>()),
  getLocation: (...a: unknown[]) => getLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
}))

vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant: { name: 'Roma', locations: [{ locationId: 'loc-1', name: 'Roma' }] }, locationId: 'loc-1' }),
}))

const POLICY = { enabled: true, pickup: true, prepMinutes: 20, lastOrderMinutes: 15 }

beforeEach(() => {
  getLocation.mockReset()
  updateLocation.mockReset()
})

describe('OrderingCard', () => {
  it('turns pickup ordering on with a prep time', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('switch', { name: 'Ta emot beställningar (avhämtning)' }))
    await user.clear(screen.getByLabelText('Tillagningstid som gästen ser (min)'))
    await user.type(screen.getByLabelText('Tillagningstid som gästen ser (min)'), '25')
    await user.click(screen.getByRole('button', { name: 'Spara beställning' }))
    expect(updateLocation).toHaveBeenCalledWith('loc-1', { ordering: { ...POLICY, prepMinutes: 25 } })
    expect(await screen.findByText('Sparat. Gästerna kan beställa.')).toBeInTheDocument()
  })

  it('has no table ordering or QR codes any more', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: { ...POLICY, table: true } })
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    expect(await screen.findByRole('switch', { name: 'Ta emot beställningar (avhämtning)' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(screen.queryByText(/QR/)).toBeNull()
    expect(screen.queryByText(/vid bordet/i)).toBeNull()
  })

  it('shows a stored table-only policy as off and saves pickup without table', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: { ...POLICY, pickup: false, table: true } })
    updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
    render(<OrderingCard locationId="loc-1" isOwner stripeReady />)
    const sw = await screen.findByRole('switch', { name: 'Ta emot beställningar (avhämtning)' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    await user.click(screen.getByRole('button', { name: 'Spara beställning' }))
    expect(updateLocation).toHaveBeenCalledWith('loc-1', { ordering: POLICY })
  })

  it('is read-only for staff and warns without Stripe', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1', ordering: POLICY })
    render(<OrderingCard locationId="loc-1" isOwner={false} stripeReady={false} />)
    expect(await screen.findByText(/Kräver Stripe/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Ta emot beställningar (avhämtning)' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara beställning' })).not.toBeInTheDocument()
  })
})
