import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../shared/api'
import { ApiError } from '../../shared/api'
import {
  addDays,
  availableActions,
  changeStatus,
  dayLabel,
  errorMessage,
  feeSummary,
  formatKr,
  getAvailability,
  listReservations,
  paymentAction,
  todayIn,
} from './bookingsApi'
import type { Reservation } from './bookingsApi'

vi.mock('../../shared/api', async () => {
  const actual = await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn() }
})
const apiFetch = vi.mocked(api.apiFetch)

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
    ...over,
  }
}

beforeEach(() => apiFetch.mockReset())

describe('bookingsApi', () => {
  it('formats öre as kronor', () => {
    expect(formatKr(50000)).toBe('500 kr')
    expect(formatKr(12345)).toBe('123,45 kr')
    expect(formatKr(undefined)).toBe('0 kr')
  })

  it('handles dates', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(dayLabel('2026-10-12')).toBe('Måndag 12 oktober')
    expect(todayIn('Europe/Stockholm', new Date('2026-10-11T22:30:00Z'))).toBe('2026-10-12')
  })

  it('offers the right actions per status', () => {
    expect(availableActions(booking(), false)).toMatchObject({
      arrive: true, noShow: true, cancel: true, edit: true, retryCharge: false, refund: false,
    })
    expect(availableActions(booking({ status: 'arrived' }), false)).toMatchObject({
      arrive: false, undoArrive: true, edit: true,
    })
    expect(availableActions(booking({ status: 'no_show_charge_failed' }), false).retryCharge).toBe(true)
    const charged = booking({
      status: 'no_show_charged',
      payment: { kind: 'no_show', status: 'succeeded', amount: 50000, refundedAmount: 10000 },
    })
    expect(availableActions(charged, false).refund).toBe(false)
    expect(availableActions(charged, true)).toMatchObject({ refund: true, refundable: 40000 })
    expect(availableActions(booking({ status: 'cancelled_by_restaurant' }), true)).toMatchObject({
      arrive: false, cancel: false, edit: false, refund: false,
    })
  })

  it('summarises fees', () => {
    expect(feeSummary(booking())).toBeNull()
    expect(feeSummary(booking({ payment: { status: 'succeeded', amount: 20000 } }))).toBe('200 kr')
    expect(feeSummary(booking({ payment: { status: 'failed', amount: 20000 } }))).toBe('200 kr misslyckades')
  })

  it('maps server codes to Swedish messages', () => {
    expect(errorMessage(new ApiError(409, 'grace_period_not_over'))).toMatch(/grace period/)
    expect(errorMessage(new ApiError(402, 'authentication_required'))).toMatch(/godkänner/)
    expect(errorMessage(new ApiError(402, 'weird'))).toBe('Betalningen gick inte igenom (weird).')
    expect(errorMessage(new Error('x'))).toMatch(/Något gick fel/)
  })

  it('asks for walk-in times only for drop-ins', async () => {
    apiFetch.mockResolvedValue({ slots: [] })
    await getAvailability('loc-1', '2026-10-12')
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/availability?date=2026-10-12')
    await getAvailability('loc-1', '2026-10-12', { walkIn: true })
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/availability?date=2026-10-12&walkIn=true')
  })

  it('calls the staff routes', async () => {
    apiFetch.mockResolvedValueOnce({ items: [booking()] })
    expect(await listReservations('loc 1', '2026-10-12')).toHaveLength(1)
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc%201/reservations?date=2026-10-12')

    apiFetch.mockResolvedValueOnce(booking({ status: 'no_show' }))
    await changeStatus('loc-1', 'r1', 'no_show', { chargeFee: false })
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/reservations/r1/status', {
      method: 'POST', body: JSON.stringify({ status: 'no_show', chargeFee: false }),
    })

    apiFetch.mockResolvedValueOnce(booking())
    await paymentAction('loc-1', 'r1', 'refund', 1500)
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/reservations/r1/payment', {
      method: 'POST', body: JSON.stringify({ action: 'refund', amount: 1500 }),
    })
  })
})
