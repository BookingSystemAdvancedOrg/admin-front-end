import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdsOverviewTiles from './AdsOverviewTiles'
import AnnonserTab from './AnnonserTab'
import * as api from './api'
import { chooseOption, optionTexts } from '../../test/select'

vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({}),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro' }),
}))
vi.mock('../meny/menuApi', () => ({
  listMenuItems: vi.fn().mockResolvedValue([
    { menuItemId: 'm1', name: 'Pasta', imageKey: 'menu-images/t/locations/loc-1/p.jpg', active: true, alcohol: false },
    { menuItemId: 'm2', name: 'Vin', imageKey: 'k', active: true, alcohol: true },
  ]),
  menuImageUrl: () => null,
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getConnection: vi.fn(), finishConnect: vi.fn(), startConnect: vi.fn(), getAssets: vi.fn(),
  saveConnection: vi.fn(), disconnect: vi.fn(), listCampaigns: vi.fn(), activate: vi.fn(), pause: vi.fn(),
  suggestCopy: vi.fn(), createCampaign: vi.fn(), getInsights: vi.fn(),
}))

const connected: api.Connection = {
  status: 'connected', assets: { adAccountId: 'act_1', pageId: 'p1' }, dsa: { beneficiary: 'Bistro AB', payor: 'Bistro AB' },
  monthlyCapSek: 3000, spendThisMonthSek: 1200, killSwitch: false, missingPermissions: [], version: 2,
}
const paused: api.Campaign = {
  campaignId: 'c1', locationId: 'loc-1', goal: 'bookings', status: 'paused', budgetSek: 500, startDate: '2026-11-04',
  endDate: '2026-11-11', radiusKm: 5, utmCampaign: 'booqy-c1', version: 2, createdAt: '',
  creative: { menuItemId: 'm1', imageKey: 'k', headline: 'Pasta på fredag', primaryText: 'Boka', cta: 'BOOK_TRAVEL' },
}

const renderTab = (url = '/marknadsforing?flik=annonser') =>
  render(<MemoryRouter initialEntries={[url]}><AnnonserTab /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listCampaigns).mockResolvedValue({ campaigns: [paused] })
})

describe('AnnonserTab', () => {
  it('offers Koppla Meta while disconnected', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ ...connected, status: 'disconnected', assets: undefined })
    renderTab()
    expect(await screen.findByRole('button', { name: 'Koppla Meta' })).toBeInTheDocument()
  })

  it('finishes the Meta login from the redirect and asks for the assets', async () => {
    vi.mocked(api.finishConnect).mockResolvedValue({ ...connected, assets: undefined })
    vi.mocked(api.getAssets).mockResolvedValue({
      businesses: [], adAccounts: [], pages: [{ id: 'p1', name: 'Bistro' }], instagram: [],
      missing: [{ kind: 'ad_account', deepLink: 'https://business.facebook.com/settings/ad-accounts' }],
    })
    renderTab('/marknadsforing?flik=annonser&code=abc&state=xyz')
    await waitFor(() => expect(api.finishConnect).toHaveBeenCalledWith('abc', 'xyz'))
    expect(await screen.findByRole('link', { name: 'Skapa annonskonto hos Meta' })).toHaveAttribute('href', 'https://business.facebook.com/settings/ad-accounts')
    expect(api.getConnection).not.toHaveBeenCalled()
  })

  it('lists campaigns and starts a paused one with its version', async () => {
    vi.mocked(api.getConnection).mockResolvedValue(connected)
    vi.mocked(api.activate).mockResolvedValue({ ...paused, status: 'active', version: 3 })
    renderTab()
    const start = await screen.findByRole('button', { name: 'Starta annonsen' })
    // F15: the action sits in the first cell, on screen at 390px without scrolling the table
    expect(start.closest('td')).toBe(start.closest('tr')!.firstElementChild)
    fireEvent.click(start)
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('loc-1', paused))
    expect(await screen.findByRole('button', { name: 'Pausa' })).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Annonskostnad den här månaden' })).toBeInTheDocument()
  })

  it('explains a publish the sweep could not start (start_failed)', async () => {
    vi.mocked(api.getConnection).mockResolvedValue(connected)
    vi.mocked(api.listCampaigns).mockResolvedValue({ campaigns: [{ ...paused, status: 'failed', error: { code: 'start_failed' } }] })
    renderTab()
    expect(await screen.findByText('Annonsen kom aldrig i gång. Skapa den igen.')).toBeInTheDocument()
  })

  it('creates a campaign through the six steps, never offering alcohol, with one id', async () => {
    vi.mocked(api.getConnection).mockResolvedValue(connected)
    vi.mocked(api.createCampaign).mockResolvedValue({ ...paused, status: 'publishing' })
    vi.mocked(api.suggestCopy).mockResolvedValue({ suggestions: [{ headline: 'Fredagspasta', primaryText: 'Boka bord i kväll.' }] })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Ny annons' }))
    const goals = screen.getAllByRole('radio')
    expect(goals.length).toBeGreaterThan(1)
    expect(goals.every((r) => r.closest('label')?.classList.contains('annons-choice') && !r.closest('.toggle-row'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Nästa' }))
    const dish = await screen.findByLabelText(/Rätt/)
    await waitFor(() => expect(optionTexts(dish)).toContain('Pasta'))
    expect(optionTexts(dish)).not.toContain('Vin')
    chooseOption(dish, 'm1')
    fireEvent.click(screen.getByRole('button', { name: 'Föreslå text' }))
    fireEvent.click(await screen.findByRole('button', { name: /Fredagspasta/ }))
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Nästa' }))
    expect(screen.getByText(/Skapas/)).toHaveTextContent('pausad')
    expect(screen.getByText('Område').closest('dl')).toHaveClass('annons-facts')
    fireEvent.click(screen.getByRole('button', { name: 'Skapa annonsen' }))
    await waitFor(() => expect(api.createCampaign).toHaveBeenCalledTimes(1))
    const body = vi.mocked(api.createCampaign).mock.calls[0][1]
    expect(body).toMatchObject({ goal: 'bookings', menuItemId: 'm1', headline: 'Fredagspasta', budgetSek: 500, days: 7, radiusKm: 5 })
  })
})

describe('AdsOverviewTiles', () => {
  it('shows cost per booking and order when there is data', async () => {
    vi.mocked(api.getInsights).mockResolvedValue({
      rows: [{ campaignId: 'c1', day: '2026-11-04', spendSek: 300, reach: 1, clicks: 9, bookings: 3, orders: 1, costPerBookingSek: 100, costPerOrderSek: 300 }],
      totals: { spendSek: 300, reach: 1, clicks: 9, bookings: 3, orders: 1, costPerBookingSek: 100, costPerOrderSek: 300 },
    })
    render(<AdsOverviewTiles locationId="loc-1" from="2026-11-01" to="2026-11-30" />)
    expect(await screen.findByText('Kostnad per bokning')).toBeInTheDocument()
    expect(screen.getByText('Kostnad per beställning')).toBeInTheDocument()
  })
})
