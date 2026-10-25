import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscribersTab } from './SubscribersTab'
import type { Subscriber } from './marketingApi'

const api = vi.hoisted(() => ({
  listSubscribers: vi.fn(),
  findSubscriber: vi.fn(),
  withdrawConsent: vi.fn(),
  eraseGuest: vi.fn(),
  lookupConsent: vi.fn(),
}))
vi.mock('./marketingApi', async (orig) => ({
  ...(await orig<typeof import('./marketingApi')>()),
  listSubscribers: (...a: unknown[]) => api.listSubscribers(...a),
  findSubscriber: (...a: unknown[]) => api.findSubscriber(...a),
}))
vi.mock('../installningar/privacyApi', async (orig) => ({
  ...(await orig<typeof import('../installningar/privacyApi')>()),
  withdrawConsent: (...a: unknown[]) => api.withdrawConsent(...a),
  eraseGuest: (...a: unknown[]) => api.eraseGuest(...a),
  lookupConsent: (...a: unknown[]) => api.lookupConsent(...a),
}))

const anna: Subscriber = {
  subscriberId: 'a'.repeat(24),
  email: 'anna@example.se',
  name: 'Anna Andersson',
  status: 'subscribed',
  consentAt: '2026-09-14T18:02:11Z',
  consentSource: 'booking',
  lastVisit: '2026-09-20',
  locations: ['loc-1'],
  unsubscribedAt: null,
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.listSubscribers.mockResolvedValue({ subscribers: [anna], cursor: null })
})

describe('SubscribersTab', () => {
  it('unsubscribes through the logged privacy endpoint', async () => {
    const user = userEvent.setup()
    api.withdrawConsent.mockResolvedValue({ withdrawn: ['email'] })
    render(<SubscribersTab />)
    await user.click(await screen.findByRole('button', { name: 'Avregistrera' }))
    expect(api.withdrawConsent).toHaveBeenCalledWith(['email'], 'anna@example.se')
    expect(await screen.findByText('anna@example.se får inga fler utskick.')).toBeInTheDocument()
  })

  it('erases the guest after confirming and says what was kept', async () => {
    const user = userEvent.setup()
    api.eraseGuest.mockResolvedValue({
      consentWithdrawn: ['email'], marketingRowsDeleted: 1, anonymised: 2,
      kept: [{ kind: 'booking', locationId: 'loc-1', status: 'reserved', date: '2026-12-24', id: 'r1' }],
    })
    render(<SubscribersTab />)
    await user.click(await screen.findByRole('button', { name: 'Radera' }))
    const dialog = screen.getByRole('dialog', { name: 'Radera gästens uppgifter' })
    await user.click(within(dialog).getByRole('button', { name: 'Radera' }))
    expect(api.eraseGuest).toHaveBeenCalledWith('anna@example.se')
    expect(await screen.findByText(/2 poster anonymiserades/)).toHaveTextContent(
      'Adressen tas bort ur samtyckesloggen vid nästa automatiska gallring',
    )
    expect(screen.getByText(/Bokning 2026-12-24/)).toBeInTheDocument()
  })

  it('shows the consent history', async () => {
    const user = userEvent.setup()
    api.lookupConsent.mockResolvedValue({
      email: { state: 'granted', history: [{ at: '2026-09-14T18:02:11Z', action: 'grant', channel: 'email',
                                             source: 'booking', by: 'guest', textVersion: 'offers_v1', text: 'Ja tack' }] },
    })
    render(<SubscribersTab />)
    await user.click(await screen.findByRole('button', { name: 'Historik' }))
    const dialog = screen.getByRole('dialog', { name: 'Samtyckeshistorik' })
    expect(await within(dialog).findByText('Samtycke lämnat (bokning)')).toBeInTheDocument()
    expect(api.lookupConsent).toHaveBeenCalledWith('anna@example.se')
  })

  it('searches by e-mail and filters the suppressed group', async () => {
    const user = userEvent.setup()
    api.findSubscriber.mockResolvedValue({ subscribers: [], cursor: null })
    render(<SubscribersTab />)
    await screen.findByText('Anna Andersson')
    await user.type(screen.getByLabelText('Sök på e-post'), ' Bo@Example.se')
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    expect(api.findSubscriber).toHaveBeenCalledWith('bo@example.se')
    expect(await screen.findByText('Ingen mottagare med adressen bo@example.se.')).toBeInTheDocument()
    api.listSubscribers.mockResolvedValue({
      subscribers: [{ ...anna, email: null, name: null, status: 'bounced' }], cursor: null,
    })
    await user.selectOptions(screen.getByLabelText('Visa'), 'suppressed')
    expect(api.listSubscribers).toHaveBeenLastCalledWith('suppressed')
    expect(await screen.findByText('Adressen raderad, spärren finns kvar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Radera' })).not.toBeInTheDocument()
  })
})
