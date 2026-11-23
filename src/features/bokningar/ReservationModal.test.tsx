import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { ReservationModal } from './ReservationModal'
import { NewReservationModal } from './NewReservationModal'
import { SlotTablePicker, SLOT_REFRESH_MS } from './SlotTablePicker'
import type { Reservation } from './bookingsApi'
import { formatDate } from '../../shared/DateInput'
import { chooseOption } from '../../test/select'
import { testPlan } from '../../test/layout'

const changeStatus = vi.fn()
const paymentAction = vi.fn()
const getReservation = vi.fn()
const updateReservation = vi.fn()
const getAvailability = vi.fn()
const createManualReservation = vi.fn()
const resendGuaranteeLink = vi.fn()
vi.mock('./bookingsApi', async (orig) => ({
  ...(await orig<typeof import('./bookingsApi')>()),
  changeStatus: (...a: unknown[]) => changeStatus(...a),
  paymentAction: (...a: unknown[]) => paymentAction(...a),
  getReservation: (...a: unknown[]) => getReservation(...a),
  updateReservation: (...a: unknown[]) => updateReservation(...a),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
  createManualReservation: (...a: unknown[]) => createManualReservation(...a),
  resendGuaranteeLink: (...a: unknown[]) => resendGuaranteeLink(...a),
}))

// Bordskartan: bord 2-5 med samma nummer som id:t.
const loadActiveLayout = vi.fn()
vi.mock('../layout-editor/activeLayout', async (orig) => ({
  ...(await orig<typeof import('../layout-editor/activeLayout')>()),
  loadActiveLayout: (...a: unknown[]) => loadActiveLayout(...a),
}))
const PLAN = testPlan(['2', '3', '4', '5'].map((id) => ({ id, label: id, seats: id === '2' ? 2 : 4 })))

const TODAY = '2026-10-12'

/** Svaret från GET /availability (personalvyn). */
function avail(slots: unknown[] = [], day: unknown = null) {
  return { slots, day }
}

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
    customerPhone: '+46701234567',
    source: 'online',
    ...over,
  }
}

beforeEach(() => {
  for (const fn of [changeStatus, paymentAction, getReservation, updateReservation, getAvailability, createManualReservation, resendGuaranteeLink]) {
    fn.mockReset()
  }
  getAvailability.mockResolvedValue(avail([]))
  loadActiveLayout.mockReset()
  loadActiveLayout.mockResolvedValue(PLAN)
})

