import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../shared/api'
import { ApiError } from '../../shared/api'
import {
  BOOKING_HORIZON_DAYS,
  addDays,
  availableActions,
  changeStatus,
  cardDeadline,
  clockLabel,
  createErrorMessage,
  createManualReservation,
  dayLabel,
  errorMessage,
  LOCATION_NOT_BOOKABLE,
  RESERVATION_NOT_FOUND,
  feeSummary,
  formatKr,
  mockPartyChange,
  getAvailability,
  isSmsLimitText,
  isStaleSlotError,
  lastBookableDate,
  listReservations,
  mockReservations,
  noCardOffer,
  normalizePhone,
  paymentAction,
  phoneFieldError,
  resendGuaranteeLink,
  updateReservation,
  smsLimitText,
  staffPhone,
  todayIn,
  validEmail,
} from './bookingsApi'
import type { Reservation } from './bookingsApi'

vi.mock('../../shared/api', async () => {
  const actual = await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn(), isApiConfigured: vi.fn(() => true) }
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

  it('books today through today + 21 (22 dates): Fri 20 Nov 2026 ends Fri 11 Dec', () => {
    expect(BOOKING_HORIZON_DAYS).toBe(21)
    expect(lastBookableDate('2026-11-20')).toBe('2026-12-11')
    expect(lastBookableDate('2026-12-20')).toBe('2027-01-10')
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

  it('a booking waiting for the card can be cancelled and its link sent again', () => {
    const pending = booking({ status: 'pending', guaranteeLink: { by: 'booqy', sends: 1, canResend: true } })
    expect(availableActions(pending, false)).toMatchObject({
      arrive: false, noShow: false, cancel: true, edit: false, resend: true,
    })
    expect(availableActions(booking({ status: 'pending' }), false).resend).toBe(false)
    expect(availableActions(booking({ status: 'pending', guaranteeLink: { canResend: false } }), false).resend).toBe(false)
    expect(availableActions(booking({ guaranteeLink: { canResend: true } }), false).resend).toBe(false)
  })

  it('shows clock times in the booking time zone', () => {
    expect(clockLabel('2026-10-12T16:32:00Z', 'Europe/Stockholm')).toBe('18:32')
    expect(clockLabel('2026-10-12T16:32:00Z', 'Europe/London')).toBe('17:32')
    expect(clockLabel(undefined)).toBe('')
    expect(clockLabel('nonsense')).toBe('')
  })

  it('the example data has a phone booking waiting for the card', () => {
    const pending = mockReservations('2026-10-12').find((r) => r.status === 'pending')
    expect(pending).toMatchObject({ source: 'phone', customerPhone: '+46701112233', guaranteeLink: { by: 'booqy', canResend: true } })
    expect(Date.parse(pending!.pendingExpiresAt!)).toBeGreaterThan(Date.now())
  })

  it('the example data belongs to the page location, so an edit stays in the list', async () => {
    vi.mocked(api.isApiConfigured).mockReturnValueOnce(false)
    const items = await listReservations('local-demo-1', '2026-10-12')
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((r) => r.locationId === 'local-demo-1')).toBe(true)
  })

  it('summarises fees', () => {
    expect(feeSummary(booking())).toBeNull()
    expect(feeSummary(booking({ payment: { status: 'succeeded', amount: 20000 } }))).toBe('200 kr')
    expect(feeSummary(booking({ payment: { status: 'failed', amount: 20000 } }))).toBe('200 kr drogs inte')
  })

  it('says a 404 is the booking only where it is about a booking', () => {
    const notFound = new ApiError(404, 'location not found', { fromServer: true })
    expect(errorMessage(notFound)).toBe(RESERVATION_NOT_FOUND)
    // API Gatewayns egen 404 (appen och API:t i otakt) är Booqys fel, inte en borttagen bokning.
    expect(errorMessage(new ApiError(404, 'Not Found', { code: 'route_not_found', fromServer: true }))).toMatch(/Felet ligger hos Booqy/)
    expect(errorMessage(notFound, 'Kunde inte hämta lediga tider.', LOCATION_NOT_BOOKABLE)).toBe(LOCATION_NOT_BOOKABLE)
    expect(LOCATION_NOT_BOOKABLE).not.toMatch(/Bokningen hittades inte/)
  })

  it('maps server codes to Swedish messages', () => {
    expect(errorMessage(new ApiError(409, 'grace_period_not_over'))).toMatch(/tiden för sena gäster/)
    expect(errorMessage(new ApiError(402, 'authentication_required'))).toMatch(/godkänner/)
    expect(errorMessage(new ApiError(402, 'weird', { fromServer: true }))).toMatch(/^Betalningen gick inte igenom\. /)
    expect(errorMessage(new ApiError(402, 'weird', { fromServer: true }))).not.toMatch(/weird/)
    expect(errorMessage(new Error('x'))).toBe('Bokningen sparades inte. Felet ligger hos Booqy, inte hos er. Försök igen, eller tryck Rapportera till Booqy.')
    expect(errorMessage(new ApiError(400, 'name must be at most 80 characters', { fromServer: true }))).toMatch(/högst/)
    expect(errorMessage(new ApiError(400, 'tags must be a list', { fromServer: true, code: 'invalid_value', field: 'tags' })))
      .toBe('Bokningen sparades inte. Ett av fälten ser inte rätt ut. Kolla fälten och försök igen.')
  })

  it('asks for walk-in times only for drop-ins', async () => {
    apiFetch.mockResolvedValue({ slots: [] })
    await getAvailability('loc-1', '2026-10-12')
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/availability?date=2026-10-12')
    await getAvailability('loc-1', '2026-10-12', { walkIn: true })
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/availability?date=2026-10-12&walkIn=true')
  })

  it('lists example bookings without an API (local development)', async () => {
    vi.mocked(api.isApiConfigured).mockReturnValueOnce(false)
    const list = await listReservations('mock', '2026-10-12')
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((r) => r.date === '2026-10-12')).toBe(true)
    expect(apiFetch).not.toHaveBeenCalled()
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
    await paymentAction('loc-1', 'r1', 'refund', { amount: 1500, reason: 'Sjuk', notifyGuest: false })
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/reservations/r1/payment', {
      method: 'POST', body: JSON.stringify({ action: 'refund', amount: 1500, reason: 'Sjuk', notifyGuest: false }),
    })

    apiFetch.mockResolvedValueOnce(booking({ status: 'pending' }))
    await resendGuaranteeLink('loc-1', 'r 1')
    expect(apiFetch).toHaveBeenLastCalledWith('/locations/loc-1/reservations/r%201/guarantee-link', { method: 'POST' })
  })

  const MANUAL = {
    date: '2026-10-12', startTime: '19:00', tableIds: ['3'], partySize: 2, name: 'Anna',
    phone: '+46701234567', source: 'phone' as const, guarantee: 'sms' as const,
  }

  it('an older server without the card link sms books once more without guarantee', async () => {
    apiFetch
      .mockRejectedValueOnce(new ApiError(400, 'guarantee must be link', { fromServer: true }))
      .mockResolvedValueOnce(booking())
    await createManualReservation('loc-1', MANUAL)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(apiFetch.mock.calls[0][1]!.body as string)).toMatchObject({ guarantee: 'sms' })
    expect(JSON.parse(apiFetch.mock.calls[1][1]!.body as string)).not.toHaveProperty('guarantee')
  })

  it('an older server also books Boka utan kort once more without guarantee', async () => {
    apiFetch
      .mockRejectedValueOnce(new ApiError(400, 'guarantee must be link', { fromServer: true }))
      .mockResolvedValueOnce(booking())
    await createManualReservation('loc-1', { ...MANUAL, guarantee: 'waived' })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(apiFetch.mock.calls[0][1]!.body as string)).toMatchObject({ guarantee: 'waived' })
    expect(JSON.parse(apiFetch.mock.calls[1][1]!.body as string)).not.toHaveProperty('guarantee')
  })

  it('other refusals of a new booking are not retried', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(400, 'guarantee sms needs a mobile number', { fromServer: true }))
    await expect(createManualReservation('loc-1', MANUAL)).rejects.toThrow('guarantee sms needs a mobile number')
    apiFetch.mockRejectedValueOnce(new ApiError(400, 'guarantee must be link', { fromServer: true }))
    await expect(createManualReservation('loc-1', { ...MANUAL, guarantee: undefined })).rejects.toThrow('guarantee must be link')
    expect(apiFetch).toHaveBeenCalledTimes(2)
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
    ['08-123 45 67', '+4681234567'],
    ['+46 070 123 45 67', '+46701234567'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected)
  })

  it.each(['', '123', 'abc', '+0123456789', '07012345678901234', '070123456', '07012345678', '08123', '+4612345678901'])('rejects %s', (raw) => {
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
    expect(errorMessage(new ApiError(400, 'phone must be a valid phone number, e.g. +46701234567'))).toMatch(/Telefonnumret ser fel ut\. Skriv det så här: 070 123 45 67/)
    expect(errorMessage(new ApiError(400, 'a walk-in is booked for today'))).toBe('En drop-in gäller alltid idag. Välj dagens datum.')
    expect(errorMessage(new ApiError(400, 'a walk-in stays on its day'))).toBe(
      'En drop-in kan inte flyttas till en annan dag. Gör en ny bokning i stället.',
    )
    expect(errorMessage(new ApiError(400, 'something new', { fromServer: true }))).not.toMatch(/something new/)
  })

  it('the phone is required for Telefon and optional for Drop-in', () => {
    expect(staffPhone('phone', '', false)).toEqual({ phone: null, error: null, ok: false })
    expect(staffPhone('phone', ' ', true)).toEqual({ phone: null, error: 'Skriv gästens telefonnummer.', ok: false })
    expect(staffPhone('walk_in', '', true)).toEqual({ phone: null, error: null, ok: true })
    expect(staffPhone('phone', '070-123 45 67', true)).toEqual({ phone: '+46701234567', error: null, ok: true })
    for (const channel of ['phone', 'walk_in'] as const) {
      expect(staffPhone(channel, '0701', false)).toEqual({
        phone: null, error: 'Numret ser fel ut. Skriv det så här: 070 123 45 67.', ok: false,
      })
    }
  })

  it('puts the server answers about the phone at the phone field', () => {
    const bad = (m: string) => new ApiError(400, m, { fromServer: true })
    expect(phoneFieldError(bad('phone is required for a phone booking'))).toBe('Skriv gästens telefonnummer.')
    expect(phoneFieldError(bad("guarantee sms needs the guest's phone number"))).toBe('Skriv gästens telefonnummer.')
    expect(phoneFieldError(bad('phone must be a valid phone number, e.g. +46701234567'))).toBe('Numret ser fel ut. Skriv det så här: 070 123 45 67.')
    expect(phoneFieldError(bad('guarantee sms needs a mobile number'))).toBe('Kortlänken skickas med sms. Skriv ett mobilnummer, till exempel 070 123 45 67.')
    expect(phoneFieldError(bad("guarantee sms needs the guest's own mobile number"))).toBe('Skriv gästens eget mobilnummer.')
    expect(phoneFieldError(new ApiError(429, 'sms_limit', { fromServer: true }))).toBe('Taket för kortlänkar är nått. Boka utan kort.')
    expect(phoneFieldError(new ApiError(502, 'sms_failed', { fromServer: true }))).toBeNull()
    expect(phoneFieldError(new ApiError(409, 'table_taken'))).toBeNull()
    expect(phoneFieldError(new Error('x'))).toBeNull()
  })

  it('offers Boka utan kort only when the sms is what fails', () => {
    expect(noCardOffer(new ApiError(400, 'guarantee sms needs a mobile number', { fromServer: true }))).toBe(true)
    expect(noCardOffer(new ApiError(502, 'sms_failed', { fromServer: true }))).toBe(true)
    expect(noCardOffer(new ApiError(503, 'sms_unavailable', { fromServer: true }))).toBe(true)
    expect(noCardOffer(new ApiError(429, 'sms_limit', { fromServer: true }))).toBe(true)
    expect(noCardOffer(new ApiError(400, "guarantee sms needs the guest's own mobile number", { fromServer: true }))).toBe(false)
    expect(noCardOffer(new ApiError(400, 'phone is required for a phone booking', { fromServer: true }))).toBe(false)
    expect(noCardOffer(new ApiError(409, 'table_taken'))).toBe(false)
  })

  it('a failed card link sms is Booqys fault, never the number', () => {
    const failed = createErrorMessage(new ApiError(502, 'sms_failed', { fromServer: true }))
    expect(failed).toMatch(/^Sms:et med kortlänken kunde inte skickas, så inget bokades\. Felet ligger hos Booqy/)
    expect(failed).not.toMatch(/Kolla numret/)
    expect(createErrorMessage(new ApiError(503, 'sms_unavailable', { fromServer: true }))).toMatch(/^Sms kunde inte skickas, så inget bokades\. Felet ligger hos Booqy/)
    expect(errorMessage(new ApiError(502, 'sms_failed', { fromServer: true }))).toMatch(/^Sms:et med kortlänken kunde inte skickas\. Felet ligger hos Booqy/)
    expect(createErrorMessage(new ApiError(409, 'table_taken'))).toBe('Någon hann boka bordet. Välj ett annat bord eller en annan tid.')
  })

  it('the sms limit promises only the wait the server names', () => {
    const limited = (retryAfter?: number) => new ApiError(429, 'sms_limit', { fromServer: true, retryAfter })
    expect(smsLimitText(limited())).toBe('Taket för kortlänkar är nått. Boka utan kort.')
    expect(smsLimitText(limited(600))).toBe('Många kortlänkar har skickats på kort tid. Boka utan kort, eller försök igen om 10 min.')
    expect(smsLimitText(limited(3600))).toMatch(/försök igen om 60 min\.$/)
    expect(smsLimitText(limited(5 * 3600))).toBe('Taket för kortlänkar i dag är nått. Boka utan kort.')
    for (const t of [limited(), limited(600), limited(5 * 3600)].map(smsLimitText)) expect(isSmsLimitText(t)).toBe(true)
    expect(isSmsLimitText('Skriv gästens eget mobilnummer.')).toBe(false)
    expect(errorMessage(limited())).toBe('Taket för kortlänkar är nått, så länken skickades inte igen.')
    expect(errorMessage(limited(120))).toBe('Många kortlänkar har skickats på kort tid. Försök igen om 2 min.')
    expect(errorMessage(limited(20 * 3600))).toBe('Taket för kortlänkar i dag är nått, så länken skickades inte igen.')
    expect(errorMessage(limited())).not.toMatch(/en stund/)
  })

  it('sms unavailable on a resend is Booqys fault, not an unsaved booking', () => {
    const text = errorMessage(new ApiError(503, 'sms_unavailable', { fromServer: true }), 'Länken skickades inte igen.')
    expect(text).toMatch(/^Sms kan inte skickas just nu\. Felet ligger hos Booqy/)
    expect(text).not.toMatch(/Bokningen sparades inte/)
  })

  it('a card link holds until the time the guest was told, 2 minutes before the hold ends', () => {
    const at = '2026-10-12T16:32:00Z'
    expect(cardDeadline({ pendingExpiresAt: at, guaranteeLink: { by: 'booqy' } })).toBe('2026-10-12T16:30:00.000Z')
    expect(cardDeadline({ pendingExpiresAt: at })).toBe(at)
    expect(cardDeadline({ guaranteeLink: { by: 'booqy' } })).toBeUndefined()
  })

  it('explains the resend refusals', () => {
    expect(errorMessage(new ApiError(409, 'resend_limit', { fromServer: true }))).toBe(
      'Länken är redan skickad 3 gånger. Kolla numret med gästen, eller avboka och gör en ny bokning.',
    )
    expect(errorMessage(new ApiError(409, 'link_closed', { fromServer: true }))).toMatch(/^Tiden för kortet går snart ut/)
    expect(errorMessage(new ApiError(409, 'not_pending', { fromServer: true }))).toMatch(/^Bokningen väntar inte på kort längre/)
    expect(errorMessage(new ApiError(409, 'not_textable', { fromServer: true }))).toMatch(/^Numret tar inte emot sms/)
  })

  it('maps the new phone rules ahead of the online contact rule', () => {
    expect(errorMessage(new ApiError(400, 'phone is required for a phone booking', { fromServer: true }))).toBe('Skriv gästens telefonnummer.')
    expect(errorMessage(new ApiError(400, 'phone is required', { fromServer: true }))).toMatch(/^En onlinebokning behöver/)
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

describe('mockPartyChange', () => {
  it('restamps a carded booking per person from the stored amounts, never the live policy', () => {
    const withPerPerson = mockPartyChange(
      { partySize: 2, status: 'reserved', cardOnFile: true, guarantee: { noShowFee: 50000, lateCancelFee: 20000, noShowFeePerPerson: 250, lateCancelFeePerPerson: 100 } },
      4,
    ).change
    expect(withPerPerson).toMatchObject({ noShowFee: 100000, lateCancelFee: 40000, previousNoShowFee: 50000, cardOnFile: true, cardRequired: false })
    // Without per person kronor: the stored total divided by the stored party (booking 2 of the mock data).
    const fromTotal = mockPartyChange({ partySize: 4, status: 'reserved', cardOnFile: true, guarantee: { noShowFee: 30000 } }, 6).change
    expect(fromTotal.noShowFee).toBe(45000)
  })

  it('asks for a card when a reserved booking grows past the threshold, and never sends a link', () => {
    const base = { partySize: 2, status: 'reserved' as const, customerPhone: '+46701234567' }
    const crossed = mockPartyChange(base, 4)
    expect(crossed.change).toMatchObject({ cardRequired: true, cardLinkSent: false, cardWaived: false, noShowFee: 100000, notified: true })
    expect(crossed.cardNeeded).toMatchObject({ partySize: 4, noShowFee: 100000 })
    expect(mockPartyChange(base, 4, { waiveCard: true })).toMatchObject({ cardNeeded: null, change: { cardRequired: false, cardWaived: true, noShowFee: 0 } })
    expect(mockPartyChange(base, 3).change).toMatchObject({ cardRequired: false, noShowFee: 0 })
    expect(mockPartyChange(base, 4, { notifyGuest: false }).change.notified).toBe(false)
  })

  it('asks for no card for an arrived guest, a walk-in or a pending booking', () => {
    for (const prev of [{ status: 'arrived' as const }, { status: 'reserved' as const, source: 'walk_in' as const }, { status: 'pending' as const }]) {
      expect(mockPartyChange({ partySize: 2, ...prev }, 5)).toMatchObject({ cardNeeded: null, change: { cardRequired: false, notified: false } })
    }
  })

  it('follows an existing cardNeeded: restamped, dropped under the threshold, cleared by waiveCard', () => {
    const needy = {
      partySize: 4, status: 'reserved' as const,
      cardNeeded: { partySize: 4, noShowFee: 100000, lateCancelFee: 40000, since: 'x' },
    }
    expect(mockPartyChange(needy, 5).cardNeeded).toMatchObject({ noShowFee: 125000, since: 'x' })
    expect(mockPartyChange(needy, 3).cardNeeded).toBeNull()
    expect(mockPartyChange(needy, 5, { waiveCard: true })).toMatchObject({ cardNeeded: null, change: { cardWaived: true } })
  })
})

describe('updateReservation without an API', () => {
  it('applies the whole edit to the booking it is given and keeps its date', async () => {
    const current = {
      ...mockReservations('2026-10-12').find((m) => m.reservationId === 'mockres2')!,
    }
    vi.mocked(api.isApiConfigured).mockReturnValueOnce(false)
    const next = await updateReservation('mock', current.reservationId, { partySize: 6, name: 'Nytt Namn', notes: 'Ny', tableIds: ['8'], notifyGuest: true }, current)
    expect(next).toMatchObject({ date: '2026-10-12', partySize: 6, customerName: 'Nytt Namn', notes: 'Ny', tableIds: ['8'] })
    expect(next.partyChange).toMatchObject({ from: 4, to: 6, previousNoShowFee: 30000, noShowFee: 45000, cardLinkSent: false })
    expect(next.guarantee?.noShowFee).toBe(45000)
  })

  it('edits without a party size work too, and waiveCard clears cardNeeded', async () => {
    const current = {
      ...mockReservations('2026-10-12').find((m) => m.reservationId === 'mockres3')!,
      cardNeeded: { partySize: 6, noShowFee: 150000, lateCancelFee: 60000 },
    }
    vi.mocked(api.isApiConfigured).mockReturnValue(false)
    const named = await updateReservation('mock', current.reservationId, { name: 'Annat' }, current)
    expect(named).toMatchObject({ customerName: 'Annat', date: '2026-10-12', partySize: 6 })
    expect(named.partyChange).toBeUndefined()
    const waived = await updateReservation('mock', current.reservationId, { waiveCard: true }, current)
    expect(waived.cardNeeded).toBeUndefined()
    vi.mocked(api.isApiConfigured).mockReturnValue(true)
  })
})
