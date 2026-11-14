import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatistikPage from './StatistikPage'
import { sampleInsights } from './insightsSample'
import type { Filters } from './insights'

const fetchInsights = vi.hoisted(() => vi.fn())
vi.mock('./insightsApi', () => ({
  fetchInsights: (...a: unknown[]) => fetchInsights(...a),
  insightsQuery: (f: Filters & { ahead?: number }) =>
    `/insights?${f.from}|${f.to}|${f.locationId}|${f.service}|${f.channel}|${f.compare}|${f.ahead ?? 0}`,
}))

/** Anropen för Fördjupning (perioden), inte översikten överst (ahead). */
const periodCalls = () => fetchInsights.mock.calls.filter((c) => !c[0].ahead)
vi.mock('../../shared/api', async (orig) => ({ ...(await orig<typeof import('../../shared/api')>()), isApiConfigured: () => true }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../bokningar/bookingsApi', () => ({ todayIn: () => '2026-10-22' }))

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', async (orig) => {
  const real = await orig<typeof import('../../shared/tenant')>()
  return {
    ...real,
    useTenant: () => ({ tenant, locationId: 'loc-1' }),
    currentLocation: () => ({ locationId: 'loc-1', name: 'Roma', timezone: 'Europe/Stockholm' }),
  }
})

const locations = [
  { locationId: 'loc-1', name: 'Roma', address: null, timezone: 'Europe/Stockholm' },
  { locationId: 'loc-2', name: 'Roma Söder', address: null, timezone: 'Europe/Stockholm' },
]

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.search}</output>
}

function renderAt(path = '/statistik') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/statistik"
          element={
            <>
              <StatistikPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  fetchInsights.mockReset()
  fetchInsights.mockImplementation(async (f: Filters) => sampleInsights(f, '2026-10-22', tenant.role === 'owner_user'))
  tenant = { role: 'owner_user', locations, entitlements: { features: { ordering: true, catering: true, marketing: true } } }
})

describe('StatistikPage', () => {
  it('puts today, the coming bookings, guests per week and no-shows first, the rest folded', async () => {
    renderAt()
    expect(await screen.findByRole('region', { name: 'Idag' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Kommande bokningar' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Gäster per vecka' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Uteblivna' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Förklaring: Bokningar idag' })).toBeInTheDocument()
    // Översikten: åtta veckor bakåt och sju dagar framåt, alltid live.
    expect(fetchInsights).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-08-31', to: '2026-10-22', compare: 'none', ahead: 7 }),
      expect.anything(),
    )
    expect(await screen.findByRole('heading', { name: 'Fördjupning' })).toBeInTheDocument()
    expect(await screen.findByText('Så gick det')).toBeInTheDocument()
    for (const title of ['Så gick det', 'Omsättning', 'Gäster och bokningar', 'Beläggning']) {
      expect(screen.getByText(title, { selector: '.ds-acc-title' }).closest('details')).not.toHaveAttribute('open')
    }
    // Flera platser: alla platser som standard.
    expect(periodCalls()[0][0]).toMatchObject({ locationId: 'all', compare: 'previous' })
  })

  it('remembers which sections are open', async () => {
    const user = userEvent.setup()
    const first = renderAt()
    await user.click(await screen.findByText('Beläggning', { selector: '.ds-acc-title' }))
    await waitFor(() => expect(screen.getByText('Beläggning', { selector: '.ds-acc-title' }).closest('details')).toHaveAttribute('open'))
    first.unmount()
    renderAt()
    expect((await screen.findByText('Beläggning', { selector: '.ds-acc-title' })).closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Så gick det', { selector: '.ds-acc-title' }).closest('details')).not.toHaveAttribute('open')
  })

  it('counts again right after a booking is saved', async () => {
    renderAt()
    await screen.findByText('Så gick det')
    const before = fetchInsights.mock.calls.length
    act(() => {
      window.dispatchEvent(new CustomEvent('booqy:data-changed', { detail: { path: '/locations/loc-1/reservations' } }))
    })
    await waitFor(() => expect(fetchInsights.mock.calls.length).toBeGreaterThanOrEqual(before + 2))
    expect(fetchInsights.mock.calls.slice(before).every((c) => c[1]?.fresh === true)).toBe(true)
  })

  it('puts the filters in the address and asks again', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByText('Så gick det')
    await user.click(screen.getByRole('button', { name: 'Denna månad' }))
    await user.selectOptions(screen.getByLabelText('Pass'), 'lunch')
    await user.selectOptions(screen.getByLabelText('Jämför med'), 'year')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?period=month&service=lunch&compare=year'))
    expect(periodCalls().at(-1)?.[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-22', service: 'lunch', compare: 'year' })
  })

  it('opens a custom period from the address', async () => {
    renderAt('/statistik?period=custom&from=2026-01-01&to=2026-06-30&loc=loc-2')
    await screen.findByText('Så gick det')
    expect(periodCalls()[0][0]).toMatchObject({ from: '2026-01-01', to: '2026-06-30', locationId: 'loc-2' })
    expect(screen.getByLabelText('Från')).toHaveValue('01/01/2026')
  })

  it('shows staff the operations figures without amounts', async () => {
    tenant = { ...tenant, role: 'staff_user', locations: [locations[0]], insights: { staffAccess: 'operations' } }
    renderAt()
    expect(await screen.findByText(/Belopp visas bara för ägaren/)).toBeInTheDocument()
    expect(screen.queryAllByText(/Omsättning|kr$/)).toHaveLength(0)
    expect(screen.getAllByText('Tillagningstid').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Plats')).not.toBeInTheDocument()
  })

  it('tells staff when the owner has closed it', async () => {
    tenant = { ...tenant, role: 'staff_user', insights: { staffAccess: 'none' } }
    renderAt()
    expect(screen.getByRole('heading', { name: 'Bara för ägaren' })).toBeInTheDocument()
    expect(fetchInsights).not.toHaveBeenCalled()
  })

  it('offers the sample when there is nothing in the period', async () => {
    fetchInsights.mockImplementation(async (f: Filters) => {
      const r = sampleInsights(f, '2026-10-22', true)
      const zero = { ...r.current, bookings: 0, cancelled: 0, orders: 0, catering: { ...r.current.catering, requests: 0 } }
      return { ...r, current: zero }
    })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Inget i perioden' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visa med exempeldata' })).toBeInTheDocument()
  })

  it('says so when the figures cannot be fetched', async () => {
    fetchInsights.mockRejectedValue(new Error('nope'))
    renderAt()
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Kunde inte hämta dagens siffror.*Kunde inte hämta siffrorna/)
  })
})
