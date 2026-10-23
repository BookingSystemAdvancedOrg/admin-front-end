import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingTimeCard } from './BookingTimeCard'

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
  updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', gracePeriodHours: 0.25, ...body }))
})

describe('BookingTimeCard', () => {
  it('shows an older location its current length and saves new rules with a buffet', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', bookingDurationHours: 2, gracePeriodHours: 0.25 })
    render(<BookingTimeCard locationId="loc-1" isOwner />)
    expect(await screen.findByText(/Nu: 2 tim per bokning, ingen förlängning/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Standardlängd'), '90')
    await user.click(screen.getByLabelText('Personalen får förlänga bokningar om bordet är ledigt'))
    await user.click(screen.getByRole('button', { name: '+ Lägg till specialtid' }))
    await user.click(screen.getByRole('button', { name: 'Spara bokningstid' }))

    expect(updateLocation).toHaveBeenCalledTimes(1)
    const [, body] = updateLocation.mock.calls[0]
    expect(body.bookingDurationHours).toBe(1.5)
    expect(body.bookingTimeRules).toMatchObject({
      defaultMinutes: 90,
      extension: { allowed: true, maxMinutes: 30 },
      lastSeatingMinutes: 120,
      windows: [{ name: 'Lunchbuffé', durationMinutes: 60, extension: { allowed: false, maxMinutes: 0 } }],
    })
    expect(await screen.findByText(/befintliga behåller sin tid/)).toBeInTheDocument()
  })

  it('refuses overlapping windows with the same priority before saving', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1', bookingDurationHours: 2, gracePeriodHours: 0.25 })
    render(<BookingTimeCard locationId="loc-1" isOwner />)
    await screen.findByText(/Nu: 2 tim/)
    await user.click(screen.getByRole('button', { name: '+ Lägg till specialtid' }))
    await user.click(screen.getByRole('button', { name: '+ Lägg till specialtid' }))
    await user.click(screen.getByRole('button', { name: 'Spara bokningstid' }))
    expect(screen.getByRole('alert')).toHaveTextContent('samma prioritet')
    expect(updateLocation).not.toHaveBeenCalled()
  })

  it('is read only for staff', async () => {
    getLocation.mockResolvedValue({
      locationId: 'loc-1', bookingDurationHours: 1.5, gracePeriodHours: 0.25,
      bookingTimeRules: { defaultMinutes: 90, extension: { allowed: true, maxMinutes: 30 }, lastSeatingMinutes: 120, windows: [] },
    })
    render(<BookingTimeCard locationId="loc-1" isOwner={false} />)
    expect(await screen.findByText('Bara restaurangens ägare kan ändra bokningstiden.')).toBeInTheDocument()
    expect(screen.getByLabelText('Standardlängd')).toBeDisabled()
  })
})
