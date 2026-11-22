import { render, screen, waitFor, within } from '@testing-library/react'
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

  it('keeps the visible table text inside the accessible name (axe label-content-name-mismatch)', async () => {
    renderIt()
    const first = await screen.findByRole('button', { name: /Bord 1, 4 pl, 2 lediga tider/ })
    // axe joins the two <text> nodes without a separator; "14 pl" would not be part of "Bord 1, 4 pl"
    expect(first.textContent).toBe('1 4 pl')
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

  it('opens on the linked table: its floor, its day, selected and highlighted', async () => {
    apiFetch.mockResolvedValue({
      floors: [{ floorId: 'f1', name: 'Entréplan', level: 0 }, { floorId: 'f2', name: 'Övervåning', level: 1 }],
      elements: [table('t-a', 1, 4), { ...table('t-up', 2, 2), floorId: 'f2' }],
    })
    render(
      <MemoryRouter>
        <FloorBooking focus={{ tableIds: ['t-up'], date: '2026-11-15' }} />
      </MemoryRouter>,
    )
    // numbered across floors like the guest site: the upstairs table is Bord 2
    const up = await screen.findByRole('button', { name: /^Bord 2, 2 pl/ })
    expect(up).toHaveAttribute('aria-pressed', 'true')
    expect(up.getAttribute('class')).toContain('is-focus')
    expect(screen.getByRole('tab', { name: 'Övervåning' })).toHaveAttribute('aria-selected', 'true')
    // the day's times are fetched in the effect after the commit that marks the table, so wait for it
    await waitFor(() => expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-11-15', { walkIn: false }))
    expect(screen.getByRole('heading', { name: 'Bord 2' })).toBeInTheDocument()
  })

  it('a booking at two tables highlights both, selects neither and marks their floor', async () => {
    apiFetch.mockResolvedValue({
      floors: [{ floorId: 'f1', name: 'Entréplan', level: 0 }, { floorId: 'f2', name: 'Övervåning', level: 1 }],
      elements: [table('t-a', 1, 4), { ...table('t-b', 3, 2), floorId: 'f2' }, { ...table('t-c', 5, 2), floorId: 'f2' }],
    })
    render(
      <MemoryRouter>
        <FloorBooking focus={{ tableIds: ['t-b', 't-c'], date: null }} />
      </MemoryRouter>,
    )
    const b = await screen.findByRole('button', { name: /^Bord 2, 2 pl/ })
    const c = screen.getByRole('button', { name: /^Bord 3, 2 pl/ })
    for (const el of [b, c]) {
      expect(el.getAttribute('class')).toContain('is-linked')
      expect(el).toHaveAttribute('aria-pressed', 'false')
    }
    const up = screen.getByRole('tab', { name: 'Övervåning' })
    expect(up).toHaveAttribute('aria-selected', 'true')
    expect(up.className).toContain('has-linked')
    expect(screen.getByRole('heading', { name: 'Bord 2 + 3' })).toBeInTheDocument()
  })

  it('the date field ends at today + 21, and a link to that day opens it', async () => {
    render(
      <MemoryRouter>
        <FloorBooking focus={{ tableIds: ['t-a'], date: '2026-12-04' }} />
      </MemoryRouter>,
    )
    const field = await screen.findByLabelText('Datum')
    expect(field).toHaveAttribute('data-max', '2026-12-04')
    expect(await screen.findByRole('heading', { name: 'Bord 1' })).toBeInTheDocument()
    await waitFor(() => expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-12-04', { walkIn: false }))
  })

  it('a link to a day past the booking window stays on today', async () => {
    render(
      <MemoryRouter>
        <FloorBooking focus={{ tableIds: ['t-a'], date: '2026-12-05' }} />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Bord 1' })).toBeInTheDocument()
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-11-13', { walkIn: false })
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
