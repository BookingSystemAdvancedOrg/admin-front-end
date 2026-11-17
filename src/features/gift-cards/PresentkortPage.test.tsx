import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    render(<MemoryRouter><PresentkortPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Presentkort' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Se abonnemanget/ })).toHaveAttribute('href', '/installningar#abonnemang')
    expect(api.listCards).not.toHaveBeenCalled()
  })

  it('tells staff it is for the owner', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { giftCards: true } } }
    render(<PresentkortPage />)
    expect(screen.getByText(/Be ägaren om behörighet/)).toBeInTheDocument()
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

describe('PresentkortPage actions', () => {
  beforeEach(() => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { giftCards: true } } }
  })

  it('asks before Återbetala and refunds only after the second step', async () => {
    vi.mocked(api.getCard).mockResolvedValue({ ...card, transactions: [] })
    vi.mocked(api.refundCard).mockResolvedValue(undefined as never)
    render(<PresentkortPage />)
    fireEvent.click(await screen.findByRole('button', { name: '****QRST' }))
    fireEvent.change(await screen.findByLabelText(/Anledning/), { target: { value: 'Stängt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Återbetala' }))
    expect(await screen.findByText('Återbetala 380 kr?')).toBeInTheDocument()
    expect(api.refundCard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Behåll kortet' }))
    await waitFor(() => expect(screen.queryByText('Återbetala 380 kr?')).not.toBeInTheDocument())
    expect(api.refundCard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Återbetala' }))
    const dialogs = await screen.findAllByRole('button', { name: 'Återbetala' })
    fireEvent.click(dialogs.at(-1)!)
    await waitFor(() => expect(api.refundCard).toHaveBeenCalledWith('gc1', 'Stängt'))
  })

  it('shows the list error with Försök igen instead of waiting forever', async () => {
    vi.mocked(api.listCards).mockRejectedValueOnce(new ApiError(500, 'internal_error', { code: 'internal_error', fromServer: true }))
    render(<PresentkortPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByRole('button', { name: '****QRST' })).toBeInTheDocument()
  })
})

describe('Stockholm dates', () => {
  it('ends an extension at midnight Stockholm time in winter and summer', () => {
    expect(api.endOfStockholmDay('2027-01-15')).toBe('2027-01-15T22:59:59Z')
    expect(api.endOfStockholmDay('2027-07-15')).toBe('2027-07-15T21:59:59Z')
  })

  it('shows the Stockholm date, not the UTC date', () => {
    expect(api.stockholmDate('2027-01-14T23:30:00Z')).toBe('2027-01-15')
    expect(api.stockholmDate('2027-07-14T22:30:00Z')).toBe('2027-07-15')
  })
})

describe('ERRORS', () => {
  it('explains a 502 notification_unavailable on resend like stripe_unavailable: what failed and that a retry is fine', () => {
    const err = new ApiError(502, 'notification_unavailable', { code: 'notification_unavailable', fromServer: true })
    expect(errorText(err, 'Det gick inte.', api.ERRORS)).toBe('Mejlet kunde inte skickas just nu. Det är inte ert fel. Försök igen om en stund, eller rapportera det till Booqy.')
    expect(errorText(new ApiError(502, 'stripe_unavailable', { code: 'stripe_unavailable', fromServer: true }), 'Det gick inte.', api.ERRORS))
      .toMatch(/rapportera det till Booqy\.$/)
  })
})
