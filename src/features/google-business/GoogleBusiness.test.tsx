import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GoogleProfileCard from './GoogleProfileCard'
import OmdomenTab from './OmdomenTab'
import * as api from './api'

vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({}),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro' }),
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getConnection: vi.fn(), finishConnect: vi.fn(), startConnect: vi.fn(), disconnect: vi.fn(),
  listGoogleLocations: vi.fn(), getLocationView: vi.fn(), linkLocation: vi.fn(), unlinkLocation: vi.fn(),
  syncNow: vi.fn(), saveReviewSettings: vi.fn(),
}))

const preview: api.Preview = {
  regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 11 }, closeDay: 'MONDAY', closeTime: { hours: 22, minutes: 30 } }] },
  specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 24 }, closed: true }] },
}
const settings: api.ReviewSettings = {
  enabled: false, sources: ['booking', 'order'], channels: ['email'], delayMinutes: 120, minDaysBetween: 90, version: 0,
}
const view: api.LocationView = { preview, reviewSettings: settings, stats: { sent30d: 3, skipped30d: 1, clicks30d: 0 } }

const renderCard = (url = '/installningar') =>
  render(<MemoryRouter initialEntries={[url]}><GoogleProfileCard locationId="loc-1" /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getLocationView).mockResolvedValue(view)
  vi.mocked(api.listGoogleLocations).mockResolvedValue({
    locations: [
      { googleLocation: 'locations/1', title: 'Bistro', address: 'Gatan 1' },
      { googleLocation: 'locations/2', title: 'Annan', address: 'Vägen 2', linkedTo: 'loc-9' },
    ],
  })
})

describe('GoogleProfileCard', () => {
  it('offers Koppla Google while disconnected', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    renderCard()
    expect(await screen.findByRole('button', { name: 'Koppla Google' })).toBeInTheDocument()
  })

  it('finishes the Google login from the redirect', async () => {
    vi.mocked(api.finishConnect).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected', googleAccount: 'accounts/1' })
    renderCard('/installningar?google=1&code=abc&state=xyz')
    await waitFor(() => expect(api.finishConnect).toHaveBeenCalledWith('abc', 'xyz'))
    expect(await screen.findByRole('option', { name: 'Bistro, Gatan 1' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Annan/ })).toBeNull()
  })

  it('links a place and shows the preview with the overwrite notice', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.linkLocation).mockResolvedValue({ googleLocation: 'locations/1', title: 'Bistro', syncStatus: 'pending', lastSyncAt: null, version: 1 })
    renderCard()
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'locations/1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Koppla platsen' }))
    await waitFor(() => expect(api.linkLocation).toHaveBeenCalledWith('loc-1', 'locations/1', undefined))
    expect(screen.getByText('Ändringar i Google skrivs över av Booqy. Ändra öppettiderna här i stället.')).toBeInTheDocument()
    expect(screen.getByText('11:00-22:30')).toBeInTheDocument()
    expect(screen.getByText('2026-12-24')).toBeInTheDocument()
  })

  it('syncs now when linked', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getLocationView).mockResolvedValue({
      ...view, link: { googleLocation: 'locations/1', title: 'Bistro', syncStatus: 'ok', lastSyncAt: '2026-11-04T13:05:00Z', version: 1 },
    })
    vi.mocked(api.syncNow).mockResolvedValue({ syncStatus: 'ok', changed: false, lastSyncAt: '2026-11-04T13:05:00Z' })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Synka nu' }))
    await waitFor(() => expect(api.syncNow).toHaveBeenCalledWith('loc-1'))
  })
})

describe('OmdomenTab', () => {
  it('saves the review settings with the version', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.saveReviewSettings).mockResolvedValue({ ...settings, enabled: true, version: 1 })
    render(<OmdomenTab />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'På' }))
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.saveReviewSettings).toHaveBeenCalledWith('loc-1', { ...settings, enabled: true }))
  })

  it('warns when Google is not linked', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    render(<OmdomenTab />)
    expect(await screen.findByText(/Koppla er Google-profil under Inställningar/)).toBeInTheDocument()
  })
})
