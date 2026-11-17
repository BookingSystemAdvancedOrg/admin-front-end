import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CateringRequestPage from './CateringRequestPage'
import CateringPage from './CateringPage'
import { ApiError } from '../../shared/api'
import { offerTotals } from './cateringApi'
import type { CateringRequest } from './cateringApi'
import { chooseOption } from '../../test/select'

const getRequest = vi.fn()
const sendOffer = vi.fn()
const saveDraft = vi.fn()
const declineRequest = vi.fn()
const cancelRequest = vi.fn()
const markDelivered = vi.fn()
const listRequests = vi.fn()
const restaurantSign = vi.fn()
const restaurantSignStatus = vi.fn()
const refundRequest = vi.fn()
vi.mock('./cateringApi', async (orig) => ({
  ...(await orig<typeof import('./cateringApi')>()),
  refundRequest: (...a: unknown[]) => refundRequest(...a),
  getRequest: (...a: unknown[]) => getRequest(...a),
  sendOffer: (...a: unknown[]) => sendOffer(...a),
  saveDraft: (...a: unknown[]) => saveDraft(...a),
  declineRequest: (...a: unknown[]) => declineRequest(...a),
  cancelRequest: (...a: unknown[]) => cancelRequest(...a),
  markDelivered: (...a: unknown[]) => markDelivered(...a),
  listRequests: (...a: unknown[]) => listRequests(...a),
  restaurantSign: (...a: unknown[]) => restaurantSign(...a),
  restaurantSignStatus: (...a: unknown[]) => restaurantSignStatus(...a),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: (d: string) => Promise.resolve(`data:qr,${d}`) } }))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  ),
}))
let role = 'owner_user'
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant: { role } }), currentLocation: () => null }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))

const TOTALS = { subtotal: 100000, discountPercent: 0, discount: 0, deliveryFee: 0, total: 100000, vat: 10714, vatRate: 12 }

function request(extra: Partial<CateringRequest> = {}): CateringRequest {
  return {
    requestId: 'req-1', locationId: 'loc-1', status: 'requested', version: 1,
    customerType: 'private', customerName: 'Anna Andersson', customerEmail: 'anna@example.se',
    customerPhone: '+46701234567', deliveryDate: '2026-11-20', deliveryTime: '12:00',
    fulfilment: 'pickup', createdAt: '2026-10-12T10:00:00Z', portions: 20, total: 100000,
    request: { lines: [{ menuItemId: 'm1', name: 'Lasagne', unitPrice: 5000, quantity: 20 }], portions: 20, ...TOTALS },
    offers: [], capacityLeft: null, history: [{ action: 'requested', by: 'guest', at: '2026-10-12T10:00:00Z' }],
    ...extra,
  }
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/catering/loc-1/req-1']}>
      <Routes>
        <Route path="/catering/:locationId/:requestId" element={<CateringRequestPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  role = 'owner_user'
  for (const fn of [getRequest, sendOffer, saveDraft, declineRequest, cancelRequest, markDelivered, listRequests,
    refundRequest]) fn.mockReset()
})

describe('offerTotals', () => {
  it('matches the server: discount on dishes, 12 % VAT included', () => {
    const t = offerTotals({ lines: [{ name: 'A', unitPrice: 50, quantity: 20 }], discountPercent: 10, deliveryFee: 395,
      equipmentReturn: 'cleaned', cleaningFee: 300, message: '', serviceIncluded: true }, '2026-11-20')
    expect(t).toMatchObject({ subtotal: 100000, discount: 10000, deliveryFee: 39500, cleaningFee: 0, total: 129500, vat: 13875 })
  })

  it('adds the cleaning fee when the equipment comes back not cleaned, outside the discount', () => {
    const t = offerTotals({ lines: [{ name: 'A', unitPrice: 50, quantity: 20 }], discountPercent: 10, deliveryFee: 395,
      equipmentReturn: 'not_cleaned', cleaningFee: 300, message: '', serviceIncluded: true }, '2026-11-20')
    // same numbers as the server test: 1000 - 100 + 395 + 300 kr, VAT 12/112
    expect(t).toMatchObject({ discount: 10000, cleaningFee: 30000, total: 159500, vat: 17089 })
  })

  it('food without service takes 6 % in the reduced period, 12 % after it', () => {
    const offer = { lines: [{ name: 'A', unitPrice: 106, quantity: 1 }], discountPercent: 0, deliveryFee: 0,
      equipmentReturn: 'cleaned' as const, cleaningFee: 0, message: '', serviceIncluded: false }
    expect(offerTotals(offer, '2026-11-20')).toMatchObject({ vatRate: 6, vat: 600 })
    expect(offerTotals(offer, '2028-01-05').vatRate).toBe(12)
  })
})

