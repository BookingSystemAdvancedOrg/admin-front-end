import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KassaGiftCardButton from './KassaGiftCardButton'
import { KASSA_ACCEPTS_GIFT_CARDS, resetKassaRefusedForTests } from './kassaAvailability'
import PresentkortPage from './PresentkortPage'
import * as api from './api'
import { ApiError } from '../../shared/api'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getSettings: vi.fn(), saveSettings: vi.fn(), listCards: vi.fn(), getCard: vi.fn(), extendCard: vi.fn(),
  refundCard: vi.fn(), resendCode: vi.fn(), lookupCode: vi.fn(), redeemCode: vi.fn(), reverseRedemption: vi.fn(),
  addKassaGiftCardPayment: vi.fn(),
}))

const settings: api.Settings = { enabled: true, amountsSek: [250, 500], customMinSek: 100, customMaxSek: 5000, validityMonths: 24, version: 1 }
const card: api.Card = { cardId: 'gc1', last4: 'QRST', initialSek: 500, balanceSek: 380, balanceOre: 38000, status: 'active', expiresAt: '2028-11-04T12:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  resetKassaRefusedForTests()
  vi.mocked(api.getSettings).mockResolvedValue(settings)
  vi.mocked(api.listCards).mockResolvedValue({ cards: [card], liabilitySek: 380, liabilityOre: 38000, cursor: null })
})

describe('PresentkortPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<PresentkortPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Presentkort' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(api.listCards).not.toHaveBeenCalled()
  })

  it('tells staff it is for the owner', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { giftCards: true } } }
    render(<PresentkortPage />)
    expect(screen.getByRole('heading', { name: 'Bara för ägare' })).toBeInTheDocument()
    expect(api.listCards).not.toHaveBeenCalled()
  })

  it('lists the cards and opens one with its history', async () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { giftCards: true } } }
    vi.mocked(api.getCard).mockResolvedValue({ ...card, transactions: [
      { txId: 'issue-1', kind: 'issue', amountOre: 50000, balanceAfterOre: 50000, channel: 'online', at: '2026-11-04T12:00:00Z' },
      { txId: 'p1', kind: 'redeem', amountOre: -12000, balanceAfterOre: 38000, channel: 'kassa', at: '2026-11-05T12:00:00Z' },
    ] })
    render(<PresentkortPage />)
    fireEvent.click(await screen.findByRole('button', { name: '****QRST' }))
    expect(await screen.findByText(/Inlöst/)).toBeInTheDocument()
    expect(screen.getByText('Presentkortsskuld')).toBeInTheDocument()
  })

  it('asks before "Skicka ny kod" because the old code stops working', async () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { giftCards: true } } }
    vi.mocked(api.getCard).mockResolvedValue({ ...card, recipientEmail: 'sara@example.se', transactions: [] })
    vi.mocked(api.resendCode).mockResolvedValue({ last4: 'WXYZ' })
    render(<PresentkortPage />)
    fireEvent.click(await screen.findByRole('button', { name: '****QRST' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Skicka ny kod' }))
    expect(api.resendCode).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Den gamla koden (****QRST) slutar fungera direkt')
    fireEvent.click(screen.getByRole('button', { name: 'Behåll koden' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.resendCode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Skicka ny kod' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ja, skicka ny kod' }))
    await waitFor(() => expect(api.resendCode).toHaveBeenCalledWith('gc1', 'recipient'))
  })
})

