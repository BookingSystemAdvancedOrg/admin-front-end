import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { FloorBooking } from './FloorBooking'

const apiFetch = vi.fn()
vi.mock('../../shared/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/api')>()),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  isApiConfigured: () => true,
}))

const getAvailability = vi.fn()
const createManualReservation = vi.fn()
vi.mock('../bokningar/bookingsApi', async (orig) => ({
  ...(await orig<typeof import('../bokningar/bookingsApi')>()),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
  createManualReservation: (...a: unknown[]) => createManualReservation(...a),
  todayIn: () => '2026-11-13',
}))

vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({
    tenant: { locations: [{ locationId: 'loc-1', name: 'Sole', timezone: 'Europe/Stockholm' }] },
    locationId: 'loc-1',
    status: 'ready',
  }),
}))

const table = (id: string, x: number, seats: number) => ({
  elementId: id, type: 'table', x, y: 0, z: 2, width: 1.2, height: 0.75, depth: 0.8, rotationY: 0,
  floorId: 'f1', shape: 'rect', seats,
})
const LAYOUT = {
  floors: [{ floorId: 'f1', name: 'Entréplan', level: 0 }],
  elements: [table('t-a', 1, 4), table('t-b', 3, 2), table('t-c', 5, 6)],
}

beforeEach(() => {
  apiFetch.mockReset()
  getAvailability.mockReset()
  createManualReservation.mockReset()
  apiFetch.mockResolvedValue(LAYOUT)
  getAvailability.mockResolvedValue({
    slots: [
      { startTime: '18:00', endTime: '20:00', layoutVersion: 3, tables: [{ tableId: 't-a', seats: 4 }, { tableId: 't-b', seats: 2 }] },
      { startTime: '18:30', endTime: '20:30', layoutVersion: 3, tables: [{ tableId: 't-a', seats: 4 }] },
    ],
  })
})

function renderIt() {
  return render(
    <MemoryRouter>
      <FloorBooking />
    </MemoryRouter>,
  )
}

describe('FloorBooking', () => {
  it('books a free table as a walk-in with the chosen time', async () => {
    const user = userEvent.setup()
    createManualReservation.mockResolvedValue({ customerName: 'Anna', startTime: '18:30' })
    renderIt()
    // tables are numbered like the guest site: 1, 2, 3 in drawing order
    const first = await screen.findByRole('button', { name: /Bord 1, 4 pl, 2 lediga tider/ })
    expect(screen.getByRole('button', { name: /Bord 3, 6 pl, fullbokat/ })).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('radio', { name: 'Drop-in' }))
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-11-13', { walkIn: true })
    await user.click(await screen.findByRole('button', { name: /Bord 1, 4 pl, 2 lediga tider/ }))
    expect(first).toBeTruthy()
    const times = screen.getByRole('radiogroup', { name: 'Tid' })
    expect(within(times).getAllByRole('radio').map((r) => r.textContent)).toEqual(['18:00', '18:30'])
    await user.click(within(times).getByRole('radio', { name: '18:30' }))
    await user.type(screen.getByLabelText('Namn'), 'Anna')
    await user.click(screen.getByRole('button', { name: 'Boka bordet' }))

    expect(createManualReservation).toHaveBeenCalledWith('loc-1', {
      date: '2026-11-13',
      startTime: '18:30',
      tableIds: ['t-a'],
      partySize: 2,
      name: 'Anna',
      source: 'walk_in',
      notifyGuest: false,
    })
    expect(await screen.findByText('Bokat: Anna, bord 1 kl 18:30.')).toBeInTheDocument()
  })

  it('a phone booking that lost the race shows the server error and refetches the times', async () => {
    const user = userEvent.setup()
    createManualReservation.mockRejectedValue(new ApiError(409, 'table_taken'))
    renderIt()
    await user.click(await screen.findByRole('button', { name: /Bord 2, 2 pl/ }))
    await user.click(screen.getByRole('radio', { name: '18:00' }))
    await user.type(screen.getByLabelText('Namn'), 'Bo')
    const calls = getAvailability.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Boka bordet' }))
    expect(createManualReservation.mock.calls[0][1]).toMatchObject({ source: 'phone', tableIds: ['t-b'] })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(getAvailability.mock.calls.length).toBeGreaterThan(calls)
  })

  it('explains when no layout is published', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'not found'))
    renderIt()
    expect(await screen.findByText('Ingen bordskarta än')).toBeInTheDocument()
  })

  it('treats the empty plan the API returns before any activation as no layout', async () => {
    apiFetch.mockResolvedValue({ floors: [], elements: [] })
    renderIt()
    expect(await screen.findByText('Ingen bordskarta än')).toBeInTheDocument()
    expect(getAvailability).not.toHaveBeenCalled()
  })

  it('says the restaurant takes no bookings when availability is 404, not that a booking is missing', async () => {
    getAvailability.mockRejectedValue(new ApiError(404, 'location not found', { fromServer: true }))
    renderIt()
    expect(await screen.findByText(/tar inte emot bokningar just nu/)).toBeInTheDocument()
    expect(screen.queryByText(/Bokningen hittades inte/)).toBeNull()
  })
})