describe('CateringRequestPage', () => {
  it('prefills the offer from the guest calculation and sends it', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request())
    sendOffer.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    expect(await screen.findByLabelText('Rad 1 namn')).toHaveValue('Lasagne')
    expect(screen.getByLabelText('Rad 1 pris')).toHaveValue('50')
    await user.clear(screen.getByLabelText('Rad 1 pris'))
    await user.type(screen.getByLabelText('Rad 1 pris'), '55')
    await user.click(screen.getByRole('button', { name: 'Skicka offert' }))
    expect(sendOffer).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
      lines: [{ menuItemId: 'm1', name: 'Lasagne', unitPrice: 55, quantity: 20 }],
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Offerten är klar. Signera den')
  })

  it('adds a catering package for the guests, switches to food only and shows the review label', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({
      guests: 40, reviewedAt: '2026-10-12T11:00:00Z', customerType: 'company', companyName: 'Acme AB',
      signatory: { name: 'Karl Ek', role: 'VD', authorityConfirmed: true },
      request: { lines: [], portions: 0, ...TOTALS, deliveryFeeManual: true },
      fulfilment: 'delivery', deliveryAddress: { street: 'Storgatan 1', postalCode: '11122', city: 'Stockholm' },
    }))
    sendOffer.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    expect(await screen.findByText('Under granskning')).toBeInTheDocument()
    expect(screen.getByText('Karl Ek, VD (intygad behörighet)')).toBeInTheDocument()
    expect(screen.getByText(/hittades inte på kartan/)).toBeInTheDocument()
    await chooseOption(screen.getByLabelText('Lägg till från cateringmenyn'), 'p:p1')
    expect(screen.getByLabelText('Rad 1 namn')).toHaveValue('Mingelpaket')
    expect(screen.getByLabelText('Rad 1 antal')).toHaveValue('40')
    await chooseOption(screen.getByLabelText('Moms'), 'food')
    expect(screen.getByText('varav moms 6 %')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skicka offert' }))
    expect(sendOffer).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
      serviceIncluded: false, lines: [{ packageId: 'p1', name: 'Mingelpaket', unitPrice: 245, quantity: 40 }],
    }))
  })

  it('the restaurant signs the sent offer with BankID before the customer gets it', async () => {
    const user = userEvent.setup()
    const sent = request({ status: 'offer_sent', currentOfferVersion: 1, signing: { offerVersion: 1, pdfSha256: 'a'.repeat(64) },
      offers: [{ version: 1, lines: [], totals: TOTALS, validUntil: '2026-11-01' }] })
    getRequest.mockResolvedValue(sent)
    restaurantSign.mockResolvedValue({ kind: 'bankid', qrData: 'bankid.a.0.b', autoStartToken: 'ast' })
    restaurantSignStatus.mockResolvedValueOnce({ state: 'pending', hint: 'userSign', qrData: 'bankid.a.1.c' })
      .mockResolvedValueOnce({ state: 'signed', request: { ...sent, restaurantSignedAt: '2026-10-12T12:00:00Z',
        signing: { offerVersion: 1, restaurant: { name: 'Roma AB', method: 'bankid', signedAt: '2026-10-12T12:00:00Z' } } } })
    renderAt()
    expect(await screen.findByText('Väntar på er signatur')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Signera med BankID' }))
    expect(await screen.findByAltText('QR-kod för BankID')).toHaveAttribute('src', 'data:qr,bankid.a.0.b')
    expect(await screen.findByText(/Skriv in din säkerhetskod/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(await screen.findByText(/Signerad. Offerten är skickad till kunden/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Signera offerten' })).not.toBeInTheDocument()
    expect(screen.getByText('Offert skickad')).toBeInTheDocument()
  })

  it('shows a not cleaned return and keeps its fee in the offer', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({
      equipmentReturn: 'not_cleaned',
      request: { lines: [{ menuItemId: 'm1', name: 'Lasagne', unitPrice: 5000, quantity: 20 }], portions: 20,
        equipmentReturn: 'not_cleaned', ...TOTALS, cleaningFee: 35000, total: 135000 },
      settings: { cleaningFee: 500 },
    }))
    sendOffer.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    expect(await screen.findByText('Ej rengjord: vi diskar och rengör')).toBeInTheDocument()
    expect(screen.getByLabelText('Retur av utrustning')).toHaveValue('not_cleaned')
    // the fee the guest saw, not the location's newer one
    expect(screen.getByLabelText('Rengöringsavgift (kr)')).toHaveValue('350')
    expect(screen.getAllByText('Rengöringsavgift')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Skicka offert' }))
    expect(sendOffer).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
      equipmentReturn: 'not_cleaned', cleaningFee: 350,
    }))
  })

  it('switches an offer to cleaned and drops the fee', async () => {
    getRequest.mockResolvedValue(request({ equipmentReturn: 'not_cleaned', settings: { cleaningFee: 500 } }))
    renderAt()
    expect(await screen.findByLabelText('Rengöringsavgift (kr)')).toHaveValue('500')
    await chooseOption(screen.getByLabelText('Retur av utrustning'), 'cleaned')
    expect(screen.queryByLabelText('Rengöringsavgift (kr)')).not.toBeInTheDocument()
    expect(screen.queryByText('Rengöringsavgift')).not.toBeInTheDocument()
  })

  it('takes decimal prices typed with a comma', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request())
    sendOffer.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    const price = await screen.findByLabelText('Rad 1 pris')
    await user.clear(price)
    await user.type(price, '89,50')
    expect(price).toHaveValue('89,50')
    await user.type(price, 'x')
    expect(price).toHaveValue('89,50')
    const delivery = screen.getByLabelText('Leverans (kr)')
    await user.clear(delivery)
    await user.type(delivery, '49.5')
    expect(delivery).toHaveValue('49.5')
    await user.click(screen.getByRole('button', { name: 'Skicka offert' }))
    expect(sendOffer).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
      lines: [expect.objectContaining({ unitPrice: 89.5 })], deliveryFee: 49.5,
    }))
  })

  it('loads the request again on Försök igen after a failed first load', async () => {
    const user = userEvent.setup()
    getRequest.mockRejectedValueOnce(new ApiError(503, 'service_unavailable')).mockResolvedValue(request())
    renderAt()
    await user.click(await screen.findByRole('button', { name: /Försök igen/ }))
    expect(await screen.findByLabelText('Rad 1 namn')).toHaveValue('Lasagne')
    expect(getRequest).toHaveBeenCalledTimes(2)
  })

  it('will not send an offer line priced above 10 000 kr', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request())
    renderAt()
    const price = await screen.findByLabelText('Rad 1 pris')
    await user.clear(price)
    await user.type(price, '12000')
    expect(screen.getByRole('alert')).toHaveTextContent('Priset på en rad är för högt. Skriv högst')
    expect(screen.getByRole('button', { name: 'Skicka offert' })).toBeDisabled()
  })

  it('declines with a message after confirming', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request())
    declineRequest.mockResolvedValue(request({ status: 'declined' }))
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Neka förfrågan' }))
    const box = screen.getByRole('group', { name: 'Neka förfrågan' })
    await user.type(within(box).getByRole('textbox'), 'Fullbokat')
    await user.click(within(box).getByRole('button', { name: 'Bekräfta: neka' }))
    expect(declineRequest).toHaveBeenCalledWith('loc-1', 'req-1', 'Fullbokat')
  })

  it('shows the capacity error from the server', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request())
    sendOffer.mockRejectedValue(new ApiError(409, 'capacity_full'))
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Skicka offert' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('fullbokad')
  })

  it('prefills the validity date and puts focus on it when the server refuses it', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({ deliveryDate: '2026-11-03' }))
    sendOffer.mockRejectedValue(new ApiError(400, 'validUntil must not be after the delivery date',
      { field: 'validUntil', fromServer: true }))
    renderAt()
    const valid = await screen.findByLabelText('Giltig till och med')
    expect(valid).not.toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Skicka offert' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('efter leveransdagen')
    expect(valid).toHaveFocus()
    expect(valid).toHaveAttribute('aria-invalid', 'true')
    expect(getRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps the typed offer and marks the dropdown the server refused', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({ settings: { cleaningFee: 500 } }))
    sendOffer.mockRejectedValue(new ApiError(400, 'equipmentReturn is not allowed here',
      { field: 'equipmentReturn', fromServer: true }))
    renderAt()
    const delivery = await screen.findByLabelText('Leverans (kr)')
    await user.clear(delivery)
    await user.type(delivery, '250')
    await user.click(screen.getByRole('button', { name: 'Skicka offert' }))
    await screen.findByRole('alert')
    const ret = screen.getByRole('combobox', { name: 'Retur av utrustning' })
    expect(ret).toHaveFocus()
    expect(ret).toHaveAttribute('aria-invalid', 'true')
    expect(getRequest).toHaveBeenCalledTimes(1)
    expect(delivery).toHaveValue('250')
    await chooseOption(ret, 'not_cleaned')
    expect(ret).not.toHaveAttribute('aria-invalid')
  })

  it('staff cannot edit the offer', async () => {
    role = 'staff_user'
    getRequest.mockResolvedValue(request())
    renderAt()
    await screen.findByText('Kundens kalkyl')
    expect(screen.queryByRole('button', { name: 'Skicka offert' })).not.toBeInTheDocument()
  })

  it('shows the BankID signature and marks a confirmed order delivered', async () => {
    const user = userEvent.setup()
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    getRequest.mockResolvedValue(request({
      status: 'confirmed', paid: true, offer, offers: [offer], currentOfferVersion: 1,
      signature: { name: 'Anna Andersson', personalNumberMasked: '19800101-****', signedAt: '2026-10-13T09:00:00Z', documentHash: 'abc' },
    }))
    markDelivered.mockResolvedValue(request({ status: 'closed' }))
    renderAt()
    expect(await screen.findByText('Signerad av båda parter')).toBeInTheDocument()
    expect(screen.getByText('Anna Andersson (19800101-****)')).toBeInTheDocument()
    expect(screen.getByText('Betald online')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Markera levererad' }))
    expect(markDelivered).toHaveBeenCalledWith('loc-1', 'req-1')
  })

  it('owner refunds part of a paid order without cancelling it', async () => {
    const user = userEvent.setup()
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    const paid = request({
      status: 'confirmed', paid: true, offer, offers: [offer], currentOfferVersion: 1, refundable: 100000,
      signature: { name: 'A', personalNumberMasked: 'x', signedAt: '2026-10-13T09:00:00Z', documentHash: 'h' },
    })
    getRequest.mockResolvedValue(paid)
    refundRequest.mockResolvedValue({
      ...paid, refundedAmount: 25000, refundable: 75000,
      history: [...paid.history, { action: 'refunded', by: 'owner', at: '2026-10-14T09:00:00Z', amount: 25000 }],
    })
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Återbetala' }))
    const dialog = screen.getByRole('dialog', { name: 'Återbetala cateringen' })
    expect(within(dialog).getByText('1 000 kr', { selector: 'strong' })).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Belopp (kr)'))
    await user.type(within(dialog).getByLabelText('Belopp (kr)'), '250')
    await user.type(within(dialog).getByLabelText('Anledning (valfri)'), 'En låda saknades')
    await user.click(within(dialog).getByRole('button', { name: 'Återbetala 250 kr' }))
    expect(refundRequest).toHaveBeenCalledWith('loc-1', 'req-1', { amount: 25000, reason: 'En låda saknades', notifyGuest: true })
    expect(await screen.findByText('Återbetalt')).toBeInTheDocument()
    expect(screen.getByText('Återbetalning 250 kr', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a refund that hits a 409 reloads the request so the dialog shows what is left now', async () => {
    const user = userEvent.setup()
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    const paid = (refundable: number) => request({
      status: 'confirmed', paid: true, offer, offers: [offer], currentOfferVersion: 1, refundable,
      refundedAmount: 100000 - refundable,
      signature: { name: 'A', personalNumberMasked: 'x', signedAt: '2026-10-13T09:00:00Z', documentHash: 'h' },
    })
    getRequest.mockResolvedValueOnce(paid(100000)).mockResolvedValue(paid(40000))
    refundRequest.mockRejectedValue(new ApiError(409, 'changed_retry', { code: 'changed_retry', fromServer: true }))
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Återbetala' }))
    const dialog = screen.getByRole('dialog', { name: 'Återbetala cateringen' })
    await user.click(within(dialog).getByRole('button', { name: /Återbetala 1\s000 kr/ }))
    expect(await within(dialog).findByText(/betalade nyss tillbaka/)).toBeInTheDocument()
    expect(within(dialog).getByText('400 kr', { selector: 'strong' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Belopp (kr)')).toHaveValue('400')
  })

  it('a Bankgiro invoice is refunded by hand and staff see no refund button', async () => {
    const user = userEvent.setup()
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    const paid = request({
      status: 'delivered', paid: true, offer, offers: [offer], currentOfferVersion: 1, refundable: 100000,
      customerType: 'company', stripeInvoiceId: 'in_1', invoiceNumber: 'R-1',
      history: [{ action: 'invoice_marked_paid', by: 'owner', at: '2026-10-14T09:00:00Z' }],
      signature: { name: 'A', personalNumberMasked: 'x', signedAt: '2026-10-13T09:00:00Z', documentHash: 'h' },
    })
    getRequest.mockResolvedValue(paid)
    const { unmount } = renderAt()
    await user.click(await screen.findByRole('button', { name: 'Återbetala' }))
    expect(screen.getByText('1 000 kr betalas tillbaka för hand till gästen.')).toBeInTheDocument()
    refundRequest.mockResolvedValue({
      ...paid, refundedAmount: 100000, refundable: 0,
      refunds: [{ amount: 100000, at: '2026-10-15T09:00:00Z', manual: true }],
    })
    const dialog = screen.getByRole('dialog', { name: 'Återbetala cateringen' })
    await user.click(within(dialog).getByRole('button', { name: /Återbetala 1\s000 kr/ }))
    expect(await screen.findByText('1 000 kr att betala tillbaka för hand.')).toBeInTheDocument()
    expect(screen.queryByText('1 000 kr återbetalt.')).toBeNull()
    unmount()
    role = 'staff_user'
    renderAt()
    await screen.findByText('Signerad av båda parter')
    expect(screen.queryByRole('button', { name: 'Återbetala' })).toBeNull()
  })

  it('cancelling needs a reason', async () => {
    const user = userEvent.setup()
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    getRequest.mockResolvedValue(request({
      status: 'confirmed', offer, offers: [offer],
      signature: { name: 'A', personalNumberMasked: 'x', signedAt: '2026-10-13T09:00:00Z', documentHash: 'h' },
    }))
    cancelRequest.mockResolvedValue(request({ status: 'cancelled' }))
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Avboka' }))
    const confirm = screen.getByRole('button', { name: 'Bekräfta avbokning' })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Anledning (visas för kunden)'), 'Sjukdom')
    await user.click(confirm)
    expect(cancelRequest).toHaveBeenCalledWith('loc-1', 'req-1', 'Sjukdom')
  })
})

describe('CateringPage', () => {
  it('lists requests waiting for the owner first', async () => {
    listRequests.mockResolvedValue([
      { ...request({ requestId: 'r-sent', status: 'offer_sent', customerName: 'Bo', restaurantSignedAt: '2026-10-12T12:00:00Z' }) },
      { ...request({ requestId: 'r-new', status: 'requested', customerName: 'Cia' }) },
    ])
    render(<MemoryRouter><CateringPage /></MemoryRouter>)
    const rows = await screen.findAllByRole('row')
    expect(rows[1]).toHaveTextContent('Cia')
    expect(rows[1]).toHaveTextContent('Ny förfrågan')
    expect(rows[2]).toHaveTextContent('Offert skickad')
    expect(screen.getByText('1 väntar på dig')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('link', { name: 'Öppna' })).toHaveAttribute('href', '/catering/loc-1/r-new')
  })

  it('counts deliveries in the coming 7 days by the Stockholm date, not UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 00:30 in Stockholm on 21 November is still 20 November in UTC.
    vi.setSystemTime(new Date('2026-11-20T23:30:00Z'))
    try {
      listRequests.mockResolvedValue([
        request({ requestId: 'r-past', deliveryDate: '2026-11-20', status: 'confirmed' }),
        request({ requestId: 'r-week', deliveryDate: '2026-11-28', status: 'confirmed' }),
      ])
      render(<MemoryRouter><CateringPage /></MemoryRouter>)
      await screen.findAllByRole('row')
      const tile = screen.getByText('Kommande 7 dagar').closest('.stat-tile')!
      expect(tile).toHaveTextContent('1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags requests whose equipment comes back not cleaned', async () => {
    listRequests.mockResolvedValue([
      request({ requestId: 'r-dirty', customerName: 'Bo', equipmentReturn: 'not_cleaned' }),
      request({ requestId: 'r-clean', customerName: 'Cia', equipmentReturn: 'cleaned', createdAt: '2026-10-11T10:00:00Z' }),
    ])
    render(<MemoryRouter><CateringPage /></MemoryRouter>)
    const rows = await screen.findAllByRole('row')
    const dirty = rows.find((r) => r.textContent?.includes('Bo'))!
    const clean = rows.find((r) => r.textContent?.includes('Cia'))!
    expect(dirty).toHaveTextContent('ej rengjord retur')
    expect(clean).not.toHaveTextContent('ej rengjord retur')
  })
})
