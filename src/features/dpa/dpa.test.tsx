import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tenant, TenantDpa } from '../../shared/tenant'
import { ApiError } from '../../shared/api'
import { DpaBanner } from './DpaBanner'
import AvtalPage from './AvtalPage'
import { DPA_SECTIONS, DPA_VERSION } from './dpaText'

let current: Tenant | null = null
const replaceTenant = vi.fn()
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant: current, status: 'ready', error: null, locationId: null, refresh: vi.fn() }),
  replaceTenant: (t: Tenant) => replaceTenant(t),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))

const acceptDpa = vi.fn()
vi.mock('./dpaApi', async (orig) => ({
  ...(await orig<typeof import('./dpaApi')>()),
  acceptDpa: (t: Tenant) => acceptDpa(t),
}))

function tenant(dpa: Partial<TenantDpa> | null, extra: Partial<Tenant> = {}): Tenant {
  return {
    tenantId: 't1', name: 'Roma', slug: 'roma', status: 'active', planId: null,
    entitlements: { maxLocations: 3, features: {} }, locationCount: 1,
    stripe: { connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false },
    primaryDomain: null, senderName: null, replyToEmail: null,
    notifications: { sms: false, staffEmails: true, reminderHours: 24 },
    ...(dpa === null ? {} : {
      dpa: { currentVersion: DPA_VERSION, acceptedVersion: null, acceptedAt: null, required: false, upToDate: false, ...dpa },
    }),
    role: 'owner_user', locations: [], ...extra,
  }
}

function renderAt(path: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

describe('DpaBanner', () => {
  it('reminds the owner of a live restaurant and can be postponed', async () => {
    current = tenant({})
    renderAt('/', <DpaBanner />)
    expect(screen.getByText('Godkänn personuppgiftsbiträdesavtalet')).toBeInTheDocument()
    expect(screen.getByText(/Er webbplats påverkas inte/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Läs och godkänn' })).toHaveAttribute('href', '/avtal')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Senare' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('tells a new restaurant the site is not published, without a way to postpone', () => {
    current = tenant({ required: true })
    renderAt('/', <DpaBanner />)
    expect(screen.getByText('Webbplatsen är inte publicerad än')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Senare' })).toBeNull()
  })

  it('tells staff of a new restaurant to wait for the owner, and hides reminders from staff', () => {
    current = tenant({ required: true }, { role: 'staff_user' })
    const { unmount } = renderAt('/', <DpaBanner />)
    expect(screen.getByText(/Restaurangens ägare behöver godkänna/)).toBeInTheDocument()
    unmount()
    current = tenant({}, { role: 'staff_user' })
    renderAt('/', <DpaBanner />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows nothing when accepted, on an older API, or on /avtal itself', () => {
    current = tenant({ acceptedVersion: DPA_VERSION, upToDate: true })
    const a = renderAt('/', <DpaBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    a.unmount()
    current = tenant(null)
    const b = renderAt('/', <DpaBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    b.unmount()
    current = tenant({ required: true })
    renderAt('/avtal', <DpaBanner />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('AvtalPage', () => {
  beforeEach(() => {
    acceptDpa.mockReset()
    replaceTenant.mockReset()
  })

  it('shows the whole text and accepts only after the checkbox', async () => {
    const user = userEvent.setup()
    current = tenant({ required: true })
    const accepted = tenant({ required: true, acceptedVersion: DPA_VERSION, acceptedAt: '2026-10-22T10:00:00.000Z', upToDate: true })
    acceptDpa.mockResolvedValue(accepted)
    function Home() {
      const { state } = useLocation()
      return <p>Översikt {JSON.stringify(state)}</p>
    }
    render(
      <MemoryRouter initialEntries={['/avtal']}>
        <Routes>
          <Route path="/avtal" element={<AvtalPage />} />
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    )

    for (const section of DPA_SECTIONS) expect(screen.getByRole('heading', { name: section.title })).toBeInTheDocument()
    expect(screen.getByText(/publiceras när restaurangens ägare har godkänt/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Godkänn avtalet' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /har rätt att godkänna det för Roma/ }))
    await user.click(submit)

    expect(acceptDpa).toHaveBeenCalledWith(current)
    expect(replaceTenant).toHaveBeenCalledWith(accepted)
    // Vidare till Översikt, där Kom igång visar nästa steg.
    expect(await screen.findByText('Översikt {"dpaAccepted":true,"sitePublished":true}')).toBeInTheDocument()
  })

  it('explains an outdated version', async () => {
    const user = userEvent.setup()
    current = tenant({})
    acceptDpa.mockRejectedValue(new ApiError(409, 'dpa_version_outdated'))
    renderAt('/avtal', <AvtalPage />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Godkänn avtalet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ladda om sidan')
  })

  it('lets staff read but not accept', () => {
    current = tenant({}, { role: 'staff_user' })
    renderAt('/avtal', <AvtalPage />)
    expect(screen.queryByRole('button', { name: 'Godkänn avtalet' })).toBeNull()
    expect(screen.getByText('Bara restaurangens ägare kan godkänna avtalet.')).toBeInTheDocument()
  })

  it('shows when an accepted version was accepted', () => {
    current = tenant({ acceptedVersion: DPA_VERSION, acceptedAt: '2026-10-22T10:00:00.000Z', upToDate: true })
    renderAt('/avtal', <AvtalPage />)
    expect(screen.getByText('Avtalet är godkänt')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
