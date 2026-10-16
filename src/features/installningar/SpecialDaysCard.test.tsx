import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpecialDaysCard } from './SpecialDaysCard'

const getLocation = vi.fn()
const updateLocation = vi.fn()
const listReservations = vi.fn()
vi.mock('./locationApi', async (orig) => ({
  ...(await orig<typeof import('./locationApi')>()),
  getLocation: (...a: unknown[]) => getLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
}))
vi.mock('../bokningar/bookingsApi', async (orig) => ({
  ...(await orig<typeof import('../bokningar/bookingsApi')>()),
  listReservations: (...a: unknown[]) => listReservations(...a),
}))
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant: null, locationId: 'loc-1' }),
  currentLocation: () => ({ locationId: 'loc-1', timezone: 'Europe/Stockholm' }),
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  getLocation.mockReset()
  updateLocation.mockReset()
  listReservations.mockReset()
  listReservations.mockResolvedValue([])
  updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
})
afterEach(() => vi.useRealTimers())

describe('SpecialDaysCard', () => {
  it('lists upcoming special days with their kind and note', async () => {
    getLocation.mockResolvedValue({
      locationId: 'loc-1',
      specialDays: [
        { date: '2026-10-11', kind: 'closed' },
        { date: '2026-12-24', kind: 'closed', note: 'Julafton' },
        { date: '2026-10-20', kind: 'hours', intervals: [{ opensAt: '17:00', closesAt: '22:00' }] },
      ],
    })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    expect(await screen.findByText(/Andra öppettider 17:00–22:00/)).toBeInTheDocument()
    expect(screen.getByText(/Stängt · ”Julafton”/)).toBeInTheDocument()
    // A passed day is not shown (and is dropped on the next save).
    expect(screen.queryByText(/Söndag 11 oktober/)).toBeNull()
  })

  it('adds a closed day with a note and saves the list', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    await screen.findByText('Inga avvikande dagar.')

    await user.type(screen.getByLabelText('Datum'), '2026-12-24')
    await user.type(screen.getByLabelText('Anteckning till gästerna (valfritt)'), 'Julafton')
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))
    expect(screen.getByText('Ej sparat - klicka Spara dagar.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara dagar' }))

    expect(updateLocation).toHaveBeenCalledWith('loc-1', {
      specialDays: [{ date: '2026-12-24', kind: 'closed', note: 'Julafton' }],
    })
    expect(await screen.findByText(/Sparat/)).toBeInTheDocument()
  })

  it('special hours need valid times', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    await screen.findByText('Inga avvikande dagar.')
    await user.type(screen.getByLabelText('Datum'), '2026-10-30')
    await user.selectOptions(screen.getByLabelText('Typ'), 'hours')
    await user.clear(screen.getByLabelText('Stänger (tid 1)'))
    await user.type(screen.getByLabelText('Stänger (tid 1)'), '16:00')
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Öppningstiden måste vara före stängningstiden.')
  })

  it('refuses a date twice and a passed date', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    getLocation.mockResolvedValue({ locationId: 'loc-1', specialDays: [{ date: '2026-12-24', kind: 'closed' }] })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    await screen.findByText(/Torsdag 24 december/)
    await user.type(screen.getByLabelText('Datum'), '2026-12-24')
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))
    expect(screen.getByRole('alert')).toHaveTextContent('finns redan')
  })

  it('warns about bookings on a day that is closed', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1', specialDays: [{ date: '2026-10-15', kind: 'closed' }] })
    listReservations.mockResolvedValue([
      { reservationId: 'a', status: 'reserved' },
      { reservationId: 'b', status: 'cancelled_by_guest' },
      { reservationId: 'c', status: 'pending' },
    ])
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    expect(await screen.findByText(/2 bokningar finns den dagen - de avbokas inte automatiskt/)).toBeInTheDocument()
    expect(listReservations).toHaveBeenCalledWith('loc-1', '2026-10-15')
  })

  it('closes online booking for today in one click', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Stäng onlinebokning idag' }))
    expect(screen.getByText(/Idag/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stäng onlinebokning idag' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Spara dagar' }))
    expect(updateLocation).toHaveBeenCalledWith('loc-1', {
      specialDays: [{ date: '2026-10-12', kind: 'no_online' }],
    })
  })

  it('offers no quick close when today already has special hours', async () => {
    getLocation.mockResolvedValue({
      locationId: 'loc-1',
      specialDays: [{ date: '2026-10-12', kind: 'hours', intervals: [{ opensAt: '12:00', closesAt: '16:00' }] }],
    })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    expect(await screen.findByText(/Idag/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stäng onlinebokning idag' })).toBeNull()
  })

  it('removing the last day saves an empty list as none', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    getLocation.mockResolvedValue({ locationId: 'loc-1', specialDays: [{ date: '2026-12-24', kind: 'closed' }] })
    render(<SpecialDaysCard locationId="loc-1" isOwner />)
    await user.click(await screen.findByRole('button', { name: 'Ta bort Torsdag 24 december' }))
    await user.click(screen.getByRole('button', { name: 'Spara dagar' }))
    expect(updateLocation).toHaveBeenCalledWith('loc-1', { specialDays: null })
  })
})
