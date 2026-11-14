import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CallBadge from './CallBadge'
import CallbacksPanel from './CallbacksPanel'
import TelefonPage from './TelefonPage'
import * as api from './api'
import { resetCallBadgeCacheForTests } from './callBadgeCache'
import { ApiError } from '../../shared/api'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant, locationId: 'loc-1' }),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro', address: null, timezone: null }),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getOverview: vi.fn(), saveConfig: vi.fn(), getLocation: vi.fn(), saveLocation: vi.fn(), setKillSwitch: vi.fn(),
  simulate: vi.fn(), listCalls: vi.fn(), getCall: vi.fn(), deleteRecording: vi.fn(), listCallbacks: vi.fn(), closeCallback: vi.fn(),
}))

const OWNER = { role: 'owner_user', entitlements: { maxLocations: null, features: { phoneAgent: true } }, locations: [{ locationId: 'loc-1', name: 'Bistro' }] }
const STAFF = { ...OWNER, role: 'staff_user' }
const LOC: api.LocationConfig = {
  locationId: 'loc-1', enabled: true, killSwitch: false, mode: 'after_hours', agentHours: { mon: [{ from: '17:00', to: '23:00' }] },
  greetingExtraSv: '', greetingExtraEn: '', transferTo: '+46812345678', maxCallSeconds: 480,
  counterOffers: { nearbyTables: true, phoneOnlyTables: true }, number: '+46100000001', version: 2,
  forwarding: { number: '+46100000001', codes: [{ operator: 'Telia', label: 'Vidarekoppla alla samtal', on: '**21*+46100000001#', off: '##21#' }] },
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

  it('walks the owner through the wizard: the disclosure is fixed text, the number step shows codes', async () => {
    tenant = OWNER
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv', 'en'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 }, locations: [],
      usage: { minutes: 10, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    expect(await screen.findByText(/en AI-assistent för Bistro/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '5. Nummer' }))
    expect(screen.getByText('**21*+46100000001#')).toBeInTheDocument()
  })

  it('shows an error with a retry instead of loading forever when the settings fail', async () => {
    tenant = OWNER
    vi.mocked(api.getOverview).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 }, locations: [],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByText(/en AI-assistent för Bistro/)).toBeInTheDocument()
  })

  it('sends the recording choice with the config save (the notice is shown first)', async () => {
    tenant = OWNER
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 }, locations: [],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    vi.mocked(api.saveConfig).mockRejectedValue(new ApiError(400, 'purpose_required', { fromServer: true }))
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    fireEvent.click(await screen.findByRole('tab', { name: '4. Inspelning' }))
    fireEvent.click(screen.getByLabelText(/Spela in samtalen/))
    expect(screen.getByText(/Samtalet spelas in/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled())
    expect(vi.mocked(api.saveConfig).mock.calls[0][0].recording.enabled).toBe(true)
  })

  it('runs the text simulator', async () => {
    tenant = OWNER
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 }, locations: [],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    vi.mocked(api.simulate).mockResolvedValue({ reply: 'Hej, du pratar med Sara, en AI-assistent för Bistro. Jag håller ett bord.',
      toolCalls: [{ name: 'hold_table', ok: true }], state: {}, disclosure: true })
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    fireEvent.click(await screen.findByRole('tab', { name: '6. Prova' }))
    fireEvent.change(screen.getByLabelText('Du säger'), { target: { value: 'Ett bord för fyra imorgon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Skicka' }))
    expect(await screen.findByText(/Jag håller ett bord/)).toBeInTheDocument()
  })

  it('explains that the assistant follows the caller\'s language', async () => {
    tenant = OWNER
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv', 'en'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 }, locations: [],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    expect(await screen.findByText(/börjar alltid på svenska/)).toBeInTheDocument()
  })

  it('turns a location on with the number of another location (shared number)', async () => {
    tenant = { ...OWNER, locations: [{ locationId: 'loc-1', name: 'Bistro Norrmalm' }, { locationId: 'loc-2', name: 'Bistro Malmö' }] }
    vi.mocked(api.getLocation).mockResolvedValue({ ...LOC, enabled: false, number: null, forwarding: { number: null, codes: [] } })
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 },
      locations: [{ locationId: 'loc-2', name: 'Bistro Malmö', enabled: true, killSwitch: false, mode: 'always', number: '+46100000002', minutesThisPeriod: 0 }],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    vi.mocked(api.saveLocation).mockResolvedValue({ ...LOC, number: '+46100000002', numberSharedWith: 'loc-2' })
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    fireEvent.click(await screen.findByRole('tab', { name: '5. Nummer' }))
    fireEvent.change(screen.getByLabelText(/^Nummer/), { target: { value: 'loc-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Slå på med delat nummer' }))
    await waitFor(() => expect(api.saveLocation).toHaveBeenCalled())
    expect(vi.mocked(api.saveLocation).mock.calls[0][1]).toMatchObject({ enabled: true, shareNumberWith: 'loc-2' })
    expect(await screen.findByText(/samma nummer som Bistro Malmö/)).toBeInTheDocument()
  })

  it('shows when the simulated call switched language', async () => {
    tenant = OWNER
    vi.mocked(api.getOverview).mockResolvedValue({ config: { agentName: 'Sara', tone: 'friendly', languages: ['sv', 'en'],
      recording: { enabled: false }, minutesCapPerMonth: 300, version: 1 }, locations: [],
      usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } })
    vi.mocked(api.simulate).mockResolvedValue({ reply: 'I am an AI assistant for Bistro. I can offer 18:00.', language: 'en',
      toolCalls: [], state: {}, disclosure: false })
    renderAt()
    fireEvent.click(await screen.findByRole('tab', { name: 'Inställningar' }))
    fireEvent.click(await screen.findByRole('tab', { name: '6. Prova' }))
    fireEvent.change(screen.getByLabelText('Du säger'), { target: { value: 'A table for four tomorrow at 7 pm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Skicka' }))
    expect(await screen.findByText(/I can offer 18:00/)).toBeInTheDocument()
    expect(screen.getByText(/på engelska/)).toBeInTheDocument()
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
