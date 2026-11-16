import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { helpChatEnabled } from './chatState'
import { HelpChat } from './HelpChat'

const help = vi.hoisted(() => ({ askHelp: vi.fn() }))
vi.mock('./helpApi', async (orig) => ({
  ...(await orig<typeof import('./helpApi')>()),
  askHelp: help.askHelp,
}))

const report = vi.hoisted(() => ({ sendReport: vi.fn(async () => 'sent' as const) }))
vi.mock('../../shared/supportReport', () => report)

vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({
    tenant: { tenantId: 't1', name: 'Roma', role: 'owner_user', locations: [{ locationId: 'loc-1', name: 'Roma', address: null, timezone: 'Europe/Stockholm' }], entitlements: { maxLocations: null, features: { reservations: true } } },
    status: 'ready',
    error: null,
    locationId: 'loc-1',
    refresh: async () => null,
  }),
}))

async function ask(question: string) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <HelpChat />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: 'Fråga Booqy' }))
  await user.type(screen.getByRole('textbox', { name: 'Din fråga' }), `${question}{Enter}`)
  return user
}

describe('HelpChat when it cannot answer', () => {
  beforeEach(() => {
    help.askHelp.mockReset()
    report.sendReport.mockClear()
  })

  it('switched off by Booqy: panel, button and palette action are gone, no answer', async () => {
    const { HelpOff } = await import('./helpApi')
    help.askHelp.mockRejectedValue(new HelpOff())
    await ask('Hur lägger jag till en rätt?')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Fråga Booqy' })).toBeNull()
    expect(helpChatEnabled()).toBe(false)
  })

  it('Booqys fel: one click reports it to Booqy with the request id', async () => {
    const { HelpUnavailable } = await import('./helpApi')
    const { ApiError } = await import('../../shared/api')
    help.askHelp.mockRejectedValue(new HelpUnavailable(new ApiError(503, 'service_unavailable', { requestId: 'req-9', fromServer: true })))
    const user = await ask('Hur?')
    const log = screen.getByRole('list', { name: 'Samtal' })
    await waitFor(() => expect(log).toHaveTextContent('Felet ligger hos Booqy'))
    await user.click(screen.getByRole('button', { name: 'Rapportera till Booqy' }))
    expect(report.sendReport).toHaveBeenCalledWith(expect.objectContaining({ actor: 'booqy', code: 'service_unavailable', status: 503, requestId: 'req-9' }))
    await screen.findByText('Tack. Booqy har fått rapporten och tittar på felet.')
  })

  it('Försök igen asks the same question again', async () => {
    const { HelpUnavailable } = await import('./helpApi')
    help.askHelp.mockRejectedValueOnce(new HelpUnavailable(null)).mockResolvedValueOnce({ text: 'Svaret.', steps: [], actions: [] })
    const user = await ask('Hur?')
    await user.click(await screen.findByRole('button', { name: 'Försök igen' }))
    await screen.findByText('Svaret.')
    expect(help.askHelp).toHaveBeenLastCalledWith('Hur?', expect.anything(), expect.anything())
  })

  it('429: the limit notice, without a report button', async () => {
    const { HelpLimited } = await import('./helpApi')
    help.askHelp.mockRejectedValue(new HelpLimited())
    await ask('Hur?')
    await screen.findByText('Du har ställt många frågor på kort tid. Vänta en stund och fråga igen.')
    expect(screen.queryByRole('button', { name: 'Rapportera till Booqy' })).toBeNull()
  })
})
