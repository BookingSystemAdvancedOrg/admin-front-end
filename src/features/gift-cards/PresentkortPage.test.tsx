import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PresentkortPage from './PresentkortPage'
import * as api from './api'
import { ApiError } from '../../shared/api'
import { errorText } from '../../shared/errors'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getSettings: vi.fn(), saveSettings: vi.fn(), listCards: vi.fn(), getCard: vi.fn(), extendCard: vi.fn(),
  refundCard: vi.fn(), resendCode: vi.fn(),
}))

const settings: api.Settings = { enabled: true, amountsSek: [250, 500], customMinSek: 100, customMaxSek: 5000, validityMonths: 24, version: 1 }
const card: api.Card = { cardId: 'gc1', last4: 'QRST', initialSek: 500, balanceSek: 380, balanceOre: 38000, status: 'active', expiresAt: '2028-11-04T12:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
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
      { txId: 'p1', kind: 'redeem', amountOre: -12000, balanceAfterOre: 38000, channel: 'online', at: '2026-11-05T12:00:00Z' },
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

describe('ERRORS', () => {
  it('explains a 502 notification_unavailable on resend like stripe_unavailable: what failed and that a retry is fine', () => {
    const err = new ApiError(502, 'notification_unavailable', { code: 'notification_unavailable', fromServer: true })
    expect(errorText(err, 'Det gick inte.', api.ERRORS)).toBe('Mejlet kunde inte skickas just nu. Försök igen om en stund.')
    expect(errorText(new ApiError(502, 'stripe_unavailable', { code: 'stripe_unavailable', fromServer: true }), 'Det gick inte.', api.ERRORS))
      .toMatch(/Försök igen om en stund\.$/)
  })
})