describe('KassaGiftCardButton', () => {
  it('is hidden while Kassa refuses gift cards (no voucher payment means yet)', () => {
    expect(KASSA_ACCEPTS_GIFT_CARDS).toBe(false)
    const { container } = render(<KassaGiftCardButton locationId="loc-1" billId="bill-1" remainingOre={15000} onPaid={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Presentkort' })).not.toBeInTheDocument()
  })

  it('hides itself after Kassa answers 501 and puts the amount back', async () => {
    vi.mocked(api.lookupCode).mockResolvedValue({ cardId: 'gc1', last4: 'QRST', balanceSek: 380, balanceOre: 38000, expiresAt: '', status: 'active' })
    vi.mocked(api.redeemCode).mockResolvedValue({ txId: 't', balanceAfterSek: 230, balanceAfterOre: 23000, cardLast4: 'QRST' })
    vi.mocked(api.addKassaGiftCardPayment).mockRejectedValue(new ApiError(501, 'gift_card_receipt_not_supported', { code: 'gift_card_receipt_not_supported', fromServer: true }))
    vi.mocked(api.reverseRedemption).mockResolvedValue({ balanceAfterSek: 380 })
    const onPaid = vi.fn()
    render(<KassaGiftCardButton forceAvailable locationId="loc-1" billId="bill-1" remainingOre={15000} onPaid={onPaid} />)
    fireEvent.click(screen.getByRole('button', { name: 'Presentkort' }))
    fireEvent.change(screen.getByLabelText(/Kod/), { target: { value: 'ABCDEFGHJKMNPQRS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kolla saldo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ta betalt' }))
    await waitFor(() => expect(api.reverseRedemption).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Presentkort' })).not.toBeInTheDocument())
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('checks the balance, redeems, hands the payment to Kassa and reports it', async () => {
    vi.mocked(api.lookupCode).mockResolvedValue({ cardId: 'gc1', last4: 'QRST', balanceSek: 380, balanceOre: 38000, expiresAt: '', status: 'active' })
    vi.mocked(api.redeemCode).mockResolvedValue({ txId: 't', balanceAfterSek: 230, balanceAfterOre: 23000, cardLast4: 'QRST' })
    vi.mocked(api.addKassaGiftCardPayment).mockResolvedValue({})
    const onPaid = vi.fn()
    render(<KassaGiftCardButton forceAvailable locationId="loc-1" billId="bill-1" remainingOre={15000} onPaid={onPaid} />)
    fireEvent.click(screen.getByRole('button', { name: 'Presentkort' }))
    fireEvent.change(screen.getByLabelText(/Kod/), { target: { value: 'abcd-efgh-jkmn-pqrs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kolla saldo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ta betalt' }))
    await waitFor(() => expect(onPaid).toHaveBeenCalled())
    const [, body] = vi.mocked(api.redeemCode).mock.calls[0]
    expect(body).toMatchObject({ code: 'ABCD-EFGH-JKMN-PQRS', amountOre: 15000, billId: 'bill-1' })
    expect(api.addKassaGiftCardPayment).toHaveBeenCalledWith('loc-1', 'bill-1', body.txId)
  })

  it('puts the amount back when Kassa refuses the payment', async () => {
    vi.mocked(api.lookupCode).mockResolvedValue({ cardId: 'gc1', last4: 'QRST', balanceSek: 380, balanceOre: 38000, expiresAt: '', status: 'active' })
    vi.mocked(api.redeemCode).mockResolvedValue({ txId: 't', balanceAfterSek: 230, balanceAfterOre: 23000, cardLast4: 'QRST' })
    vi.mocked(api.addKassaGiftCardPayment).mockRejectedValue(new Error('501'))
    vi.mocked(api.reverseRedemption).mockResolvedValue({ balanceAfterSek: 380 })
    const onPaid = vi.fn()
    render(<KassaGiftCardButton forceAvailable locationId="loc-1" billId="bill-1" remainingOre={15000} onPaid={onPaid} />)
    fireEvent.click(screen.getByRole('button', { name: 'Presentkort' }))
    fireEvent.change(screen.getByLabelText(/Kod/), { target: { value: 'ABCDEFGHJKMNPQRS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kolla saldo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ta betalt' }))
    await waitFor(() => expect(api.reverseRedemption).toHaveBeenCalled())
    expect(onPaid).not.toHaveBeenCalled()
  })
})