describe('ReservationModal', () => {
  it('marks a guest as arrived', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    changeStatus.mockResolvedValue(booking({ status: 'arrived' }))
    render(<ReservationModal today={TODAY} reservation={booking()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Anlänt' }))
    expect(changeStatus).toHaveBeenCalledWith('loc-1', 'r1', 'arrived', {})
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'arrived' }))
  })

  it('no-show charges the fee by default and can waive it', async () => {
    const user = userEvent.setup()
    changeStatus.mockResolvedValue(booking({ status: 'no_show_charged' }))
    const guaranteed = booking({ cardOnFile: true, guarantee: { noShowFee: 50000, lateCancelFee: 0 } })
    const { unmount } = render(
      <ReservationModal today={TODAY} reservation={guaranteed} isOwner onChanged={() => {}} onClose={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    await user.click(screen.getByRole('button', { name: 'Uteblev - debitera 500 kr' }))
    expect(changeStatus).toHaveBeenLastCalledWith('loc-1', 'r1', 'no_show', { chargeFee: true })
    unmount()

    render(<ReservationModal today={TODAY} reservation={guaranteed} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    await user.click(screen.getByLabelText(/Debitera no-show-avgiften 500 kr/))
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    expect(changeStatus).toHaveBeenLastCalledWith('loc-1', 'r1', 'no_show', { chargeFee: false })
  })

  it('shows the server reason when a status change is refused', async () => {
    const user = userEvent.setup()
    changeStatus.mockRejectedValue(new ApiError(409, 'grace_period_not_over'))
    render(<ReservationModal today={TODAY} reservation={booking()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Uteblev' }))
    await user.click(screen.getAllByRole('button', { name: 'Uteblev' }).at(-1)!)
    expect(await screen.findByRole('alert')).toHaveTextContent('tiden för sena gäster')
  })

  it('cancels and tells the guest unless unticked', async () => {
    const user = userEvent.setup()
    changeStatus.mockResolvedValue(booking({ status: 'cancelled_by_restaurant' }))
    render(<ReservationModal today={TODAY} reservation={booking()} isOwner onChanged={() => {}} onClose={() => {}} />)
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
      <ReservationModal today={TODAY} reservation={failed} isOwner={false} onChanged={() => {}} onClose={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: 'Debitera avgiften igen' }))
    expect(paymentAction).toHaveBeenCalledWith('loc-1', 'r1', 'charge')
    unmount()

    const charged = booking({
      status: 'no_show_charged',
      payment: { kind: 'no_show', status: 'succeeded', amount: 50000 },
    })
    const staff = render(
      <ReservationModal today={TODAY} reservation={charged} isOwner={false} onChanged={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Återbetala' })).toBeNull()
    staff.unmount()

    render(<ReservationModal today={TODAY} reservation={charged} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Återbetala' }))
    await user.clear(screen.getByLabelText(/Belopp/))
    await user.type(screen.getByLabelText(/Belopp/), '200')
    expect(screen.getByText('Kvar att återbetala', { exact: false })).toHaveTextContent('500 kr')
    await user.type(screen.getByLabelText('Anledning (valfri)'), 'Sjukdom')
    await user.click(screen.getByRole('button', { name: 'Återbetala 200 kr' }))
    expect(paymentAction).toHaveBeenLastCalledWith('loc-1', 'r1', 'refund', {
      amount: 20000, reason: 'Sjukdom', notifyGuest: true,
    })
    expect(screen.queryByRole('dialog', { name: 'Återbetala avgiften' })).toBeNull()
  })

  it('a refund that hits a 409 reloads the booking so the dialog shows what is left now', async () => {
    const user = userEvent.setup()
    const charged = (refundedAmount: number) => booking({
      status: 'no_show_charged',
      payment: { kind: 'no_show', status: 'succeeded', amount: 50000, refundedAmount },
    })
    paymentAction.mockRejectedValue(new ApiError(409, 'changed_retry', { code: 'changed_retry', fromServer: true }))
    getReservation.mockResolvedValue(charged(30000))
    function Host() {
      const [r, setR] = useState(charged(0))
      return <ReservationModal today={TODAY} reservation={r} isOwner onChanged={setR} onClose={() => {}} />
    }
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'Återbetala' }))
    await user.click(screen.getByRole('button', { name: 'Återbetala 500 kr' }))
    expect(await screen.findByText(/betalade nyss tillbaka/)).toBeInTheDocument()
    expect(getReservation).toHaveBeenCalledWith('loc-1', 'r1')
    expect(screen.getByText('Kvar att återbetala', { exact: false })).toHaveTextContent('200 kr')
    expect(screen.getByLabelText(/Belopp/)).toHaveValue('200')
  })

  it('moves a booking to another time and table', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([
      { startTime: '17:00', endTime: '19:00', layoutVersion: 1, tables: [{ tableId: '5', seats: 4 }] },
    ]))
    updateReservation.mockResolvedValue(booking({ startTime: '17:00', tableIds: ['5'] }))
    const onChanged = vi.fn()
    render(<ReservationModal today={TODAY} reservation={booking()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    await chooseOption(await screen.findByLabelText('Tid'), '17:00')
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

const phoneField = () => screen.getByRole('textbox', { name: 'Telefon' })

/** Ny bokning med tid 19:00, bord 2 och namnet Anna ifyllt. */
async function fillNewBooking(user: ReturnType<typeof userEvent.setup>) {
  getAvailability.mockResolvedValue(avail([
    { startTime: '19:00', endTime: '21:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
  ]))
  const onCreated = vi.fn()
  render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" today={TODAY} onCreated={onCreated} onCancel={() => {}} />)
  await chooseOption(await screen.findByLabelText('Tid'), '19:00')
  await user.click(screen.getByLabelText(/Bord 2/))
  await user.type(screen.getByLabelText('Namn'), 'Anna')
  return onCreated
}

const PHONE_BOOKING = {
  date: '2026-10-12',
  startTime: '19:00',
  tableIds: ['2'],
  partySize: 2,
  name: 'Anna',
  phone: '+46701234567',
  source: 'phone',
  notifyGuest: true,
  guarantee: 'sms',
}

describe('NewReservationModal', () => {
  it('picks one or several tables on the 2D map, no checkbox list', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([
      { startTime: '19:00', endTime: '21:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }, { tableId: '4', seats: 4 }] },
    ]))
    createManualReservation.mockResolvedValue(booking({ reservationId: 'new' }))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    await chooseOption(await screen.findByLabelText('Tid'), '19:00')
    const map = screen.getByRole('group', { name: 'Bordskarta' })
    expect(within(map).getByRole('button', { name: 'Bord 3, 4 pl, upptaget' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(map).getByRole('button', { name: 'Bord 2, 2 pl, ledigt' }))
    await user.click(within(map).getByRole('button', { name: 'Bord 4, 4 pl, ledigt' }))
    expect(within(map).getByText('Bord 2, 4')).toBeInTheDocument()
    expect(within(map).getByText('Valda bord har 6 platser.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Bord/ })).toBeNull()
    await user.type(screen.getByLabelText('Namn'), 'Anna')
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(createManualReservation).toHaveBeenCalledWith('loc-1', { ...PHONE_BOOKING, tableIds: ['2', '4'] })
  })

  it('books a phone reservation with the card link by sms', async () => {
    const user = userEvent.setup()
    createManualReservation.mockResolvedValue(booking({ reservationId: 'new' }))
    const onCreated = await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(createManualReservation).toHaveBeenCalledWith('loc-1', PHONE_BOOKING)
    expect(onCreated).toHaveBeenCalled()
  })

  it('a phone booking needs the phone: Boka stays off and the field says why after leaving it', async () => {
    const user = userEvent.setup()
    await fillNewBooking(user)
    expect(screen.getByRole('button', { name: 'Boka' })).toBeDisabled()
    expect(screen.queryByText('Skriv gästens telefonnummer.')).toBeNull()
    await user.click(phoneField())
    await user.tab()
    expect(screen.getByText('Skriv gästens telefonnummer.')).toBeInTheDocument()
    await user.type(phoneField(), '070')
    expect(screen.getByText('Numret ser fel ut. Skriv det så här: 070 123 45 67.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boka' })).toBeDisabled()
  })

  it('a drop-in books without a phone and without a card link', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([
      { startTime: '19:00', endTime: '21:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
    ]))
    createManualReservation.mockResolvedValue(booking({ reservationId: 'new' }))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    await user.click(screen.getByRole('radio', { name: 'Drop-in' }))
    await chooseOption(await screen.findByLabelText('Tid'), '19:00')
    await user.click(screen.getByLabelText(/Bord 2/))
    await user.type(screen.getByLabelText('Namn'), 'Anna')
    expect(screen.getByLabelText('Telefon (valfritt)')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(createManualReservation).toHaveBeenCalledWith('loc-1', {
      date: TODAY,
      startTime: '19:00',
      tableIds: ['2'],
      partySize: 2,
      name: 'Anna',
      source: 'walk_in',
      notifyGuest: false,
    })
  })

  it('a landline shows at the phone field and Boka utan kort books without the card', async () => {
    const user = userEvent.setup()
    createManualReservation
      .mockRejectedValueOnce(new ApiError(400, 'guarantee sms needs a mobile number', { fromServer: true }))
      .mockResolvedValueOnce(booking({ reservationId: 'new' }))
    const onCreated = await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(await screen.findByText('Kortlänken skickas med sms. Skriv ett mobilnummer, till exempel 070 123 45 67.')).toBeInTheDocument()
    expect(phoneField()).toHaveFocus()
    expect(phoneField()).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Boka utan kort' }))
    expect(createManualReservation).toHaveBeenLastCalledWith('loc-1', { ...PHONE_BOOKING, guarantee: 'waived' })
    expect(onCreated).toHaveBeenCalled()
  })

  it('editing the phone clears the field error and the no-card offer', async () => {
    const user = userEvent.setup()
    createManualReservation.mockRejectedValueOnce(new ApiError(400, 'guarantee sms needs a mobile number', { fromServer: true }))
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    await screen.findByRole('button', { name: 'Boka utan kort' })
    await user.type(phoneField(), '{Backspace}8')
    expect(screen.queryByRole('button', { name: 'Boka utan kort' })).toBeNull()
    expect(screen.queryByText(/Kortlänken skickas med sms/)).toBeNull()
  })

  it("the guest's own mobile is asked for at the field, without the no-card offer", async () => {
    const user = userEvent.setup()
    createManualReservation.mockRejectedValueOnce(new ApiError(400, "guarantee sms needs the guest's own mobile number", { fromServer: true }))
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(await screen.findByText('Skriv gästens eget mobilnummer.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boka utan kort' })).toBeNull()
  })

  it('a failed sms keeps the form, is Booqys fault and offers Boka utan kort', async () => {
    const user = userEvent.setup()
    createManualReservation.mockRejectedValueOnce(new ApiError(502, 'sms_failed', { fromServer: true }))
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sms:et med kortlänken kunde inte skickas, så inget bokades.')
    expect(alert).toHaveTextContent('Felet ligger hos Booqy')
    expect(alert).not.toHaveTextContent('Kolla numret')
    expect(screen.getByRole('button', { name: 'Rapportera till Booqy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boka utan kort' })).toBeInTheDocument()
    expect(phoneField()).toHaveValue('+46701234567')
    expect(screen.getByLabelText('Namn')).toHaveValue('Anna')
  })

  it('sms unavailable and the sms limit offer Boka utan kort', async () => {
    const user = userEvent.setup()
    createManualReservation
      .mockRejectedValueOnce(new ApiError(503, 'sms_unavailable', { fromServer: true }))
      .mockRejectedValueOnce(new ApiError(429, 'sms_limit', { fromServer: true }))
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(await screen.findByText(/^Sms kunde inte skickas, så inget bokades\. Felet ligger hos Booqy/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boka utan kort' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(await screen.findByText('Taket för kortlänkar är nått. Boka utan kort.')).toBeInTheDocument()
    expect(phoneField()).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('button', { name: 'Boka utan kort' })).toBeInTheDocument()
  })

  it('Försök igen after a failed sms sends the card link again', async () => {
    const user = userEvent.setup()
    createManualReservation
      .mockRejectedValueOnce(new ApiError(502, 'sms_failed', { fromServer: true }))
      .mockResolvedValueOnce(booking({ reservationId: 'new' }))
    const onCreated = await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    await user.click(await screen.findByRole('button', { name: 'Försök igen' }))
    expect(createManualReservation).toHaveBeenLastCalledWith('loc-1', PHONE_BOOKING)
    expect(onCreated).toHaveBeenCalled()
  })

  it('a failed Boka utan kort keeps the choice: the offer stays and Försök igen books without the card', async () => {
    const user = userEvent.setup()
    createManualReservation
      .mockRejectedValueOnce(new ApiError(502, 'sms_failed', { fromServer: true }))
      .mockRejectedValueOnce(new ApiError(503, 'reservation service unavailable', { fromServer: true }))
      .mockResolvedValueOnce(booking({ reservationId: 'new' }))
    const onCreated = await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    await user.click(await screen.findByRole('button', { name: 'Boka utan kort' }))
    expect(createManualReservation).toHaveBeenLastCalledWith('loc-1', { ...PHONE_BOOKING, guarantee: 'waived' })
    expect(await screen.findByRole('button', { name: 'Försök igen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boka utan kort' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(createManualReservation).toHaveBeenCalledTimes(3)
    expect(createManualReservation).toHaveBeenLastCalledWith('loc-1', { ...PHONE_BOOKING, guarantee: 'waived' })
    expect(onCreated).toHaveBeenCalled()
  })

  it('a new party size drops the no-card offer and the old answer', async () => {
    const user = userEvent.setup()
    createManualReservation.mockRejectedValueOnce(new ApiError(502, 'sms_failed', { fromServer: true }))
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    await screen.findByRole('button', { name: 'Boka utan kort' })
    await user.type(screen.getByLabelText('Antal personer'), '{Backspace}3')
    expect(screen.queryByRole('button', { name: 'Boka utan kort' })).toBeNull()
    expect(screen.queryByText(/Sms:et med kortlänken/)).toBeNull()
  })

  it('a drop-in never offers Boka utan kort', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([
      { startTime: '19:00', endTime: '21:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
    ]))
    createManualReservation.mockRejectedValueOnce(new ApiError(503, 'sms_unavailable', { fromServer: true }))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    await user.click(screen.getByRole('radio', { name: 'Drop-in' }))
    await chooseOption(await screen.findByLabelText('Tid'), '19:00')
    await user.click(screen.getByLabelText(/Bord 2/))
    await user.type(screen.getByLabelText('Namn'), 'Anna')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Boka utan kort' })).toBeNull()
  })

  it('the server asking for the phone shows at the field', async () => {
    const user = userEvent.setup()
    createManualReservation.mockRejectedValueOnce(new ApiError(400, 'phone is required for a phone booking', { fromServer: true }))
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(await screen.findByText('Skriv gästens telefonnummer.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boka utan kort' })).toBeNull()
  })

  it('the confirmation checkbox explains that a card link booking always gets one', async () => {
    const user = userEvent.setup()
    await fillNewBooking(user)
    await user.type(phoneField(), '+46701234567')
    expect(screen.getByLabelText('Skicka bekräftelse till gästen')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Förklaring: Bekräftelse' }))
    expect(screen.getByText('En bokning med kortlänk får alltid sin bekräftelse när kortet är sparat.')).toBeInTheDocument()
  })

  it('keeps Boka disabled until a table and name are chosen', async () => {
    getAvailability.mockResolvedValue(avail([]))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    expect(await screen.findByText('Inga lediga tider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Boka' })).toBeDisabled()
  })

  it('drop-ins ask for the walk-in times (running slot included)', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([]))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-12" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    await screen.findByText('Inga lediga tider')
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-10-12', { walkIn: false })
    await user.click(screen.getByRole('radio', { name: 'Drop-in' }))
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-10-12', { walkIn: true })
  })
})

describe('time rules in the forms', () => {
  it('an online booking keeps its phone and email', async () => {
    const user = userEvent.setup()
    render(<ReservationModal today={TODAY} reservation={booking()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    await user.clear(screen.getByLabelText('Telefon'))
    expect(screen.getByText('En onlinebokning behöver ett telefonnummer. Skriv till exempel 070 123 45 67.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled()
  })

  it('a phone booking may drop the phone number; numbers are saved like the server does', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([]))
    updateReservation.mockResolvedValue(booking())
    render(
      <ReservationModal
        today={TODAY}
        reservation={booking({ source: 'phone', customerPhone: undefined, customerEmail: undefined })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    await user.type(screen.getByLabelText(/Telefon/), '070-123 45 67')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(updateReservation).toHaveBeenCalledWith('loc-1', 'r1', { phone: '+46701234567' })
  })

  it('editing a drop-in uses the drop-in times; editing others the normal times', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([]))
    const { unmount } = render(
      <ReservationModal today={TODAY} reservation={booking({ source: 'walk_in' })} isOwner onChanged={() => {}} onClose={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-10-12', { walkIn: true })
    unmount()
    render(<ReservationModal today={TODAY} reservation={booking()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-10-12', { walkIn: false })
  })

  it('an arrived party cannot outgrow its tables without undoing the arrival', async () => {
    const user = userEvent.setup()
    render(
      <ReservationModal
        today={TODAY}
        reservation={booking({ status: 'arrived', seats: 4 })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Ändra' }))
    await user.clear(screen.getByLabelText('Antal personer'))
    await user.type(screen.getByLabelText('Antal personer'), '5')
    expect(screen.getByText(/Borden har bara 4 platser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled()
  })

  it('a drop-in is booked today and the date cannot be changed', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([]))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-15" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText('Datum')).toHaveValue(formatDate('2026-10-15'))
    await user.click(screen.getByRole('radio', { name: 'Drop-in' }))
    expect(screen.getByLabelText('Datum')).toHaveValue(formatDate(TODAY))
    expect(screen.getByLabelText('Datum')).toBeDisabled()
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', TODAY, { walkIn: true })
  })

  it('a new booking never starts on a past day', () => {
    getAvailability.mockResolvedValue(avail([]))
    render(<NewReservationModal locationId="loc-1" initialDate="2026-10-01" today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText('Datum')).toHaveValue(formatDate(TODAY))
    expect(screen.getByLabelText('Datum')).toHaveAttribute('data-min', TODAY)
  })

  it('a time that went stale is explained in Swedish and the list is fetched again', async () => {
    const user = userEvent.setup()
    getAvailability.mockResolvedValue(avail([
      { startTime: '14:00', endTime: '16:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
    ]))
    createManualReservation.mockRejectedValue(new ApiError(400, 'startTime is not a bookable time for this date'))
    render(<NewReservationModal locationId="loc-1" initialDate={TODAY} today={TODAY} onCreated={() => {}} onCancel={() => {}} />)
    await chooseOption(await screen.findByLabelText('Tid'), '14:00')
    await user.click(screen.getByLabelText(/Bord 2/))
    await user.type(screen.getByLabelText('Namn'), 'Anna')
    await user.type(screen.getByRole('textbox', { name: 'Telefon' }), '0701234567')
    const calls = getAvailability.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Boka' }))
    expect(await screen.findByText('Den tiden går inte att boka längre. Välj en annan tid i listan.')).toBeInTheDocument()
    expect(getAvailability.mock.calls.length).toBe(calls + 1)
    expect(screen.getByLabelText('Tid')).toHaveValue('')
  })
})

describe('SlotTablePicker refresh', () => {
  it('drops a chosen time that is no longer offered after the minute refresh', async () => {
    vi.useFakeTimers()
    try {
      getAvailability
        .mockResolvedValueOnce(avail([
          { startTime: '14:00', endTime: '16:00', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
        ]))
        .mockResolvedValue(avail([
          { startTime: '14:30', endTime: '16:30', layoutVersion: 1, tables: [{ tableId: '2', seats: 2 }] },
        ]))
      const onChange = vi.fn()
      render(
        <SlotTablePicker
          locationId="loc-1"
          date={TODAY}
          startTime="14:00"
          tableIds={['2']}
          partySize={2}
          today={TODAY}
          onChange={onChange}
        />,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOT_REFRESH_MS)
      })
      expect(onChange).toHaveBeenCalledWith({ date: TODAY, startTime: '', tableIds: [] })
      expect(screen.getByRole('status')).toHaveTextContent('14:00 går inte att boka längre')
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a table someone else took, keeps the time', async () => {
    vi.useFakeTimers()
    try {
      getAvailability
        .mockResolvedValueOnce(avail([
          { startTime: '14:00', endTime: '16:00', layoutVersion: 1,
            tables: [{ tableId: '2', seats: 2 }, { tableId: '3', seats: 4 }] },
        ]))
        .mockResolvedValue(avail([
          { startTime: '14:00', endTime: '16:00', layoutVersion: 1, tables: [{ tableId: '3', seats: 4 }] },
        ]))
      const onChange = vi.fn()
      render(
        <SlotTablePicker
          locationId="loc-1"
          date={TODAY}
          startTime="14:00"
          tableIds={['2', '3']}
          partySize={2}
          today={TODAY}
          onChange={onChange}
        />,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOT_REFRESH_MS)
      })
      expect(onChange).toHaveBeenCalledWith({ date: TODAY, startTime: '14:00', tableIds: ['3'] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the booking's own time and tables while editing", async () => {
    vi.useFakeTimers()
    try {
      getAvailability.mockResolvedValue(avail([]))
      const onChange = vi.fn()
      render(
        <SlotTablePicker
          locationId="loc-1"
          date={TODAY}
          startTime="13:00"
          tableIds={['4']}
          partySize={2}
          today={TODAY}
          keep={{ date: TODAY, startTime: '13:00', tableIds: ['4'], seats: 4 }}
          onChange={onChange}
        />,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOT_REFRESH_MS)
      })
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Tid')).toHaveValue('13:00')
      expect(screen.getByText('Valda bord har 4 platser.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ReservationModal extend', () => {
  const ruled = (over: Partial<Reservation> = {}) =>
    booking({
      startTime: '18:00',
      endTime: '19:30',
      bookingRule: { durationMinutes: 90, extensionAllowed: true, maxExtensionMinutes: 30 },
      ...over,
    })

  it('extends within the rule', async () => {
    const user = userEvent.setup()
    updateReservation.mockResolvedValue(ruled({ endTime: '20:00' }))
    render(<ReservationModal today={TODAY} reservation={ruled()} isOwner onChanged={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/1 tim 30 min · kan förlängas 30 min/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    expect(screen.getByLabelText('Ny sluttid')).toHaveValue(String(20 * 60))
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    expect(updateReservation).toHaveBeenCalledWith('loc-1', 'r1', { endTime: '20:00' })
  })

  it('needs an explicit override beyond the rule', async () => {
    const user = userEvent.setup()
    updateReservation.mockResolvedValue(ruled({ endTime: '20:30' }))
    render(<ReservationModal today={TODAY} reservation={ruled()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    await chooseOption(screen.getByLabelText('Ny sluttid'), String(20 * 60 + 30))
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Kryssa i rutan')
    expect(updateReservation).not.toHaveBeenCalled()
    await user.click(screen.getByLabelText(/Förläng ändå/))
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    expect(updateReservation).toHaveBeenCalledWith('loc-1', 'r1', { endTime: '20:30', overrideRule: true })
  })

  it('offers the override when the server says a window blocks it', async () => {
    const user = userEvent.setup()
    updateReservation.mockRejectedValueOnce(new ApiError(409, 'window_not_extendable'))
    render(<ReservationModal today={TODAY} reservation={ruled()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('buffé')
    expect(screen.getByLabelText(/Förläng ändå/)).toBeInTheDocument()
  })

  it('shortens a booking', async () => {
    const user = userEvent.setup()
    updateReservation.mockResolvedValue(ruled({ endTime: '19:00' }))
    render(<ReservationModal today={TODAY} reservation={ruled()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Förläng' }))
    await chooseOption(screen.getByLabelText('Ny sluttid'), String(19 * 60))
    await user.click(screen.getByRole('button', { name: 'Korta bokningen' }))
    expect(updateReservation).toHaveBeenCalledWith('loc-1', 'r1', { endTime: '19:00' })
  })
})

describe('ReservationModal history', () => {
  it('shows a shortened end neutrally', () => {
    render(
      <ReservationModal
        today={TODAY}
        reservation={booking({ history: [{ action: 'shortened', by: 'x', at: '2026-10-12T17:00:00Z', previous: '21:00', endTime: '20:30' }] })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/Sluttid ändrad · 21:00 till 20:30/)).toBeInTheDocument()
  })

  it('names edited fields in Swedish and hides internal keys', () => {
    const fields = ['bookedFor', 'date', 'endTime', 'endsAt', 'layoutVersion', 'seats', 'startTime', 'tableIds', 'ttl']
    render(
      <ReservationModal
        today={TODAY}
        reservation={booking({ history: [{ action: 'edited', by: 'x', at: '2026-10-12T17:00:00Z', fields }] })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/Ändrad · tid, bord/)).toBeInTheDocument()
    expect(screen.queryByText(/bookedFor|layoutVersion|ttl/)).toBeNull()
  })

  it('shows a failed fee in Swedish, never the raw Stripe code', () => {
    const { unmount } = render(
      <ReservationModal
        today={TODAY}
        reservation={booking({
          status: 'no_show_charge_failed',
          payment: { kind: 'no_show', status: 'failed', amount: 25000, error: 'insufficient_funds' },
        })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/drogs inte \(för lite pengar på kortet\)/)).toBeInTheDocument()
    expect(screen.queryByText(/insufficient_funds/)).toBeNull()
    unmount()
    const declined = render(
      <ReservationModal
        today={TODAY}
        reservation={booking({
          status: 'no_show_charge_failed',
          payment: { kind: 'no_show', status: 'failed', amount: 25000, error: 'do_not_honor' },
        })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/drogs inte \(kortet nekades\)/)).toBeInTheDocument()
    expect(screen.queryByText(/do_not_honor/)).toBeNull()
    declined.unmount()
    render(
      <ReservationModal
        today={TODAY}
        reservation={booking({
          status: 'no_show_charge_failed',
          payment: { kind: 'no_show', status: 'failed', amount: 25000, error: 'processing_error' },
        })}
        isOwner
        onChanged={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByText(/processing_error/)).toBeNull()
  })
})

describe('ReservationModal: waiting for the card', () => {
  const pending = (link: Partial<NonNullable<Reservation['guaranteeLink']>> = {}) =>
    booking({
      status: 'pending',
      source: 'phone',
      timezone: 'Europe/Stockholm',
      pendingExpiresAt: '2026-10-12T16:32:00Z',
      guarantee: { noShowFee: 20000 },
      guaranteeLink: { by: 'booqy', sends: 1, textedAt: '2026-10-12T16:00:00Z', canResend: true, ...link },
    })

  it('shows when the card link was texted and how many times', () => {
    const { unmount } = render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Kortlänk')).toBeInTheDocument()
    expect(screen.getByText('Skickad 18:00')).toBeInTheDocument()
    unmount()
    render(<ReservationModal today={TODAY} reservation={pending({ sends: 2 })} isOwner onChanged={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Skickad 18:00 · 2 sms')).toBeInTheDocument()
  })

  it('the card link row only shows for a link that went out', () => {
    const { unmount } = render(
      <ReservationModal today={TODAY} reservation={{ ...pending(), status: 'expired' }} isOwner onChanged={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByText('Kortlänk')).toBeNull()
    unmount()
    const failed = pending()
    failed.history = [{ at: '2026-10-12T16:00:00Z', by: 'staff-sub', action: 'link_failed' }]
    render(<ReservationModal today={TODAY} reservation={failed} isOwner onChanged={() => {}} onClose={() => {}} />)
    expect(screen.queryByText('Kortlänk')).toBeNull()
  })

  it('holds until the time the guest was told (the sms says 30 minutes)', () => {
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Hålls till').nextElementSibling).toHaveTextContent('18:30')
  })

  it('a failed resend says the link was not sent (the booking is untouched) and Försök igen sends again', async () => {
    const user = userEvent.setup()
    resendGuaranteeLink
      .mockRejectedValueOnce(new ApiError(503, 'sms_unavailable', { fromServer: true }))
      .mockResolvedValueOnce(pending({ sends: 2 }))
    const onChanged = vi.fn()
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Skicka länken igen' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sms kan inte skickas just nu. Felet ligger hos Booqy')
    expect(alert).not.toHaveTextContent('Bokningen sparades inte')
    await user.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(resendGuaranteeLink).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalled()
  })

  it('an unknown resend failure names the link, not the booking', async () => {
    const user = userEvent.setup()
    resendGuaranteeLink.mockRejectedValueOnce(new ApiError(500, 'something_new', { fromServer: true }))
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Skicka länken igen' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Länken skickades inte igen\. Felet ligger hos Booqy/)
  })

  it('Skicka länken igen sends the link again', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    resendGuaranteeLink.mockResolvedValue(pending({ sends: 2 }))
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Skicka länken igen' }))
    expect(resendGuaranteeLink).toHaveBeenCalledWith('loc-1', 'r1')
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ guaranteeLink: expect.objectContaining({ sends: 2 }) }))
  })

  it('hides Skicka länken igen when the link cannot be sent again', () => {
    render(<ReservationModal today={TODAY} reservation={pending({ canResend: false })} isOwner onChanged={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Skicka länken igen' })).toBeNull()
  })

  it('explains the resend limit and shows the latest booking', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const latest = pending({ sends: 3, canResend: false })
    resendGuaranteeLink.mockRejectedValue(new ApiError(409, 'resend_limit', { fromServer: true }))
    getReservation.mockResolvedValue(latest)
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={onChanged} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Skicka länken igen' }))
    expect(await screen.findByText('Länken är redan skickad 3 gånger. Kolla numret med gästen, eller avboka och gör en ny bokning.')).toBeInTheDocument()
    expect(getReservation).toHaveBeenCalledWith('loc-1', 'r1')
    expect(onChanged).toHaveBeenCalledWith(latest)
  })

  it('a failed resend that is not a conflict does not reload the booking', async () => {
    const user = userEvent.setup()
    resendGuaranteeLink.mockRejectedValue(new ApiError(502, 'sms_failed', { fromServer: true }))
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Skicka länken igen' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sms:et med kortlänken kunde inte skickas. Felet ligger hos Booqy')
    expect(getReservation).not.toHaveBeenCalled()
  })

  it('a pending booking can be cancelled without telling the guest', async () => {
    const user = userEvent.setup()
    changeStatus.mockResolvedValue(booking({ status: 'cancelled_by_restaurant' }))
    render(<ReservationModal today={TODAY} reservation={pending()} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Avboka' }))
    expect(screen.getByText('Borden släpps. Gästen debiteras inte.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Meddela gästen')).toBeNull()
    await user.click(screen.getAllByRole('button', { name: 'Avboka' }).at(-1)!)
    expect(changeStatus).toHaveBeenCalledWith('loc-1', 'r1', 'cancelled', { notifyGuest: false })
  })

  it('names the card link events in the history', async () => {
    const user = userEvent.setup()
    const r = pending({})
    r.history = [
      { at: '2026-10-12T16:00:00Z', by: 'staff-sub', action: 'created', cardSkipped: 'too_soon' },
      { at: '2026-10-12T16:01:00Z', by: 'staff-sub', action: 'link_resent' },
      { at: '2026-10-12T16:02:00Z', by: 'staff-sub', action: 'link_failed' },
      { at: '2026-10-12T16:03:00Z', by: 'staff-sub', action: 'guarantee_waived' },
    ]
    render(<ReservationModal today={TODAY} reservation={r} isOwner onChanged={() => {}} onClose={() => {}} />)
    await user.click(screen.getByText('Historik'))
    expect(screen.getByText(/Bokad · utan kort \(för nära starttiden\)/)).toBeInTheDocument()
    expect(screen.getByText(/Kortlänk skickad igen/)).toBeInTheDocument()
    expect(screen.getByText(/Sms med kortlänk gick inte iväg, bordet släpptes/)).toBeInTheDocument()
    expect(screen.getByText(/Kortgaranti hoppades över/)).toBeInTheDocument()
  })
})
