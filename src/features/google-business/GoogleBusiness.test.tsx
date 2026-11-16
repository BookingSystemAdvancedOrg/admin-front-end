import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GoogleProfileCard from './GoogleProfileCard'
import OmdomenTab from './OmdomenTab'
import * as api from './api'
import { ApiError } from '../../shared/api'
import { chooseOption, optionTexts } from '../../test/select'

vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({}),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro' }),
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getConnection: vi.fn(), finishConnect: vi.fn(), startConnect: vi.fn(), disconnect: vi.fn(),
  listGoogleLocations: vi.fn(), getLocationView: vi.fn(), linkLocation: vi.fn(), unlinkLocation: vi.fn(),
  syncNow: vi.fn(), saveReviewSettings: vi.fn(), skipGoogle: vi.fn(),
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
    await waitFor(() => expect(optionTexts(screen.getByRole('combobox'))).toContain('Bistro, Gatan 1'))
    expect(optionTexts(screen.getByRole('combobox')).some((t) => /Annan/.test(t))).toBe(false)
  })

  it('links a place and shows the preview with the overwrite notice', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.linkLocation).mockResolvedValue({ googleLocation: 'locations/1', title: 'Bistro', syncStatus: 'pending', lastSyncAt: null, version: 1 })
    renderCard()
    chooseOption(await screen.findByRole('combobox'), 'locations/1')
    fireEvent.click(screen.getByRole('button', { name: 'Koppla platsen' }))
    await waitFor(() => expect(api.linkLocation).toHaveBeenCalledWith('loc-1', 'locations/1', undefined))
    expect(screen.getByText('Ändra öppettiderna här, inte i Google.')).toBeInTheDocument()
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

const steps = () => within(screen.getByRole('list', { name: 'Så kopplar ni Google' })).getAllByRole('listitem')
const current = () => steps().find((li) => li.getAttribute('aria-current') === 'step')

