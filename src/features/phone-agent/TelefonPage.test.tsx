import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CallBadge from './CallBadge'
import CallbacksPanel from './CallbacksPanel'
import TelefonPage from './TelefonPage'
import * as api from './api'
import { resetCallBadgeCacheForTests } from './callBadgeCache'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant, locationId: 'loc-1' }),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro', address: null, timezone: null }),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getOverview: vi.fn(), saveConfig: vi.fn(), getLocation: vi.fn(), saveLocation: vi.fn(), setKillSwitch: vi.fn(), getPlaceBasics: vi.fn(),
  simulate: vi.fn(), listCalls: vi.fn(), getCall: vi.fn(), deleteRecording: vi.fn(), listCallbacks: vi.fn(), closeCallback: vi.fn(),
}))

const OWNER = { role: 'owner_user', entitlements: { maxLocations: null, features: { phoneAgent: true } }, locations: [{ locationId: 'loc-1', name: 'Bistro' }] }
const STAFF = { ...OWNER, role: 'staff_user' }
const LOC: api.LocationConfig = {
  locationId: 'loc-1', enabled: true, killSwitch: false, mode: 'after_hours', agentHours: { mon: [{ from: '17:00', to: '23:00' }] },
  greetingExtraSv: '', greetingExtraEn: '', transferTo: '+46812345678', maxCallSeconds: 480,
  counterOffers: { nearbyTables: true, phoneOnlyTables: true }, number: '+46100000001', version: 2,
  setup: { operator: 'telia', forwardedAt: '2026-11-14T10:00:00Z', testedAt: null },
  forwarding: { number: '+46100000001', codes: [{ label: 'Vidarekoppla när ni inte svarar', on: '**004*+46100000001#', off: '##004#' }] },
}
const CALL: api.CallRow = { callId: '20261105abc', startedAt: '2026-11-05T18:00:00Z', durationSec: 125, language: 'sv', outcome: 'booked',
  counterOffer: 'other_time', reservationId: 'r1', callbackId: null, summary: 'Bord för fyra 19:30', from: '+46701112233' }

function renderAt(path = '/telefon') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/telefon" element={<TelefonPage />} />
        <Route path="/telefon/samtal/:callId" element={<TelefonPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCallBadgeCacheForTests()
  vi.mocked(api.getLocation).mockResolvedValue(LOC)
  vi.mocked(api.listCalls).mockResolvedValue({ calls: [CALL], cursor: null })
  vi.mocked(api.listCallbacks).mockResolvedValue([])
})

