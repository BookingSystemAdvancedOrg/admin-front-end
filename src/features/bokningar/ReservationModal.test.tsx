import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { ReservationModal } from './ReservationModal'
import { NewReservationModal } from './NewReservationModal'
import type { Reservation } from './bookingsApi'

const changeStatus = vi.fn()
const paymentAction = vi.fn()
const updateReservation = vi.fn()
const getAvailability = vi.fn()
const createManualReservation = vi.fn()
vi.mock('./bookingsApi', async (orig) => ({
  ...(await orig<typeof import('./bookingsApi')>()),
  changeStatus: (...a: unknown[]) => changeStatus(...a),
  paymentAction: (...a: unknown[]) => paymentAction(...a),
  updateReservation: (...a: unknown[]) => updateReservation(...a),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
  createManualReservation: (...a: unknown[]) => createManualReservation(...a),
}))

function booking(over: Partial<Reservation> = {}): Reservation {
  return {
    reservationId: 'r1',
    locationId: 'loc-1',
    date: '2026-10-12',
    startTime: '19:00',
    endTime: '21:00',
    tableIds: ['3'],
    partySize: 2,
    status: 'reserved',
    customerName: 'Lamo',
    customerEmail: 'lamo@example.se',
    source: 'online',
    ...over,
  }
}

beforeEach(() => {
  for (const fn of [changeStatus, paymentAction, updateReservation, getAvailability, createManualReservation]) {
    fn.mockReset()
  }
})

describe('ReservationModal', () => {
  it('marks a guest as arrived', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    changeStatus.mockResolvedValue(booking({ status: 'arrived' }))
    render(<ReservationModal reservation={booking()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Anlänt' }))
    expect(changeStatus).toHaveBeenCalledWith('loc-1', 'r1', 'arrived', {})
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'arrived' }))
  })

  it('no-show charges the fee by default and can waive it', async () => {
    const user = userEvent.setup()
    changeStatus.mockResolvedValue(booking({ status: 'no_show_charged' }))
    const guaranteed = booking({ cardOnFile: true, guarantee: { noShowFee: 50000, lateCancelFee: 0 } })
    const { unmount } = render(
      <ReservationModal reservation={guaranteed} isOwner onChanged={() => {}} onClose={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    await user.click(screen.getByRole('button', { name: 'Uteblev - debitera 500 kr' }))
    expect(changeStatus).toHaveBeenLastCalledWith('loc-1', 'r1', 'no_show', { chargeFee: true })
    unmount()

    render(<ReservationModal reservation={guaranteed} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    await user.click(screen.getByLabelText(/Debitera no-show-avgiften 500 kr/))
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    expect(changeStatus).toHaveBeenLastCalledWith('loc-1', 'r1', 'no_show', { chargeFee: false })
  })

  it('shows the server reason when a status change is refused', async () => {
    const user = userEvent.setup()
    changeStatus.mockRejectedValue(new ApiError(409, 'grace_period_not_over'))
    render(<ReservationModal reservation={booking()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    await user.click(screen.getAllByRole('button', { name: 'Uteblev' }).at(-1)!)
    expect(await screen.findByRole('alert')).toHaveTextContent('grace period')
  })

  it('cancels and tells the guest unless unticked', async () => {
    const user = userEvent.setup()
    changeStatus.mockResolvedValue(booking({ status: 'cancelled_by_restaurant' }))
    render(<ReservationModal reservation={booking()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Avboka' }))
    await user.click(screen.getByLabelText('Meddela gästen'))
    await user.type(screen.getByLabelText(/Intern anteckning/), 'Stängt')
    await user.click(screen.getAllByRole('button', { name: 'Avboka' }).at(-1)!)
    expect(changeStatus).toHaveBeenCalledWith('loc-1', 'r1', 'cancelled', {
      notifyGuest: false,
      reason: 'Stängt',
    })
  })

  it('retries a failed charge and refunds (owner only)', async () => {
    const user = userEvent.setup()
    paymentAction.mockResolvedValue(booking({ status: 'no_show_charged' }))
    const failed = booking({
      status: 'no_show_charge_failed',
      payment: { kind: 'no_show', status: 'failed', amount: 50000, error: 'card_declined' },
    })
    const { unmount } = render(
      <ReservationModal reservation={failed} isOwner={false} onChanged={() => {}} onClose={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: 'Debitera avgiften igen' }))
    expect(paymentAction).toHaveBeenCalledWith('loc-1', 'r1', 'charge')
    unmount()

    const charged = booking({
      status: 'no_show_charged',
      payment: { kind: 'no_show', status: 'succeeded', amount: 50000 },
    })
    const staff = render(
      <ReservationModal reservation={charged} isOwner={false} onChanged={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Återbetala' })).toBeNull()
    staff.unmount()

    render(<ReservationModal reservation={charged} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Återbetala' }))
    await user.clear(screen.getByLabelText(/Belopp/))
    await user.type(screen.getByLabelText(/Belopp/), '200')
    await user.click(screen.getAllByRole('button', { name: 'Återbetala' }).at(-1)!)
    expect(paymentAction).toHaveBeenLastCalledWith('loc-1', 'r1', 'refund', 20000)
  })

  it('moves a booking to another time and table', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue([
      { startTime: '17:00', endTime: '19:00', layoutVersion: 1, tables: [{ tableId: '5', seats: 4 }] },
    ])
    updateReservation.mockResolvedValue(booking({ startTime: '17:00', tableIds: ['5'] }))
    const onChanged = vi.fn()
    render(<ReservationModal reservation={booking()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    await user.selectOptions(await screen.findByLabelText('Tid'), '17:00')
    await user.click(screen.getByLabelText(/Bord 5/))
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(updateReservation).toHaveBeenCalledWith('loc-1', 'r1', {
      startTime: '17:00',
      tableIds: ['5'],
      notifyGuest: true,
    })
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('NewReservationModal', () => {
  it('books a phone reservation', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue([
      { startTime: '19:00', endTime: '21:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
    ])
    createManualReservation.mockResolvedValue(booking({ reservationId: 'new' }))
    const onCreated = vi.fn()
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" onCreated={onCreated} onCancel={() => {}} />)
    await user.selectOptions(await screen.findByLabelText('Tid'), '19:00')
    await user.click(screen.getByLabelText(/Bord 2/))
    await user.type(screen.getByLabelText('Namn'), 'Anna')
    await user.type(screen.getByLabelText(/Telefon/), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(createManualReservation).toHaveBeenCalledWith('loc-1', {
      date: '2026-10-12',
      startTime: '19:00',
      tableIds: ['2'],
      partySize: 2,
      name: 'Anna',
      phone: '+46701234567',
      source: 'phone',
      notifyGuest: true,
    })
    expect(onCreated).toHaveBeenCalled()
  })

  it('keeps Boka disabled until a table and name are chosen', async () => {
    getAvailability.mockResolvedValue([])
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" onCreated={() => {}} onCancel={() => {}} />)
    expect(await screen.findByText('Inga lediga tider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boka' })).toBeDisabled()
  })

  it('drop-ins ask for the walk-in times (running slot included)', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue([])
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" onCreated={() => {}} onCancel={() => {}} />)
    await screen.findByText('Inga lediga tider')
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-10-12', { walkIn: false })
    await user.click(screen.getByRole('radio', { name: 'Drop-in' }))
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-10-12', { walkIn: true })
  })
})