describe('Google guide', () => {
  it('shows the five steps with step 1 current before Google, and the help panel', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    renderCard()
    await screen.findByRole('button', { name: 'Koppla Google' })
    expect(steps().map((li) => li.textContent)).toEqual(api.GUIDE_STEPS.map((t, i) => `${i + 1}${t}`))
    expect(current()?.textContent).toContain('Tryck på Koppla Google.')
    const help = screen.getByText('Fungerade det inte?')
    expect(help.closest('details')).not.toBeNull()
    for (const h of ['Fel Google-konto', 'Restaurangen finns inte i listan', 'Google har inte verifierat appen']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    }
    // Inget att koppla bort innan Google är kopplat.
    expect(screen.queryByRole('heading', { name: 'Koppla bort' })).toBeNull()
    expect(screen.getByText(/Personer och åtkomst, Lägg till/)).toBeInTheDocument()
    expect(screen.getByText(/tryck på Acceptera/)).toBeInTheDocument()
    expect(screen.getByText(/Avancerat och sedan på Gå till Booqy \(osäkert\)/)).toBeInTheDocument()
    // Koppla Google först i ordningen; att hoppa över är en lugn textknapp efter.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons.indexOf('Koppla Google')).toBeLessThan(buttons.indexOf('Vi har ingen Google-profil'))
  })

  it('after the Google return marks 1-3 done and step 4, then 5, current', async () => {
    vi.mocked(api.finishConnect).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    renderCard('/installningar?google=1&code=abc&state=xyz')
    const select = await screen.findByRole('combobox')
    await waitFor(() => expect(current()?.textContent).toContain('Välj er restaurang i listan.'))
    expect(steps().slice(0, 3).every((li) => li.classList.contains('is-done'))).toBe(true)
    chooseOption(select, 'locations/1')
    expect(current()?.textContent).toContain('Tryck på Koppla platsen.')
    expect(screen.getByText('Fungerade det inte?')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Koppla bort' })).toBeInTheDocument()
  })

  it('shows a Google account without a profile inside the card, with the way out', async () => {
    vi.mocked(api.finishConnect).mockRejectedValue(new ApiError(409, 'x', { code: 'no_google_account', fromServer: true }))
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    vi.mocked(api.skipGoogle).mockResolvedValue({ skipped: true })
    renderCard('/installningar?google=1&code=abc&state=xyz')
    expect(await screen.findByText(/Det här Google-kontot har ingen Google-profil/)).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Så kopplar ni Google' })).toBeInTheDocument()
    expect(screen.getByText('Fungerade det inte?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Vi har ingen Google-profil' }))
    await waitFor(() => expect(api.skipGoogle).toHaveBeenCalledWith('loc-1'))
  })

  it('maps google_rejected to a text with the way out', async () => {
    vi.mocked(api.finishConnect).mockRejectedValue(new ApiError(409, 'x', { code: 'google_rejected', fromServer: true }))
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    renderCard('/installningar?google=1&code=abc&state=xyz')
    expect(await screen.findByText(/Google sa nej/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Koppla Google' })).toBeInTheDocument()
  })

  it('hides the skip choice when a place is linked but the login ran out', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'needs_reauth' })
    vi.mocked(api.getLocationView).mockResolvedValue({
      ...view, link: { googleLocation: 'locations/1', title: 'Bistro', syncStatus: 'ok', lastSyncAt: null, version: 1 },
    })
    renderCard()
    await screen.findByRole('button', { name: 'Koppla Google' })
    expect(screen.queryByRole('button', { name: 'Vi har ingen Google-profil' })).toBeNull()
  })

  it('hides the guide once a place is linked', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getLocationView).mockResolvedValue({
      ...view, link: { googleLocation: 'locations/1', title: 'Bistro', syncStatus: 'ok', lastSyncAt: null, version: 1 },
    })
    renderCard()
    await screen.findByRole('button', { name: 'Synka nu' })
    expect(screen.queryByRole('list', { name: 'Så kopplar ni Google' })).toBeNull()
  })

  it('skips Google, collapses to one line with a profile link, and undoes it', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    vi.mocked(api.skipGoogle).mockImplementation(async () => {
      vi.mocked(api.getLocationView).mockResolvedValue({ ...view, skipped: true })
      return { skipped: true }
    })
    vi.mocked(api.unlinkLocation).mockImplementation(async () => {
      vi.mocked(api.getLocationView).mockResolvedValue(view)
    })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Vi har ingen Google-profil' }))
    await waitFor(() => expect(api.skipGoogle).toHaveBeenCalledWith('loc-1'))
    expect(await screen.findByText('Google är inte kopplat.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skapa en gratis profil' })).toHaveAttribute('href', 'https://business.google.com')
    expect(screen.queryByRole('list', { name: 'Så kopplar ni Google' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Koppla Google ändå' }))
    await waitFor(() => expect(api.unlinkLocation).toHaveBeenCalledWith('loc-1'))
    expect(await screen.findByRole('button', { name: 'Koppla Google' })).toBeInTheDocument()
  })

  it('stays skipped after a reload (server side flag)', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getLocationView).mockResolvedValue({ ...view, skipped: true })
    renderCard()
    expect(await screen.findByText('Google är inte kopplat.')).toBeInTheDocument()
    expect(api.listGoogleLocations).not.toHaveBeenCalled()
  })

  it('lets a skipped but connected owner remove the Google login', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getLocationView).mockResolvedValue({ ...view, skipped: true })
    vi.mocked(api.disconnect).mockImplementation(async () => {
      vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    })
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Koppla bort Google' }))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Koppla bort Google' })).toBeNull())
    expect(screen.getByText('Google är inte kopplat.')).toBeInTheDocument()
  })

  it('offers Hoppa över while picking a place', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.skipGoogle).mockResolvedValue({ skipped: true })
    renderCard()
    await screen.findByRole('combobox')
    fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' }))
    await waitFor(() => expect(api.skipGoogle).toHaveBeenCalledWith('loc-1'))
  })
})

describe('googleDone', () => {
  it('is done when connected and linked, or skipped', () => {
    const link = { googleLocation: 'locations/1', title: 'B', syncStatus: 'ok' as const, lastSyncAt: null, version: 1 }
    expect(api.googleDone({ status: 'disconnected' }, view)).toBe(false)
    expect(api.googleDone({ status: 'connected' }, view)).toBe(false)
    expect(api.googleDone({ status: 'connected' }, { ...view, link })).toBe(true)
    expect(api.googleDone({ status: 'needs_reauth' }, { ...view, link })).toBe(false)
    expect(api.googleDone({ status: 'disconnected' }, { ...view, skipped: true })).toBe(true)
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

  it('Stäng on a failed first load fetches again instead of waiting forever', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'connected' })
    vi.mocked(api.getLocationView).mockRejectedValueOnce(new ApiError(500, 'internal_error')).mockResolvedValue(view)
    render(<OmdomenTab />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stäng' }))
    expect(await screen.findByRole('checkbox', { name: 'På' })).toBeInTheDocument()
    expect(api.getLocationView).toHaveBeenCalledTimes(2)
  })

  it('warns when Google is not linked', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ status: 'disconnected' })
    render(<OmdomenTab />)
    expect(await screen.findByText(/Koppla er Google-profil under Inställningar/)).toBeInTheDocument()
  })
})