describe('TelefonPage', () => {
  it('says the feature is not in the plan while it is off, and calls nothing', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    renderAt()
    expect(screen.getByRole('heading', { level: 1, name: 'Telefon' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(api.getLocation).not.toHaveBeenCalled()
  })

  it('lists the calls with outcome and counter-offer, staff without caller numbers or settings', async () => {
    tenant = STAFF
    renderAt()
    expect(await screen.findByText('Bokade bord')).toBeInTheDocument()
    expect(screen.getByText(/Erbjöd annan tid/)).toBeInTheDocument()
    expect(screen.queryByText('+46701112233')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Inställningar' })).not.toBeInTheDocument()
  })

  it('opens a call by clicking anywhere on its row', async () => {
    tenant = OWNER
    vi.mocked(api.getCall).mockResolvedValue({ ...CALL, billedMinutes: 3, recordingUrl: undefined, turns: [], disclosure: { text: 'Hej', playedAt: '2026-11-05T18:00:02Z', repeats: 0 } })
    renderAt()
    fireEvent.click(await screen.findByText('Bokade bord'))
    await waitFor(() => expect(api.getCall).toHaveBeenCalled())
  })

  it('lets staff turn the assistant off with one tap', async () => {
    tenant = STAFF
    vi.mocked(api.setKillSwitch).mockResolvedValue({ ...LOC, killSwitch: true, version: 3 })
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: 'Stäng av assistenten nu' }))
    await waitFor(() => expect(api.setKillSwitch).toHaveBeenCalledWith('loc-1', true, 2))
    expect(await screen.findByRole('button', { name: 'Slå på assistenten' })).toBeInTheDocument()
  })

  it('shows a call with the transcript and the disclosure evidence', async () => {
    tenant = OWNER
    vi.mocked(api.getCall).mockResolvedValue({ ...CALL, billedMinutes: 3, recordingUrl: undefined,
      disclosure: { text: 'Hej', playedAt: '2026-11-05T18:00:02Z', repeats: 1 },
      turns: [{ role: 'agent', text: 'Hej, du pratar med Sara, en AI-assistent för Bistro.', at: '2026-11-05T18:00:00Z' },
              { role: 'tool', text: 'hold_table', at: '2026-11-05T18:00:10Z', toolName: 'hold_table', toolOk: true },
              { role: 'caller', text: 'Ett bord för fyra', at: '2026-11-05T18:00:09Z' }] })
    renderAt('/telefon/samtal/20261105abc')
    expect(await screen.findByText(/en AI-assistent för Bistro/)).toBeInTheDocument()
    expect(screen.getByText(/upprepad 1 gång/)).toBeInTheDocument()
    expect(screen.queryByText('hold_table')).not.toBeInTheDocument()      // tool turns are not shown
    expect(screen.getByText('+46701112233')).toBeInTheDocument()          // the owner sees the number
  })

  it('tells the owner the assistant is not on and opens the setup with Kom igång', async () => {
    tenant = OWNER
    vi.mocked(api.getLocation).mockResolvedValue({ ...LOC, enabled: false, number: null, version: 0 })
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Booqy', tone: 'friendly', languages: ['sv'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 0 }, locations: [],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    vi.mocked(api.getPlaceBasics).mockResolvedValue({ businessHours: null, phoneNumber: null })
    renderAt()
    expect(await screen.findByText('Assistenten är inte på än.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kom igång' }))
    expect(await screen.findByRole('heading', { name: 'Kom igång med telefonassistenten' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kom igång' })).not.toBeInTheDocument()
  })

  it('says the assistant is not ready, without the off button, until the number is forwarded', async () => {
    tenant = OWNER
    vi.mocked(api.getLocation).mockResolvedValue({ ...LOC, setup: { operator: 'telia', forwardedAt: null, testedAt: null } })
    renderAt()
    expect(await screen.findByText('Assistenten är inte klar än.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kom igång' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stäng av assistenten nu' })).not.toBeInTheDocument()
    expect(screen.queryByText(/\+46 10 000 00 01/)).not.toBeInTheDocument()
  })

  it('names when the assistant answers once forwarded, never the Booqy number', async () => {
    tenant = STAFF
    renderAt()
    expect(await screen.findByText('Assistenten svarar när ni har stängt.')).toBeInTheDocument()
  })

  it('tells staff the assistant is off without a setup button', async () => {
    tenant = STAFF
    vi.mocked(api.getLocation).mockResolvedValue({ ...LOC, enabled: false, number: null })
    renderAt()
    expect(await screen.findByText('Assistenten är inte på för den här platsen.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kom igång' })).not.toBeInTheDocument()
  })
})

describe('Bokningar slots', () => {
  it('lists open callbacks with a tel: link and closes one', async () => {
    const cb: api.Callback = { callbackId: 'cb1', callId: 'c1', name: 'Anna', phone: '+46701112233', topic: 'Allergier',
      preferredTime: null, status: 'open', createdAt: '2026-11-05T18:00:00Z', closedAt: null, note: '', version: 1 }
    vi.mocked(api.listCallbacks).mockResolvedValueOnce([cb]).mockResolvedValueOnce([])
    vi.mocked(api.closeCallback).mockResolvedValue({ ...cb, status: 'closed' })
    render(<CallbacksPanel locationId="loc-1" date="2026-11-05" />)
    const link = await screen.findByRole('link', { name: 'Ring upp +46701112233' })
    expect(link).toHaveAttribute('href', 'tel:+46701112233')
    fireEvent.click(screen.getByRole('button', { name: 'Klar' }))
    await waitFor(() => expect(api.closeCallback).toHaveBeenCalledWith('loc-1', cb))
  })

  it('renders nothing when nobody waits', async () => {
    const { container } = render(<CallbacksPanel locationId="loc-1" date="2026-11-05" />)
    await waitFor(() => expect(api.listCallbacks).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('marks a booking made by phone, with one request for the whole list', async () => {
    render(
      <MemoryRouter>
        <CallBadge locationId="loc-1" reservationId="r1" />
        <CallBadge locationId="loc-1" reservationId="r2" />
      </MemoryRouter>,
    )
    const badge = await screen.findByRole('link', { name: 'Bokad via telefon' })
    expect(badge).toHaveAttribute('href', '/telefon/samtal/20261105abc')
    expect(within(document.body).getAllByRole('link')).toHaveLength(1)
    expect(api.listCalls).toHaveBeenCalledTimes(1)
  })
})
