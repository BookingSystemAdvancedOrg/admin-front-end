import { MemoryRouter } from 'react-router-dom'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BokningarPage from './BokningarPage'
import { todayIn } from './bookingsApi'
import type { Reservation } from './bookingsApi'
import { clearVersionLabelsCache } from '../../shared/bookingTables'

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
// Dagens ritning (GET /layout/active); null = inte hämtad, som när den inte går att nå.
let activeLabels: Map<string, string> | null = null
vi.mock('../../shared/tables', async (orig) => ({
  ...(await orig<typeof import('../../shared/tables')>()),
  useTables: () => ({ tables: null, labels: activeLabels, error: false }),
}))
const loadVersionPlans = vi.fn()
vi.mock('../layout-editor/activeLayout', async (orig) => ({
  ...(await orig<typeof import('../layout-editor/activeLayout')>()),
  loadVersionPlans: (...a: unknown[]) => loadVersionPlans(...a),
}))
const location = { locationId: 'loc-1', name: 'Roma', timezone: 'Europe/Stockholm' }
let tenantLocationId: string | null = 'loc-1'
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant: { role: 'owner_user', locations: [location] }, locationId: tenantLocationId, status: 'ready' }),
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
  tenantLocationId = 'loc-1'
  activeLabels = null
  loadVersionPlans.mockReset()
  clearVersionLabelsCache()
  listReservations.mockReset()
  changeStatus.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BokningarPage', () => {
  it("names a booking's tables in its own layout version, like the email", async () => {
    // Dagens ritning numrerar bordet 5; bokningen gäller version 2 där det är 6.
    activeLabels = new Map([['8ed5290e-t', '5']])
    listReservations.mockResolvedValue([booking({ tableIds: ['8ed5290e-t'], tableLabels: ['6'], layoutVersion: 2 })])
    const { container } = render(<MemoryRouter><BokningarPage /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Bord 6, visa i bordskartan' })).toBeInTheDocument()
    expect(screen.queryByText('Bord 5')).toBeNull()
    expect(container.textContent).not.toContain('8ed5290e')
    expect(loadVersionPlans).not.toHaveBeenCalled()
  })

  it("looks up an older booking's table in its version before calling it removed", async () => {
    activeLabels = new Map([['t-a', '1']])
    loadVersionPlans.mockResolvedValue({ current: 1, plans: new Map([[2, { floors: [], labels: new Map([['t-new', '8']]) }]]) })
    listReservations.mockResolvedValue([booking({ tableIds: ['t-new'], layoutVersion: 2 })])
    render(<MemoryRouter><BokningarPage /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Bord 8, visa i bordskartan' })).toBeInTheDocument()
    expect(screen.queryByText('Borttaget bord')).toBeNull()
    expect(loadVersionPlans).toHaveBeenCalledWith('loc-1')
  })

  it('shows the shared no-location card when the restaurant has no location', () => {
    tenantLocationId = null
    render(
      <MemoryRouter>
        <BokningarPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Ingen plats än' })).toBeInTheDocument()
    expect(listReservations).not.toHaveBeenCalled()
  })

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
    expect(screen.getAllByText('…').length).toBeGreaterThan(0)

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

    await user.click(screen.getByRole('button', { name: 'Ny bokning' }))
    await user.click(screen.getByRole('button', { name: 'Skapa (test)' }))
    expect(listReservations).toHaveBeenCalledTimes(2)

    await act(async () => second.resolve([booking({ reservationId: 'r9', date: today, customerName: 'Cecilia' })]))
    expect(await screen.findByText('Cecilia')).toBeInTheDocument()
    // The first, older answer (without the booking) is dropped.
    await act(async () => first.resolve([]))
    expect(screen.getByText('Cecilia')).toBeInTheDocument()
  })

  it('a booking waiting for the card shows until when it is held, in the list and after creating it', async () => {
    const user = userEvent.setup()
    const today = todayIn('Europe/Stockholm')
    const pending = booking({
      reservationId: 'r7',
      date: today,
      customerName: 'Nora',
      partySize: 6,
      startTime: '20:00',
      status: 'pending',
      timezone: 'Europe/Stockholm',
      pendingExpiresAt: '2026-10-12T16:32:00Z',
      guaranteeLink: { by: 'booqy', sends: 1, textedAt: '2026-10-12T16:00:00Z', canResend: true },
    })
    // Utan kortlänk (kortsteget på sajten): hela hållningen.
    const online = booking({
      reservationId: 'r9',
      date: today,
      customerName: 'Olle',
      startTime: '21:00',
      status: 'pending',
      timezone: 'Europe/Stockholm',
      pendingExpiresAt: '2026-10-12T16:47:00Z',
    })
    listReservations.mockResolvedValue([pending, online])
    created.mockReturnValue(pending)
    render(<BokningarPage />)
    expect(await screen.findByText('Nora')).toBeInTheDocument()
    expect(screen.getAllByText('Väntar på kort')).toHaveLength(2)
    // Gästen fick 30 minuter i sms:et; bokningen hålls 2 minuter till.
    expect(screen.getByText('hålls till 18:30')).toBeInTheDocument()
    expect(screen.getByText('hålls till 18:47')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ny bokning' }))
    await user.click(screen.getByRole('button', { name: 'Skapa (test)' }))
    const status = await screen.findByText('Kortlänk skickad')
    expect(status.closest('.peak')).toHaveTextContent(/20:00 · 6 pers · hålls till 18:30$/)
  })

  it('a booking that skipped the card for the start time says so', async () => {
    const user = userEvent.setup()
    listReservations.mockResolvedValue([])
    created.mockReturnValue(booking({ reservationId: 'r8', guaranteeSkipped: 'too_soon' }))
    render(<BokningarPage />)
    await user.click(screen.getByRole('button', { name: 'Ny bokning' }))
    await user.click(screen.getByRole('button', { name: 'Skapa (test)' }))
    expect(await screen.findByText('Bokad utan kort (för nära starttiden)')).toBeInTheDocument()
  })
})
