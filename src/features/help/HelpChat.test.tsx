import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCorpus } from '../../../scripts/help-corpus.mjs'
import { setCorpus } from './corpus'
import { takePageAction } from '../../shared/nav'
import { openHelpChat } from './chatState'
import { HelpChat } from './HelpChat'
import { OWNER_TEXT } from './retrieve'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant, status: 'ready', error: null, locationId: 'loc-1', refresh: async () => null }),
}))

function as(role: string, features: Record<string, boolean> = { reservations: true }) {
  tenant = { tenantId: 't1', name: 'Roma', role, locations: [{ locationId: 'loc-1', name: 'Roma', address: null, timezone: 'Europe/Stockholm' }], entitlements: { maxLocations: null, features } }
}

function Where() {
  const { pathname, search, hash } = useLocation()
  return (
    <>
      <p data-testid="where">{`${pathname}${search}${hash}`}</p>
      {/* Det som assistenten lyser upp på riktiga sidor. */}
      {pathname === '/installningar' && hash === '#utseende' && <div className="appearance-row" data-help="utseende:bakgrund">Bakgrund</div>}
      {pathname === '/statistik' && <div className="sk-kpi" data-help="kpi:gaster-idag">Gäster idag</div>}
    </>
  )
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HelpChat />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Fråga Booqy' }))
  return screen.getByRole('dialog', { name: 'Hjälpassistenten' })
}

describe('HelpChat', () => {
  beforeAll(() => setCorpus(buildCorpus()))
  beforeEach(() => as('owner_user'))

  it('answers a question about today\'s Bakgrund setting and lights it up', async () => {
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    await user.type(screen.getByRole('textbox', { name: 'Din fråga' }), 'Hur ändrar jag bakgrundsfärgen?{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Visa Bakgrund' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/installningar#utseende')
    await waitFor(() => expect(document.querySelector('[data-help="utseende:bakgrund"]')).toHaveClass('help-spotlight'))
  })

  it('answers with the live number and shows it on Statistik, lit up', async () => {
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    await user.type(screen.getByRole('textbox', { name: 'Din fråga' }), 'Hur många gäster har vi haft idag?{Enter}')
    await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent(/Idag har ni \d+ gäster i bokningarna/))
    expect(screen.getByTestId('where')).toHaveTextContent('/statistik')
    await waitFor(() => expect(document.querySelector('[data-help="kpi:gaster-idag"]')).toHaveClass('help-spotlight'))
    // Panelen står kvar och sidan lämnas där den är.
    expect(screen.getByRole('dialog', { name: 'Hjälpassistenten' })).toBeInTheDocument()
  })

  it('answers the menu question step by step and opens Meny with the new-dish form', async () => {
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    const input = screen.getByRole('textbox', { name: 'Din fråga' })
    expect(input).toHaveFocus()
    await user.type(input, 'Var skapar jag en ny rätt i menyn och hur gör jag?{Enter}')

    const log = screen.getByRole('log', { name: 'Samtal' })
    await waitFor(() => expect(log).toHaveTextContent('Tryck Lägg till rätt.'))
    const steps = screen.getAllByRole('listitem').filter((li) => li.closest('.help-steps'))
    expect(steps[0]).toHaveTextContent('Öppna Meny')

    const go = screen.getByRole('button', { name: 'Öppna Meny med ny rätt' })
    expect(go).toHaveClass('primary')
    await user.click(go)
    expect(screen.getByTestId('where')).toHaveTextContent('/meny')
    expect(takePageAction('new-dish')).toBe(true)
  })

  it('opens Inställningar on the right section', async () => {
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    await user.type(screen.getByRole('textbox', { name: 'Din fråga' }), 'Hur ändrar jag öppettiderna?{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Öppna Restaurang' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/installningar#profil')
  })

  it('never gives staff the owner-only steps', async () => {
    as('staff_user')
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    await user.type(screen.getByRole('textbox', { name: 'Din fråga' }), 'Hur bjuder jag in personal?{Enter}')
    await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent(OWNER_TEXT))
    expect(screen.queryByRole('button', { name: /Bjud in/ })).toBeNull()
    expect(document.querySelector('.help-steps')).toBeNull()
  })

  it('shows only suggestions the user may ask and asks them on click', async () => {
    as('staff_user')
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    expect(screen.queryByRole('button', { name: 'Hur bjuder jag in personal?' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Hur lägger jag in en bokning?' }))
    await screen.findByRole('button', { name: 'Öppna Ny bokning' })
  })

  it('closes with Escape and gives focus back', async () => {
    const user = userEvent.setup()
    renderChat()
    await openPanel(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fråga Booqy' })).toHaveFocus())
  })

  it('opens from the command palette', async () => {
    renderChat()
    await screen.findByRole('button', { name: 'Fråga Booqy' })
    act(() => openHelpChat())
    expect(screen.getByRole('dialog', { name: 'Hjälpassistenten' })).toBeInTheDocument()
  })
})
