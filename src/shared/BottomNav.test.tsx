import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminLayout } from './AdminLayout'
import { PHONE_NAV_QUERY } from './dock'
import { roleAllows } from './nav'
import type { Tenant } from './tenant'
import { chooseOption } from '../test/select'

let tenant: Record<string, unknown>
const selectLocation = vi.fn()
vi.mock('../features/auth/useAuth', () => ({
  useAuth: () => ({ email: 'a@example.se', sub: 'u1', groups: [], logout: () => {} }),
}))
vi.mock('./tenant', async (orig) => ({
  ...(await orig<typeof import('./tenant')>()),
  useTenant: () => ({ tenant, status: 'ready', error: null, locationId: 'l1', refresh: async () => null }),
  selectLocation: (id: string) => selectLocation(id),
}))
vi.mock('../features/dpa/DpaBanner', () => ({ DpaBanner: () => null }))

const ONE = [{ locationId: 'l1', name: 'Roma City', timezone: 'Europe/Stockholm' }]
const TWO = [...ONE, { locationId: 'l2', name: 'Roma Söder', timezone: 'Europe/Stockholm' }]

function setTenant(features: Record<string, boolean>, opts: { role?: string; insights?: string; locations?: unknown[] } = {}) {
  tenant = {
    tenantId: 't1',
    name: 'Roma',
    role: opts.role ?? 'owner_user',
    locations: opts.locations ?? ONE,
    entitlements: { maxLocations: null, features },
    ...(opts.insights ? { insights: { staffAccess: opts.insights } } : {}),
  }
}

