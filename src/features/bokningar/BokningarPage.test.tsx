import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BokningarPage from './BokningarPage'
import { todayIn } from './bookingsApi'
import type { Reservation } from './bookingsApi'

const listReservations = vi.fn()
const changeStatus = vi.fn()
vi.mock('./bookingsApi', async (orig) => ({
  ...(await orig<typeof import('./bookingsApi')>()),
  listReservations: (...a: unknown[]) => listReservations(...a),
  changeStatus: (...a: unknown[]) => changeStatus(...a),
}))
vi.mock('../../shared/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/api')>()),
  isApiConfigured: () => true,
}))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))
const created = vi.fn()
vi.mock('./NewReservationModal', () => ({
  NewReservationModal: ({ onCreated }: { onCreated: (r: Reservation) => void }) => (
    <button type="button" onClick={() => onCreated(created())}>
      Skapa (test)
    </button>
  ),
}))
const location = { locationId: 'loc-1', name: 'Roma', timezone: 'Europe/Stockholm' }
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant: { role: 'owner_user', locations: [location] }, locationId: 'loc-1' }),
  currentLocation: () => location,
}))

function booking(over: Partial<Reservation> = {}): Reservation {
  return {
    reservationId: 'r1',
    locationId: 'loc-1',
    date: todayIn('Europe/Stockholm'),
    startTime: '19:00',
    endTime: '21:00',
    tableIds: ['3'],
    partySize: 2,
    status: 'reserved',
    customerName: 'Lamo',
    source: 'phone',
    ...over,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  listReservations.mockReset()
  changeStatus.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BokningarPage', () => {
  it("never shows another day's bookings under the wrong heading", async () => {
    const user = userEvent.setup()
    const first = deferred<Reservation[]>()
    const second = deferred<Reservation[]>()
    listReservations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<BokningarPage />)

    await act(async () => first.resolve([booking({ customerName: 'Anna' })]))
    expect(await screen.findByText('Anna')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Nästa dag' }))
    expect(screen.queryByText('Anna')).toBeNull()
    expect(screen.getAllByText('Hämtar…').length).toBeGreaterThan(0)

    await act(async () => second.resolve([booking({ reservationId: 'r2', customerName: 'Bertil' })]))
    expect(await screen.findByText('Bertil')).toBeInTheDocument()
    expect(listReservations.mock.calls[1][1]).not.toBe(listReservations.mock.calls[0][1])
  })

  it('ignores a slow answer for a day you already left', async () => {
    const user = userEvent.setup()
    const slow = deferred<Reservation[]>()
    const fast = deferred<Reservation[]>()
    listReservations.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    render(<BokningarPage />)

    await user.click(screen.getByRole('button', { name: 'Nästa dag' }))
    await act(async () => fast.resolve([booking({ reservationId: 'r2', customerName: 'Bertil' })]))
    expect(await screen.findByText('Bertil')).toBeInTheDocument()

    await act(async () => slow.resolve([booking({ customerName: 'Anna' })]))
    expect(screen.getByText('Bertil')).toBeInTheDocument()
    expect(screen.queryByText('Anna')).toBeNull()
  })

  it('a refresh that started before a change does not undo it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const refresh = deferred<Reservation[]>()
    // After the old refresh, the save's own refetch runs (it is queued, not dropped) and sees the change.
    listReservations.mockResolvedValueOnce([booking()]).mockReturnValueOnce(refresh.promise)
      .mockResolvedValue([booking({ status: 'arrived' })])
    changeStatus.mockResolvedValue(booking({ status: 'arrived' }))
    const { container } = render(<BokningarPage />)
    const row = () => container.querySelector('.bookings-table tbody tr') as HTMLElement

    expect(await screen.findByText('Lamo')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(listReservations).toHaveBeenCalledTimes(2)

    await user.click(row())
    await user.click(screen.getByRole('button', { name: 'Anlänt' }))
    expect(within(row()).getByText('Anlänt')).toBeInTheDocument()

    await act(async () => refresh.resolve([booking()]))
    expect(within(row()).getByText('Anlänt')).toBeInTheDocument()
    expect(listReservations).toHaveBeenCalledTimes(3)
  })

  it('keeps the list quietly when a live refresh fails, and picks up changes on the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    listReservations
      .mockResolvedValueOnce([booking()])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([booking(), booking({ reservationId: 'r2', customerName: 'Nadia', startTime: '20:00' })])
    render(<BokningarPage />)
    expect(await screen.findByText('Lamo')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    expect(listReservations).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Lamo')).toBeInTheDocument()
    // Efter ett fel väntar nästa hämtning längre (30 s), sedan kommer den nya bokningen av sig själv.
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    expect(listReservations).toHaveBeenCalledTimes(2)
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(await screen.findByText('Nadia')).toBeInTheDocument()
  })

  it('a booking made before the day list arrived still shows up', async () => {
    const user = userEvent.setup()
    const first = deferred<Reservation[]>()
    const second = deferred<Reservation[]>()
    listReservations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const today = todayIn('Europe/Stockholm')
    created.mockReturnValue(booking({ reservationId: 'r9', date: today, customerName: 'Cecilia' }))
    render(<BokningarPage />)

    await user.click(screen.getByRole('button', { name: '+ Ny bokning' }))
    await user.click(screen.getByRole('button', { name: 'Skapa (test)' }))
    expect(listReservations).toHaveBeenCalledTimes(2)

    await act(async () => second.resolve([booking({ reservationId: 'r9', date: today, customerName: 'Cecilia' })]))
    expect(await screen.findByText('Cecilia')).toBeInTheDocument()
    // The first, older answer (without the booking) is dropped.
    await act(async () => first.resolve([]))
    expect(screen.getByText('Cecilia')).toBeInTheDocument()
  })
})
