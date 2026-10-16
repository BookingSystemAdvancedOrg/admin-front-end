import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CateringRequestPage from './CateringRequestPage'
import CateringPage from './CateringPage'
import { ApiError } from '../../shared/api'
import { offerTotals } from './cateringApi'
import type { CateringRequest } from './cateringApi'

const getRequest = vi.fn()
const sendOffer = vi.fn()
const saveDraft = vi.fn()
const declineRequest = vi.fn()
const cancelRequest = vi.fn()
const markDelivered = vi.fn()
const listRequests = vi.fn()
vi.mock('./cateringApi', async (orig) => ({
  ...(await orig<typeof import('./cateringApi')>()),
  getRequest: (...a: unknown[]) => getRequest(...a),
  sendOffer: (...a: unknown[]) => sendOffer(...a),
  saveDraft: (...a: unknown[]) => saveDraft(...a),
  declineRequest: (...a: unknown[]) => declineRequest(...a),
  cancelRequest: (...a: unknown[]) => cancelRequest(...a),
  markDelivered: (...a: unknown[]) => markDelivered(...a),
  listRequests: (...a: unknown[]) => listRequests(...a),
}))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  ),
}))
let role = 'owner_user'
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant: { role } }) }))
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
  for (const fn of [getRequest, sendOffer, saveDraft, declineRequest, cancelRequest, markDelivered, listRequests]) fn.mockReset()
})

describe('offerTotals', () => {
  it('matches the server: discount on dishes, 12 % VAT included', () => {
    const t = offerTotals({ lines: [{ name: 'A', unitPrice: 50, quantity: 20 }], discountPercent: 10, deliveryFee: 395, message: '' })
    expect(t).toMatchObject({ subtotal: 100000, discount: 10000, deliveryFee: 39500, total: 129500, vat: 13875 })
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
    expect(await screen.findByRole('status')).toHaveTextContent('Offerten är skickad')
  })

  it('will not send an offer line priced above 10 000 kr', async () => {
    const user = userEvent.setup()
    getRequest.mockResolvedValue(request())
    renderAt()
    const price = await screen.findByLabelText('Rad 1 pris')
    await user.clear(price)
    await user.type(price, '12000')
    expect(screen.getByRole('alert')).toHaveTextContent('Pris per rad får vara högst')
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
    expect(await screen.findByText('Signerad med BankID')).toBeInTheDocument()
    expect(screen.getByText('Anna Andersson (19800101-****)')).toBeInTheDocument()
    expect(screen.getByText('Betald online')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Markera levererad' }))
    expect(markDelivered).toHaveBeenCalledWith('loc-1', 'req-1')
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
      { ...request({ requestId: 'r-sent', status: 'offer_sent', customerName: 'Bo' }) },
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
})