const realMatchMedia = window.matchMedia
function phoneWidth(on: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') || (on && query === PHONE_NAV_QUERY),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const dock = () => screen.getByRole('navigation', { name: 'Snabbmeny' })
const more = () => within(dock()).getByRole('button', { name: /^Mer/ })
const sheet = () => screen.queryByRole('dialog', { name: 'Mer' })
function openSheet() {
  fireEvent.click(more())
  return sheet()!
}
function dockPageLabels(): string[] {
  return within(dock()).getAllByRole('link').map((a) => a.getAttribute('aria-label') ?? '')
}
function sheetPageLabels(): string[] {
  const s = sheet() ?? openSheet()
  return within(within(s).getByRole('navigation', { name: 'Fler sidor' }))
    .getAllByRole('link')
    .map((a) => a.textContent ?? '')
}
function sidebarLabels(): string[] {
  const main = screen.getByRole('navigation', { name: 'Huvudmeny' })
  const foot = screen.getByRole('navigation', { name: 'Inställningar och hjälp' })
  return [...within(main).getAllByRole('link'), ...within(foot).getAllByRole('link')].map((a) => a.textContent ?? '')
}

beforeEach(() => {
  phoneWidth(true)
  selectLocation.mockReset()
  setTenant({})
})
afterEach(() => {
  window.matchMedia = realMatchMedia
  document.documentElement.classList.remove('dock-hidden', 'drawer-lock')
})

describe('BottomNav on phones', () => {
  it('has no menu button at the top', () => {
    renderAt()
    expect(screen.queryByRole('button', { name: 'Meny' })).toBeNull()
    expect(document.querySelector('.admin-mobilebar button')).toBeNull()
  })

  it('is icons only: every slot has an aria-label and no visible text', () => {
    setTenant({ ordering: true })
    renderAt()
    const nav = dock()
    expect(nav.textContent?.trim()).toBe('')
    const slots = [...within(nav).getAllByRole('link'), ...within(nav).getAllByRole('button')]
    expect(slots.length).toBe(5)
    for (const el of slots) expect(el.getAttribute('aria-label')).toBeTruthy()
    expect(dockPageLabels()).toEqual(['Översikt', 'Bokningar', 'Beställningar'])
    expect(within(nav).getByRole('button', { name: 'Ny bokning' })).toBeInTheDocument()
  })

  // (a) Inget tappas och inget dyker upp: raden + arket = sidomenyn.
  const cases: [string, Record<string, boolean>, { role?: string; insights?: string; locations?: unknown[] }][] = [
    ['owner, minimal plan', {}, {}],
    ['owner, full plan', { ordering: true, catering: true, personalliggare: true, phoneAgent: true, guestCrm: true, giftCards: true, events: true, marketing: true }, {}],
    ['staff, full plan', { ordering: true, catering: true, personalliggare: true, phoneAgent: true, guestCrm: true, giftCards: true, events: true, metaAds: true }, { role: 'staff_user' }],
    ['staff without insights', { ordering: true }, { role: 'staff_user', insights: 'none' }],
    ['owner, two locations', { catering: true }, { locations: TWO }],
  ]
  for (const [name, features, opts] of cases) {
    it(`bar plus sheet equals the sidebar (${name})`, () => {
      setTenant(features, opts)
      renderAt()
      const phone = [...dockPageLabels(), ...sheetPageLabels()]
      expect([...phone].sort()).toEqual([...sidebarLabels()].sort())
      expect(new Set(phone).size).toBe(phone.length)
      // (b) varje länk är en sida rollen får öppna
      const links = [...within(dock()).getAllByRole('link'), ...within(sheet()!).getAllByRole('link')]
      for (const a of links) expect(roleAllows(new URL(a.getAttribute('href')!, 'http://x').pathname, tenant as unknown as Tenant)).toBe(true)
    })
  }

  it('shows staff no owner pages in the sheet', () => {
    setTenant({ guestCrm: true, giftCards: true, marketing: true }, { role: 'staff_user' })
    renderAt()
    const labels = sheetPageLabels()
    for (const l of ['Personal', 'Presentkort', 'Marknadsföring']) expect(labels).not.toContain(l)
    expect(labels).toContain('Kunder')
  })

  // (f) Fjärde platsen
  it('puts Beställningar in slot 4 with ordering on, Meny without', () => {
    setTenant({ ordering: true })
    const { unmount } = renderAt()
    expect(dockPageLabels()[2]).toBe('Beställningar')
    expect(sheetPageLabels()).toContain('Meny')
    unmount()
    setTenant({})
    renderAt()
    expect(dockPageLabels()[2]).toBe('Meny')
    expect(sheetPageLabels()).not.toContain('Meny')
  })

  // (d) Aktiv sida
  it('marks exactly one item aria-current on a bar page', () => {
    renderAt('/bokningar')
    const current = dock().querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('aria-label', 'Bokningar')
    expect(more()).toHaveAccessibleName('Mer')
    openSheet()
    expect(sheet()!.querySelectorAll('[aria-current="page"]')).toHaveLength(0)
  })

  it('names the sheet page on Mer and marks the sheet row', () => {
    renderAt('/statistik')
    expect(dock().querySelectorAll('[aria-current]')).toHaveLength(0)
    expect(more()).toHaveAccessibleName('Mer, du är på Statistik')
    expect(more()).not.toHaveAttribute('aria-current')
    const rows = openSheet().querySelectorAll('[aria-current="page"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Statistik')
  })

  it('never marks a link to part of a page (#)', () => {
    renderAt('/installningar')
    const current = openSheet().querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Inställningar')
  })

  // (e) Stänga arket
  it('opens the sheet with Mer and closes it with Escape, back on Mer', async () => {
    renderAt()
    expect(sheet()).toBeNull()
    openSheet()
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    expect(sheet()).toHaveAttribute('aria-modal', 'true')
    expect(document.documentElement).toHaveClass('drawer-lock')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(sheet()).toBeNull())
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    // Fokus går tillbaka till Mer när arket glidit undan, inte i samma tick.
    await waitFor(() => expect(document.activeElement).toBe(more()))
    expect(document.documentElement).not.toHaveClass('drawer-lock')
  })

  it('leaves focus where Sök put it when the sheet slides away', async () => {
    renderAt()
    openSheet()
    fireEvent.click(within(sheet()!).getByRole('button', { name: 'Sök' }))
    const input = await screen.findByRole('combobox')
    await waitFor(() => expect(sheet()).toBeNull())
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(document.activeElement).toBe(input)
  })

  it('closes on a scrim tap and on a second tap on Mer', async () => {
    renderAt()
    openSheet()
    fireEvent.click(document.querySelector('.bq-more-scrim')!)
    await waitFor(() => expect(sheet()).toBeNull())
    openSheet()
    fireEvent.click(more())
    await waitFor(() => expect(sheet()).toBeNull())
  })

  it('closes on a route change (a row in the sheet)', () => {
    renderAt()
    fireEvent.click(within(openSheet()).getByRole('link', { name: 'Layout' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/layout')
    expect(sheet()).toBeNull()
  })

  it('switches location from the sheet and closes it', async () => {
    setTenant({}, { locations: TWO })
    renderAt()
    const s = openSheet()
    expect(within(s).getByText('Plats')).toBeInTheDocument()
    chooseOption(within(s).getByRole('combobox'), 'l2')
    expect(selectLocation).toHaveBeenCalledWith('l2')
    await waitFor(() => expect(sheet()).toBeNull())
  })

  it('has no location picker with one location', () => {
    renderAt()
    expect(openSheet().querySelector('[data-tour="location-picker"]')).toBeNull()
  })

  it('keeps theme, sound, settings, help and logout in the sheet', () => {
    renderAt()
    const s = openSheet()
    expect(within(s).getByRole('button', { name: /läge, byt till/ })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Klickljud' })).toBeInTheDocument()
    expect(within(s).getByRole('link', { name: 'Inställningar' })).toBeInTheDocument()
    expect(within(s).getByRole('link', { name: 'Hjälp' })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Sök' })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Guiden' })).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Profilbild' })).toBeInTheDocument()
    expect(within(s).getByText('Roma')).toBeInTheDocument()
  })

  it('asks before logging out from the sheet', async () => {
    renderAt()
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Logga ut' }))
    expect(await screen.findByText(/Vill du logga ut/)).toBeInTheDocument()
  })

  it('opens Bokningar with the new-booking form from the centre button', () => {
    renderAt()
    fireEvent.click(within(dock()).getByRole('button', { name: 'Ny bokning' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/bokningar')
  })

  // (g) Guiden på telefonen
  it('gives the guide its targets on the bar and in the sheet', () => {
    setTenant({ catering: true }, { locations: TWO })
    renderAt()
    expect(dock().querySelector('[data-tour="nav-oversikt"]')).not.toBeNull()
    expect(dock().querySelector('[data-tour="nav-bokningar"]')).not.toBeNull()
    const s = openSheet()
    for (const t of ['location-picker', 'nav-statistik', 'nav-catering', 'nav-layout', 'nav-installningar', 'nav-hjalp']) {
      expect(s.querySelector(`[data-tour="${t}"]`)).not.toBeNull()
    }
  })

  it('opens the sheet for a guide step that points into it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      setTenant({}, { locations: TWO })
      renderAt()
      fireEvent.click(within(openSheet()).getByRole('button', { name: 'Guiden' }))
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      // välkomststeget först, sedan platsväljaren som ligger i arket
      fireEvent.click(screen.getByRole('button', { name: /Visa mig|Nästa/ }))
      await waitFor(() => expect(sheet()).not.toBeNull())
      expect(sheet()!.querySelector('[data-tour="location-picker"]')).not.toBeNull()
      // arket öppnat av guiden fångar inte fokus
      expect(sheet()).not.toHaveAttribute('aria-modal')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('BottomNav on wider screens', () => {
  it('is not rendered on tablets and computers: the sidebar is the menu', () => {
    phoneWidth(false)
    renderAt()
    expect(screen.queryByRole('navigation', { name: 'Snabbmeny' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Huvudmeny' })).toBeInTheDocument()
  })
})
