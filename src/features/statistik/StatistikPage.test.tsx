import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatistikPage from './StatistikPage'
import { sampleInsights } from './insightsSample'
import type { Filters } from './insights'

const fetchInsights = vi.hoisted(() => vi.fn())
vi.mock('./insightsApi', () => ({
  fetchInsights: (...a: unknown[]) => fetchInsights(...a),
  insightsQuery: (f: Filters) => `/insights?${f.from}|${f.to}|${f.locationId}|${f.service}|${f.channel}|${f.compare}`,
}))
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
  it('shows what happened, what to do and why for the owner, with amounts', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Så gick det' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Att göra' })).toBeInTheDocument()
    expect(screen.getAllByText('Omsättning').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Beläggning per veckodag och timme' })).toBeInTheDocument()
    expect(screen.getAllByText('Gör så här').length).toBeGreaterThan(5)
    // Flera platser: alla platser som standard.
    expect(fetchInsights.mock.calls[0][0]).toMatchObject({ locationId: 'all', compare: 'previous' })
  })

  it('puts the filters in the address and asks again', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByRole('heading', { name: 'Så gick det' })
    await user.click(screen.getByRole('button', { name: 'Denna månad' }))
    await user.selectOptions(screen.getByLabelText('Pass'), 'lunch')
    await user.selectOptions(screen.getByLabelText('Jämför med'), 'year')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?period=month&service=lunch&compare=year'))
    expect(fetchInsights).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', to: '2026-10-22', service: 'lunch', compare: 'year' }))
  })

  it('opens a custom period from the address', async () => {
    renderAt('/statistik?period=custom&from=2026-01-01&to=2026-06-30&loc=loc-2')
    await screen.findByRole('heading', { name: 'Så gick det' })
    expect(fetchInsights.mock.calls[0][0]).toMatchObject({ from: '2026-01-01', to: '2026-06-30', locationId: 'loc-2' })
    expect(screen.getByLabelText('Från')).toHaveValue('2026-01-01')
  })

  it('shows staff the operations figures without amounts', async () => {
    tenant = { ...tenant, role: 'staff_user', locations: [locations[0]], insights: { staffAccess: 'operations' } }
    renderAt()
    expect(await screen.findByText(/Belopp visas bara för restaurangens ägare/)).toBeInTheDocument()
    expect(screen.queryAllByText(/Omsättning|kr$/)).toHaveLength(0)
    expect(screen.getAllByText('Tillagningstid').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Plats')).not.toBeInTheDocument()
  })

  it('tells staff when the owner has closed it', async () => {
    tenant = { ...tenant, role: 'staff_user', insights: { staffAccess: 'none' } }
    renderAt()
    expect(screen.getByRole('heading', { name: 'Inte öppen för personalen' })).toBeInTheDocument()
    expect(fetchInsights).not.toHaveBeenCalled()
  })

  it('offers the sample when there is nothing in the period', async () => {
    fetchInsights.mockImplementation(async (f: Filters) => {
      const r = sampleInsights(f, '2026-10-22', true)
      const zero = { ...r.current, bookings: 0, cancelled: 0, orders: 0, catering: { ...r.current.catering, requests: 0 } }
      return { ...r, current: zero }
    })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Inget att räkna på i perioden' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visa med exempeldata' })).toBeInTheDocument()
  })

  it('says so when the figures cannot be fetched', async () => {
    fetchInsights.mockRejectedValue(new Error('nope'))
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunde inte hämta siffrorna')
  })
})
