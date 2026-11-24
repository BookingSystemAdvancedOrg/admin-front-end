import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CateringRequestPage from './CateringRequestPage'
import CateringPage from './CateringPage'
import { ApiError } from '../../shared/api'
import { formatDate, offerTotals } from './cateringApi'
import type { CateringRequest } from './cateringApi'
import { chooseOption } from '../../test/select'

const getRequest = vi.fn()
const createOfferVersion = vi.fn()
const sendOfferToCustomer = vi.fn()
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
  createOfferVersion: (...a: unknown[]) => createOfferVersion(...a),
  sendOfferToCustomer: (...a: unknown[]) => sendOfferToCustomer(...a),
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
  for (const fn of [getRequest, createOfferVersion, sendOfferToCustomer, saveDraft, declineRequest, cancelRequest, markDelivered, listRequests,
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
    createOfferVersion.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    expect(await screen.findByLabelText('Rad 1 namn')).toHaveValue('Lasagne')
    expect(screen.getByLabelText('Rad 1 pris')).toHaveValue('50')
    await user.clear(screen.getByLabelText('Rad 1 pris'))
    await user.type(screen.getByLabelText('Rad 1 pris'), '55')
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
    expect(createOfferVersion).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
      lines: [{ menuItemId: 'm1', name: 'Lasagne', unitPrice: 55, quantity: 20 }],
    }))
    expect(await screen.findByText('v1 är klar. Signera den med BankID.')).toBeInTheDocument()
  })

  it('adds a catering package for the guests, switches to food only and shows the review label', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({
      guests: 40, reviewedAt: '2026-10-12T11:00:00Z', customerType: 'company', companyName: 'Acme AB',
      signatory: { name: 'Karl Ek', role: 'VD', authorityConfirmed: true },
      request: { lines: [], portions: 0, ...TOTALS, deliveryFeeManual: true },
      fulfilment: 'delivery', deliveryAddress: { street: 'Storgatan 1', postalCode: '11122', city: 'Stockholm' },
    }))
    createOfferVersion.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    expect(await screen.findByText('Under granskning')).toBeInTheDocument()
    expect(screen.getByText('Karl Ek, VD (intygad behörighet)')).toBeInTheDocument()
    expect(screen.getByText(/hittades inte på kartan/)).toBeInTheDocument()
    await chooseOption(screen.getByLabelText('Lägg till från cateringmenyn'), 'p:p1')
    expect(screen.getByLabelText('Rad 1 namn')).toHaveValue('Mingelpaket')
    expect(screen.getByLabelText('Rad 1 antal')).toHaveValue('40')
    await chooseOption(screen.getByLabelText('Moms'), 'food')
    expect(screen.getByText('varav moms 6 %')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
    expect(createOfferVersion).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
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
    expect(await screen.findByText(/Signerad. Nu kan ni skicka offerten/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Signera med BankID' })).not.toBeInTheDocument()
    expect(screen.getByText('Redo att skicka')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skicka till kunden' })).toBeEnabled()
  })

  it('shows a not cleaned return and keeps its fee in the offer', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({
      equipmentReturn: 'not_cleaned',
      request: { lines: [{ menuItemId: 'm1', name: 'Lasagne', unitPrice: 5000, quantity: 20 }], portions: 20,
        equipmentReturn: 'not_cleaned', ...TOTALS, cleaningFee: 35000, total: 135000 },
      settings: { cleaningFee: 500 },
    }))
    createOfferVersion.mockResolvedValue(request({ status: 'offer_sent' }))
    renderAt()
    expect(await screen.findByText('Ej rengjord: vi diskar och rengör')).toBeInTheDocument()
    expect(screen.getByLabelText('Retur av utrustning')).toHaveValue('not_cleaned')
    // the fee the guest saw, not the location's newer one
    expect(screen.getByLabelText('Rengöringsavgift (kr)')).toHaveValue('350')
    expect(screen.getAllByText('Rengöringsavgift')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
    expect(createOfferVersion).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
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
    createOfferVersion.mockResolvedValue(request({ status: 'offer_sent' }))
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
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
    expect(createOfferVersion).toHaveBeenCalledWith('loc-1', 'req-1', expect.objectContaining({
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
    expect(screen.getByRole('button', { name: 'Nästa: signera' })).toBeDisabled()
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
    createOfferVersion.mockRejectedValue(new ApiError(409, 'capacity_full'))
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Nästa: signera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('fullbokad')
  })

  it('prefills the validity date and puts focus on it when the server refuses it', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({ deliveryDate: '2026-11-03' }))
    createOfferVersion.mockRejectedValue(new ApiError(400, 'validUntil must not be after the delivery date',
      { field: 'validUntil', fromServer: true }))
    renderAt()
    const valid = await screen.findByLabelText('Giltig till och med')
    expect(valid).not.toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('efter leveransdagen')
    expect(valid).toHaveFocus()
    expect(valid).toHaveAttribute('aria-invalid', 'true')
    expect(getRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps the typed offer and marks the dropdown the server refused', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request({ settings: { cleaningFee: 500 } }))
    createOfferVersion.mockRejectedValue(new ApiError(400, 'equipmentReturn is not allowed here',
      { field: 'equipmentReturn', fromServer: true }))
    renderAt()
    const delivery = await screen.findByLabelText('Leverans (kr)')
    await user.clear(delivery)
    await user.type(delivery, '250')
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
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
    expect(screen.queryByRole('button', { name: 'Nästa: signera' })).not.toBeInTheDocument()
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

  it('shows how the customer paid and warns when a Swish refund did not arrive', async () => {
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    getRequest.mockResolvedValue(request({
      status: 'confirmed', paid: true, offer, offers: [offer], currentOfferVersion: 1,
      paidWith: { method: 'swish' }, refundedAmount: 50000,
      refundFailed: [{ amount: 50000, at: '2026-10-14T09:00:00Z', refundId: 're_1', method: 'swish' }],
      signature: { name: 'A', personalNumberMasked: 'x', signedAt: '2026-10-13T09:00:00Z', documentHash: 'h' },
      history: [{ action: 'refund_failed', by: 'stripe', at: '2026-10-14T09:00:00Z' }],
    }))
    renderAt()
    expect(await screen.findByText('Betald online · Swish')).toBeInTheDocument()
    expect(screen.getByText('Återbetalningen på 500 kr kom inte fram (Swish). Pengarna är tillbaka på ert Stripe-saldo: '
      + 'betala tillbaka till kunden på annat sätt.')).toBeInTheDocument()
    expect(screen.getByText(/Återbetalningen kom inte fram$/)).toBeInTheDocument()
  })

  it('shows the card a company paid its invoice with', async () => {
    const offer = { version: 1, lines: request().request.lines, totals: TOTALS, validUntil: '2026-11-01' }
    getRequest.mockResolvedValue(request({
      status: 'confirmed', customerType: 'company', companyName: 'AB', paid: true, offer, offers: [offer],
      currentOfferVersion: 1, stripeInvoiceId: 'in_1', invoiceNumber: 'F-1', invoiceStatus: 'paid',
      paidWith: { method: 'card', brand: 'mastercard', last4: '4444' },
      signature: { name: 'A', signedAt: '2026-10-13T09:00:00Z', documentHash: 'h' },
    }))
    renderAt()
    expect(await screen.findByText(/^Faktura F-1/)).toHaveTextContent('Faktura F-1 · betald · Mastercard ****4444')
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

describe('Offer steps: 1 granska, 2 signera, 3 skicka', () => {
  const SIGNER = { name: 'Roma AB', method: 'bankid', signedAt: '2026-10-12T12:00:00Z' }
  const offered = (version: number, extra: Partial<CateringRequest> = {}) => request({
    status: 'offer_sent', currentOfferVersion: version, signing: { offerVersion: version },
    offers: Array.from({ length: version }, (_, i) => ({ version: i + 1, lines: [], totals: TOTALS, validUntil: '2026-11-01' })),
    ...extra,
  })
  const stepOf = (name: string) => within(screen.getByRole('list', { name: 'Steg' })).getByText(name).closest('li') as HTMLElement

  it('keeps Skicka till kunden locked until the restaurant has signed with BankID', async () => {
    getRequest.mockResolvedValue(offered(2))
    renderAt()
    expect(await screen.findByText('Väntar på er signatur')).toBeInTheDocument()
    expect(stepOf('Granska offerten')).toHaveClass('is-done')
    expect(stepOf('Signera med BankID')).toHaveAttribute('aria-current', 'step')
    const send = screen.getByRole('button', { name: 'Skicka till kunden' })
    expect(send).toBeDisabled()
    expect(send).toHaveAccessibleDescription('Signera med BankID först')
    expect(screen.getByRole('button', { name: 'Signera med BankID' })).toHaveClass('primary')
    expect(sendOfferToCustomer).not.toHaveBeenCalled()
  })

  it('after the signature, Skicka till kunden is the primary action and sends that version', async () => {
    const user = userEvent.setup()
    const signedV2 = offered(2, { restaurantSignedAt: SIGNER.signedAt, signing: { offerVersion: 2, restaurant: SIGNER } })
    getRequest.mockResolvedValueOnce(signedV2)
      .mockResolvedValue({ ...signedV2, sentToCustomerAt: '2026-10-12T12:05:00Z' })
    sendOfferToCustomer.mockResolvedValue({ ...signedV2, sentToCustomerAt: '2026-10-12T12:05:00Z' })
    renderAt()
    expect(await screen.findByText('Redo att skicka')).toBeInTheDocument()
    expect(stepOf('Signera med BankID')).toHaveClass('is-done')
    expect(stepOf('Skicka till kunden')).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByText('Signera med BankID först')).not.toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Skicka till kunden' })
    expect(send).toBeEnabled()
    expect(send).toHaveClass('primary')
    await user.click(send)
    expect(sendOfferToCustomer).toHaveBeenCalledWith('loc-1', 'req-1', 2)
    expect(await screen.findByText('Skickad. Kunden signerar med BankID.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skicka till kunden' })).not.toBeInTheDocument()
  })

  it('explains in plain Swedish when the server refuses an unsigned version', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(offered(1, { restaurantSignedAt: SIGNER.signedAt, signing: { offerVersion: 1, restaurant: SIGNER } }))
    sendOfferToCustomer.mockRejectedValue(new ApiError(409, 'restaurant_signature_required'))
    renderAt()
    await user.click(await screen.findByRole('button', { name: 'Skicka till kunden' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Signera med BankID först. Sedan kan ni skicka offerten till kunden.')
  })

  it('a new version needs a new restaurant signature before it can be sent', async () => {
    const user = userEvent.setup()
    const sentV1 = offered(1, { restaurantSignedAt: SIGNER.signedAt, sentToCustomerAt: '2026-10-12T12:05:00Z',
      signing: { offerVersion: 1, restaurant: SIGNER } })
    const v2 = offered(2)
    getRequest.mockResolvedValueOnce(sentV1).mockResolvedValue(v2)
    createOfferVersion.mockResolvedValue(v2)
    renderAt()
    expect(await screen.findByText('Skickad. Kunden signerar med BankID.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ny offertversion (v2)' })).toBeInTheDocument()
    expect(screen.getByText('Ny signatur krävs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nästa: signera' }))
    expect(createOfferVersion).toHaveBeenCalled()
    expect(await screen.findByText('Väntar på er signatur')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Offert v2' })).toBeInTheDocument()
    expect(stepOf('Signera med BankID')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Skicka till kunden' })).toBeDisabled()
    expect(screen.getByText(/ej signerad av er/)).toBeInTheDocument()
  })
})

function Opened() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  return (
    <>
      <p>Öppnad {requestId}</p>
      <button type="button" onClick={() => navigate(-1)}>Tillbaka</button>
    </>
  )
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/catering']}>
      <Routes>
        <Route path="/catering" element={<CateringPage />} />
        <Route path="/catering/:locationId/:requestId" element={<Opened />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CateringPage', () => {
  const twoRows = () => [
    request({ requestId: 'r-bo', customerName: 'Bo', deliveryDate: '2026-11-20' }),
    request({ requestId: 'r-cia', customerName: 'Cia', companyName: 'Cia AB', deliveryDate: '2026-11-21' }),
  ]

  it('opens a request from anywhere on its row, on every row', async () => {
    listRequests.mockResolvedValue(twoRows())
    const user = userEvent.setup()
    const first = renderList()
    await user.click(await screen.findByText('Cia AB · Cia'))
    expect(await screen.findByText('Öppnad r-cia')).toBeInTheDocument()
    first.unmount()
    renderList()
    const rows = await screen.findAllByRole('row')
    await user.click(within(rows[1]).getByText('Avhämtning'))
    expect(await screen.findByText('Öppnad r-bo')).toBeInTheDocument()
  })

  it('has one link per row and a click on Öppna opens once, not twice', async () => {
    listRequests.mockResolvedValue(twoRows())
    const user = userEvent.setup()
    renderList()
    const rows = (await screen.findAllByRole('row')).slice(1)
    for (const row of rows) {
      expect(within(row).getAllByRole('link')).toHaveLength(1)
      expect(within(row).queryByRole('button')).toBeNull()
    }
    await user.click(within(rows[0]).getByRole('link'))
    expect(await screen.findByText('Öppnad r-bo')).toBeInTheDocument()
    // Ett steg tillbaka är listan igen: raden lade inte till en andra navigering.
    await user.click(screen.getByRole('button', { name: 'Tillbaka' }))
    expect(await screen.findByText('Förfrågningar och beställningar')).toBeInTheDocument()
  })

  it('a press that only closes the open filter list does not open the row under it', async () => {
    listRequests.mockResolvedValue(twoRows())
    const user = userEvent.setup()
    renderList()
    const rows = await screen.findAllByRole('row')
    await user.click(screen.getByRole('combobox', { name: 'Visa' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.click(within(rows[1]).getByText('Bo'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByText('Öppnad r-bo')).toBeNull()
    // Nästa tryck, utan öppen lista, öppnar raden som vanligt.
    await user.click(within(rows[1]).getByText('Bo'))
    expect(await screen.findByText('Öppnad r-bo')).toBeInTheDocument()
  })

  it('reaches each row with Tab, names it by customer and date, opens with Enter and Space', async () => {
    listRequests.mockResolvedValue(twoRows())
    const user = userEvent.setup()
    const first = renderList()
    const links = await screen.findAllByRole('link', { name: /^Öppna / })
    expect(links[0]).toHaveAccessibleName(`Öppna Bo, ${formatDate('2026-11-20')} 12:00`)
    expect(links[1]).toHaveAccessibleName(`Öppna Cia AB, Cia, ${formatDate('2026-11-21')} 12:00`)
    for (let i = 0; i < 10 && document.activeElement !== links[0]; i++) await user.tab()
    expect(links[0]).toHaveFocus()
    await user.tab()
    expect(links[1]).toHaveFocus()
    await user.keyboard(' ')
    expect(await screen.findByText('Öppnad r-cia')).toBeInTheDocument()
    first.unmount()
    renderList()
    const again = await screen.findAllByRole('link', { name: /^Öppna / })
    again[0].focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Öppnad r-bo')).toBeInTheDocument()
  })

  it('lists requests waiting for the owner first', async () => {
    listRequests.mockResolvedValue([
      { ...request({ requestId: 'r-sent', status: 'offer_sent', customerName: 'Bo', restaurantSignedAt: '2026-10-12T12:00:00Z',
        sentToCustomerAt: '2026-10-12T12:05:00Z' }) },
      { ...request({ requestId: 'r-new', status: 'requested', customerName: 'Cia' }) },
    ])
    render(<MemoryRouter><CateringPage /></MemoryRouter>)
    const rows = await screen.findAllByRole('row')
    expect(rows[1]).toHaveTextContent('Cia')
    expect(rows[1]).toHaveTextContent('Ny förfrågan')
    expect(rows[2]).toHaveTextContent('Offert skickad')
    expect(screen.getByText('1 väntar på dig')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('link', { name: /^Öppna Cia, / })).toHaveAttribute('href', '/catering/loc-1/r-new')
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
