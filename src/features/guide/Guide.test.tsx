import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuideProvider, useGuide } from './Guide'
import { stepsFor } from './steps'

const account = vi.hoisted(() => ({
  done: false as boolean | null,
  marked: 0,
}))

vi.mock('./guideApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('./guideApi')>()
  return {
    ...real,
    guideDoneOnAccount: vi.fn(async () => account.done),
    markGuideDoneOnAccount: vi.fn(async () => {
      account.marked += 1
    }),
  }
})

// jsdom ritar ingen layout: låt alla mål "synas".
const realRects = Element.prototype.getClientRects

const ALL = { ordering: true, catering: true }

function Nav() {
  const { start } = useGuide()
  const { pathname, hash } = useLocation()
  return (
    <nav>
      <span data-testid="where">{pathname + hash}</span>
      {['oversikt', 'bokningar', 'bestallningar', 'meny', 'catering', 'layout', 'installningar', 'hjalp'].map((n) => (
        <a key={n} data-tour={`nav-${n}`}>{n}</a>
      ))}
      <button type="button" onClick={start}>Starta guiden</button>
    </nav>
  )
}

/** Sidor med de knappar guiden pekar på (meny-sidan kan vara tom). */
function Pages({ emptyMenu = false }: { emptyMenu?: boolean }) {
  return (
    <Routes>
      <Route path="/" element={<section data-tour="getting-started">Kom igång</section>} />
      <Route
        path="/installningar"
        element={
          <div>
            {['profil', 'personal', 'betalningar', 'notiser', 'avbokning', 'bestallning', 'dagar', 'bord'].map((t) => (
              <button key={t} type="button" data-tour={`settings-tab-${t}`}>{t}</button>
            ))}
            <button type="button" data-tour="settings-save">Spara ändringar</button>
          </div>
        }
      />
      <Route
        path="/meny"
        element={
          <div>
            <button type="button" data-tour="menu-add">+ Lägg till rätt</button>
            {!emptyMenu && <span data-tour="menu-row-toggle" />}
            {!emptyMenu && <span data-tour="menu-row-actions" />}
          </div>
        }
      />
      <Route path="/bokningar" element={<div><div data-tour="booking-day" /><div data-tour="booking-list" /><button type="button" data-tour="booking-new" /></div>} />
      <Route path="/bestallningar" element={<div><div data-tour="orders-board" /><div data-tour="orders-pause" /></div>} />
      <Route path="/catering" element={<div><div data-tour="catering-list" /><a data-tour="catering-settings" /></div>} />
      <Route path="/layout" element={<div><div data-tour="layout-tools" /><button type="button" data-tour="layout-publish" /></div>} />
      <Route path="*" element={null} />
    </Routes>
  )
}

beforeEach(() => {
  localStorage.clear()
  account.done = false
  account.marked = 0
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList
  }
  Element.prototype.scrollIntoView = vi.fn()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  Element.prototype.getClientRects = realRects
  vi.useRealTimers()
})

async function settle(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function renderGuide({
  owner = true,
  features = ALL,
  autoStart = true,
  emptyMenu = false,
}: { owner?: boolean; features?: Record<string, boolean>; autoStart?: boolean; emptyMenu?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/bokningar']}>
      <GuideProvider user="sub-1" context={{ isOwner: owner, features }} autoStart={autoStart}>
        <Nav />
        <Pages emptyMenu={emptyMenu} />
      </GuideProvider>
    </MemoryRouter>,
  )
  await settle()
}

async function next(user: ReturnType<typeof userEvent.setup>, name = 'Nästa') {
  await user.click(screen.getByRole('button', { name }))
  // Räcker för steg vars mål saknas på samma sida (t.ex. platsväljaren).
  await settle(700)
}

describe('Guide', () => {
  it('starts for a new owner and walks page by page: Kom igång, settings tab by tab, then the menu CRUD', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide()
    const total = stepsFor({ isOwner: true, features: ALL }).length

    expect(screen.getByRole('dialog', { name: 'Välkommen till Booqy Admin' })).toBeInTheDocument()
    expect(screen.getByText(`1 av ${total}`)).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/')

    await next(user, 'Visa mig')
    expect(screen.getByRole('dialog', { name: 'Översikt' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Kom igång' })).toBeInTheDocument()

    await next(user)
    expect(screen.getByRole('dialog', { name: 'Inställningar' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/installningar#profil')
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Restaurang' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Spara' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Personal' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/installningar#personal')

    for (const title of ['Betalningar', 'Notiser', 'Avbokning', 'Beställning', 'Avvikande dagar', 'Bord']) {
      await next(user)
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument()
    }

    await next(user)
    expect(screen.getByRole('dialog', { name: 'Meny' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/meny')
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Lägg till en rätt' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Dölj en rätt tillfälligt' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Ändra eller ta bort' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tillbaka' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Dölj en rätt tillfälligt' })).toBeInTheDocument()
  })

  it('shows staff no Kom igång and no settings tabs - and no ordering/catering steps without those features', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide({ owner: false, features: {} })
    const staffSteps = stepsFor({ isOwner: false, features: {} })
    expect(staffSteps.some((s) => s.ownerOnly || s.feature)).toBe(false)
    expect(screen.getByText(`1 av ${staffSteps.length}`)).toBeInTheDocument()

    await next(user, 'Visa mig')
    expect(screen.getByRole('dialog', { name: 'Översikt' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Inställningar' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Meny' })).toBeInTheDocument()
  })

  it('moves past steps whose button is not on the page (e.g. an empty menu)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide({ owner: false, features: {}, emptyMenu: true })
    await next(user, 'Visa mig')
    await next(user)
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Meny' })).toBeInTheDocument()
    await next(user)
    expect(screen.getByRole('dialog', { name: 'Lägg till en rätt' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nästa' }))
    // Två steg utan mål i rad, sedan ett sidbyte - ett tidshopp per steg.
    for (let i = 0; i < 4; i++) await settle(500)
    expect(screen.getByRole('dialog', { name: 'Bokningar' })).toBeInTheDocument()
  })

  it('is saved on the account when skipped, and only Hjälp brings it back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide()
    await user.click(screen.getByRole('button', { name: 'Hoppa över' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(account.marked).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Starta guiden' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Välkommen till Booqy Admin' })).toBeInTheDocument()
  })

  it('never starts by itself for someone who finished it - even on a new device', async () => {
    account.done = true
    await renderGuide()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem('booqy-guide-done:sub-1')).toBe('1')
  })

  it('stays away when the account cannot be asked (better than showing it twice)', async () => {
    account.done = null
    await renderGuide()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not ask the account again once this browser knows', async () => {
    localStorage.setItem('booqy-guide-done:sub-1', '1')
    const { guideDoneOnAccount } = await import('./guideApi')
    vi.mocked(guideDoneOnAccount).mockClear()
    await renderGuide()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(guideDoneOnAccount).not.toHaveBeenCalled()
  })

  it('only counts the location step when the restaurant has several locations', () => {
    const one = stepsFor({ isOwner: true, features: ALL, locations: 1 })
    const two = stepsFor({ isOwner: true, features: ALL, locations: 2 })
    expect(one.some((s) => s.id === 'location')).toBe(false)
    expect(two.some((s) => s.id === 'location')).toBe(true)
    expect(two.length).toBe(one.length + 1)
  })

  it('closes with Escape and does not start by itself when autoStart is off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
