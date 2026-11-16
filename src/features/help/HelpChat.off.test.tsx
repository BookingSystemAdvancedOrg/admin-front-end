import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminLayout } from '../../shared/AdminLayout'
import { helpChatEnabled } from './chatState'

/**
 * 403 help_assistant_off mitt i ett samtal: assistenten försvinner överallt,
 * också ur ⌘K och ur Mer-arket i menyn längst ner på telefonen.
 */

const help = vi.hoisted(() => ({ askHelp: vi.fn(), getHelpStatus: vi.fn() }))
vi.mock('./helpApi', async (orig) => ({
  ...(await orig<typeof import('./helpApi')>()),
  askHelp: help.askHelp,
  getHelpStatus: help.getHelpStatus,
}))
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ email: 'a@example.se', sub: 'u1', groups: [], logout: () => {} }),
}))
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({
    tenant: {
      tenantId: 't1',
      name: 'Roma',
      role: 'owner_user',
      locations: [{ locationId: 'l1', name: 'Roma City', timezone: 'Europe/Stockholm' }],
      entitlements: { maxLocations: null, features: {} },
    },
    status: 'ready',
    error: null,
    locationId: 'l1',
    refresh: async () => null,
  }),
  selectLocation: () => {},
}))
vi.mock('../dpa/DpaBanner', () => ({ DpaBanner: () => null }))

const realMatchMedia = window.matchMedia
function phoneWidth() {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') || query.includes('max-width: 600px') || query.includes('max-width: 900px'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

const SLOW = { timeout: 10_000 }

const dock = () => screen.getByRole('navigation', { name: 'Snabbmeny' })
function openSheet() {
  fireEvent.click(within(dock()).getByRole('button', { name: /^Mer/ }))
  return screen.getByRole('dialog', { name: 'Mer' })
}
function closeSheet() {
  fireEvent.click(within(dock()).getByRole('button', { name: /^Mer/ }))
}
/** ⌘K, sök på "assistent": finns Fråga hjälpassistenten? */
function paletteHasAsk(): boolean {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: 'assistent' } })
  const found = screen.queryAllByRole('option').some((o) => o.textContent?.includes('Fråga hjälpassistenten'))
  act(() => {
    fireEvent.keyDown(input, { key: 'Escape' })
  })
  return found
}

beforeEach(() => {
  phoneWidth()
  help.getHelpStatus.mockReset().mockResolvedValue({ enabled: true, mode: 'ai' })
  help.askHelp.mockReset()
})
afterEach(() => {
  window.matchMedia = realMatchMedia
  document.documentElement.classList.remove('dock-hidden', 'drawer-lock')
})

describe('help_assistant_off', () => {
  it('hides the Cmd+K item and the BottomNav quick action', async () => {
    const { HelpOff } = await import('./helpApi')
    help.askHelp.mockRejectedValue(new HelpOff())
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AdminLayout />}>
            <Route path="*" element={<p>Sidan</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(helpChatEnabled()).toBe(true), SLOW)

    // På: Fråga Booqy i arket och i ⌘K.
    expect(paletteHasAsk()).toBe(true)
    await user.click(within(openSheet()).getByRole('button', { name: 'Fråga Booqy' }))
    await user.type(await screen.findByRole('textbox', { name: 'Din fråga' }, SLOW), 'Hur lägger jag till en rätt?{Enter}')

    // Booqy stängde av assistenten: borta överallt.
    await waitFor(() => expect(helpChatEnabled()).toBe(false), SLOW)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Din fråga' })).toBeNull(), SLOW)
    expect(within(openSheet()).queryByRole('button', { name: 'Fråga Booqy' })).toBeNull()
    expect(within(screen.getByRole('dialog', { name: 'Mer' })).getByRole('button', { name: 'Sök' })).toBeInTheDocument()
    closeSheet()
    expect(paletteHasAsk()).toBe(false)
  }, 30_000)
})
