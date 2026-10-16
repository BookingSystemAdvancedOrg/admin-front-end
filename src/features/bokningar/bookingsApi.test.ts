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
  isStaleSlotError,
  listReservations,
  normalizePhone,
  paymentAction,
  todayIn,
  validEmail,
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

describe('guest fields (same rules as the server)', () => {
  it.each([
    ['070-123 45 67', '+46701234567'],
    ['0701234567', '+46701234567'],
    ['+46 (0)70 123 45 67', '+46701234567'],
    ['0046701234567', '+46701234567'],
    ['+46701234567', '+46701234567'],
    ['+358 40 123 4567', '+358401234567'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected)
  })

  it.each(['', '123', 'abc', '+0123456789', '07012345678901234'])('rejects %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull()
  })

  it('checks e-mail addresses', () => {
    expect(validEmail('anna@example.se')).toBe(true)
    expect(validEmail(' anna@example.se ')).toBe(true)
    expect(validEmail('anna@example')).toBe(false)
    expect(validEmail('anna example.se')).toBe(false)
  })

  it('explains refused times and fields in Swedish', () => {
    expect(errorMessage(new ApiError(400, 'startTime is not a bookable time for this date'))).toBe(
      'Den tiden går inte att boka längre. Välj en annan tid i listan.',
    )
    expect(errorMessage(new ApiError(400, 'phone must be a valid phone number, e.g. +46701234567'))).toMatch(/telefonnummer/i)
    expect(errorMessage(new ApiError(400, 'a walk-in is booked for today'))).toBe('En drop-in bokas alltid idag.')
    expect(errorMessage(new ApiError(400, 'a walk-in stays on its day'))).toBe(
      'En drop-in kan inte flyttas till en annan dag.',
    )
    expect(errorMessage(new ApiError(400, 'something new'))).toMatch(/something new/)
  })

  it('knows which errors mean the chosen time or table went away', () => {
    expect(isStaleSlotError(new ApiError(409, 'table_taken'))).toBe(true)
    expect(isStaleSlotError(new ApiError(400, 'startTime is not a bookable time for this date'))).toBe(true)
    expect(isStaleSlotError(new ApiError(400, "tableIds contains a table that isn't bookable at this time"))).toBe(true)
    expect(isStaleSlotError(new ApiError(400, 'partySize must be between 1 and 50'))).toBe(false)
    expect(isStaleSlotError(new ApiError(409, 'not_movable'))).toBe(false)
    expect(isStaleSlotError(new Error('x'))).toBe(false)
  })
})
