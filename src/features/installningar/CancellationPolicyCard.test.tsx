import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CancellationPolicyCard } from './CancellationPolicyCard'

const getLocation = vi.fn()
const updateLocation = vi.fn()
vi.mock('./locationApi', async (orig) => ({
  ...(await orig<typeof import('./locationApi')>()),
  getLocation: (...a: unknown[]) => getLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
}))

beforeEach(() => {
  getLocation.mockReset()
  updateLocation.mockReset()
})

describe('CancellationPolicyCard', () => {
  it('turns the card guarantee on with fees and a cutoff', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
    render(<CancellationPolicyCard locationId="loc-1" isOwner stripeReady />)

    const toggle = await screen.findByRole('switch', { name: 'Kortgaranti vid onlinebokning' })
    await user.click(toggle)
    await user.clear(screen.getByLabelText('Kort krävs från (antal personer)'))
    await user.type(screen.getByLabelText('Kort krävs från (antal personer)'), '4')
    await user.clear(screen.getByLabelText('Avgift sen avbokning (kr per person)'))
    await user.type(screen.getByLabelText('Avgift sen avbokning (kr per person)'), '100')
    await user.click(screen.getByRole('button', { name: 'Spara policy' }))

    expect(updateLocation).toHaveBeenCalledWith('loc-1', {
      guarantee: { enabled: true, minPartySize: 4, noShowFeePerPerson: 250, lateCancelFeePerPerson: 100,
        cancelCutoffHours: 24 },
    })
    expect(await screen.findByText('Sparat. Gäller nya bokningar.')).toBeInTheDocument()
    expect(screen.getByText(/kort från 4 pers/)).toBeInTheDocument()
  })

  it('refuses an enabled policy without any fee', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<CancellationPolicyCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('switch', { name: 'Kortgaranti vid onlinebokning' }))
    await user.clear(screen.getByLabelText('No-show-avgift (kr per person)'))
    await user.type(screen.getByLabelText('No-show-avgift (kr per person)'), '0')
    await user.click(screen.getByRole('button', { name: 'Spara policy' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ange en no-show-avgift')
    expect(updateLocation).not.toHaveBeenCalled()
  })

  it('warns when Stripe is not ready and is read-only for staff', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1', guarantee: { enabled: true, minPartySize: 2,
      noShowFeePerPerson: 200, lateCancelFeePerPerson: 0, cancelCutoffHours: 12 } })
    render(<CancellationPolicyCard locationId="loc-1" isOwner={false} stripeReady={false} />)
    expect(await screen.findByText(/Kräver att restaurangens Stripe-konto är klart/)).toBeInTheDocument()
    expect(await screen.findByText(/kort från 2 pers/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Kortgaranti vid onlinebokning' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara policy' })).toBeNull()
  })

  it('says clearly when a saved policy is switched off', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
    render(<CancellationPolicyCard locationId="loc-1" isOwner stripeReady />)
    expect(await screen.findByText(/kortgaranti är avstängd - gästerna bokar utan kort/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara policy' }))
    expect(await screen.findByText('Sparat - kortgarantin är avstängd.')).toBeInTheDocument()
    expect(updateLocation.mock.calls[0][1].guarantee.enabled).toBe(false)
  })

  it('flags unsaved changes until the policy is saved', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
    render(<CancellationPolicyCard locationId="loc-1" isOwner stripeReady />)
    await user.click(await screen.findByRole('switch', { name: 'Kortgaranti vid onlinebokning' }))
    expect(screen.getByText('Ej sparat - klicka Spara policy.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara policy' }))
    expect(await screen.findByText('Sparat. Gäller nya bokningar.')).toBeInTheDocument()
    expect(screen.queryByText('Ej sparat - klicka Spara policy.')).toBeNull()
  })
})
