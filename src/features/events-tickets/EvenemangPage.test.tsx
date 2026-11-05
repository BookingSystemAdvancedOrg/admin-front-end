import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EvenemangPage from './EvenemangPage'
import EventsStats from './EventsStats'
import * as api from './api'
import { parseCode, signature } from './scanStore'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant, locationId: 'loc-a-1' }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  listEvents: vi.fn(), createEvent: vi.fn(), getEvent: vi.fn(), updateEvent: vi.fn(), publishEvent: vi.fn(),
  cancelOccurrence: vi.fn(), getJob: vi.fn(), getGuestList: vi.fn(), sendCheckIns: vi.fn(), listOrders: vi.fn(),
  refundTicket: vi.fn(),
}))

const OWNER = { role: 'owner_user', entitlements: { maxLocations: null, features: { events: true } } }
const STAFF = { role: 'staff_user', entitlements: { maxLocations: null, features: { events: true } } }
const OCC = 'EVENT1AAAAAAAA-20261204T1800Z'
const detail: api.EventDetail = {
  eventId: 'EVENT1AAAAAAAA', locationId: 'loc-a-1', title: 'Vinmiddag', description: 'Fem rätter.', status: 'published',
  settings: { perOrderMax: 6, transferAllowed: true }, version: 2,
  occurrences: [{ occurrenceId: OCC, startAt: '2026-12-04T18:00:00Z', endAt: '2026-12-04T22:00:00Z', capacity: 40, sold: 12,
    held: 0, checkedIn: 3, left: 28, status: 'scheduled', version: 1, revenueOre: 1074000 }],
  ticketTypes: [{ typeId: 'T1AAAAAAAA', name: 'Middag', priceOre: 89500, vatRate: 12, perOrderMax: 4, sortOrder: 0, sold: 12, version: 1 }],
}
const SCAN_KEY = 'ab'.repeat(32)

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/evenemang" element={<EvenemangPage />} />
        <Route path="/evenemang/:eventId" element={<EvenemangPage />} />
        <Route path="/evenemang/:eventId/inslapp/:occurrenceId" element={<EvenemangPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listEvents).mockResolvedValue({ events: [{ eventId: 'EVENT1AAAAAAAA', title: 'Vinmiddag', status: 'published',
    nextOccurrence: '2026-12-04T18:00:00Z', sold: 12, capacity: 40 }], cursor: null })
  vi.mocked(api.getEvent).mockResolvedValue(detail)
  vi.mocked(api.listOrders).mockResolvedValue({ orders: [], cursor: null })
})

describe('EvenemangPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    at('/evenemang')
    expect(screen.getByRole('heading', { level: 1, name: 'Evenemang' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(api.listEvents).not.toHaveBeenCalled()
  })

  it('lists the events and lets the owner create one', async () => {
    tenant = OWNER
    at('/evenemang')
    expect(await screen.findByRole('link', { name: 'Vinmiddag' })).toBeInTheDocument()
    expect(screen.getByText('12 av 40')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Nytt evenemang' }))
    expect(screen.getByRole('heading', { name: 'Nytt evenemang' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /12 % \(middag/ })).toBeInTheDocument()
  })

  it('sends a new event with prices in öre and the chosen VAT rate', async () => {
    tenant = OWNER
    vi.mocked(api.createEvent).mockResolvedValue({ ...detail, status: 'draft' })
    at('/evenemang')
    fireEvent.click(await screen.findByRole('button', { name: 'Nytt evenemang' }))
    fireEvent.change(screen.getAllByLabelText(/Namn/)[0], { target: { value: 'Quiz' } })
    fireEvent.change(screen.getByLabelText(/Datum/), { target: { value: '2026-12-10' } })
    fireEvent.change(screen.getAllByLabelText(/Namn/)[1], { target: { value: 'Inträde' } })
    fireEvent.change(screen.getByLabelText(/Pris/), { target: { value: '149,50' } })
    fireEvent.change(screen.getByLabelText(/^Moms/), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.createEvent).toHaveBeenCalled())
    const body = vi.mocked(api.createEvent).mock.calls[0][1]
    expect(body.title).toBe('Quiz')
    expect(body.ticketTypes[0]).toMatchObject({ name: 'Inträde', priceOre: 14950, vatRate: 25 })
    expect(body.occurrences[0].capacity).toBe(40)
  })

  it('shows staff the event without owner actions or money', async () => {
    tenant = STAFF
    at('/evenemang/EVENT1AAAAAAAA')
    expect(await screen.findByRole('heading', { name: 'Vinmiddag' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Insläpp' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ställ in' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Intäkt/)).not.toBeInTheDocument()
    expect(api.listOrders).not.toHaveBeenCalled()
  })

  it('lets the owner cancel an occurrence (mass refund job)', async () => {
    tenant = OWNER
    vi.mocked(api.cancelOccurrence).mockResolvedValue({ jobId: 'J1', toRefund: 12 })
    vi.mocked(api.getJob).mockResolvedValue({ jobId: 'J1', kind: 'mass_refund', done: true, toRefund: 12,
      counts: { refunded: 12, failed: 0, notified: 5 } })
    at('/evenemang/EVENT1AAAAAAAA')
    expect(await screen.findByText(/Intäkt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ställ in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ställ in och återbetala' }))
    expect(await screen.findByText(/Klart. Alla köpare/)).toBeInTheDocument()
    expect(vi.mocked(api.cancelOccurrence).mock.calls[0][2]).toBe(OCC)
  })

  it('checks a typed code offline against the scan key and queues it', async () => {
    tenant = STAFF
    const ticketId = 'T0123456789ABCDEF0123456789'
    vi.mocked(api.getGuestList).mockResolvedValue({ scanKey: SCAN_KEY, counters: { sold: 1, checkedIn: 0, capacity: 40 },
      tickets: [{ ticketId, typeId: 'T1', typeName: 'Middag', holderName: 'Sara Svensson', status: 'valid' }] })
    vi.mocked(api.sendCheckIns).mockRejectedValue(new Error('offline'))
    at(`/evenemang/EVENT1AAAAAAAA/inslapp/${OCC}`)
    expect(await screen.findByText('Sara Svensson')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Biljettkod/), { target: { value: `${ticketId}.0000000000000000` } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Släpp in' })[0])
    expect(await screen.findByText('Biljetten gäller inte för det här tillfället.')).toBeInTheDocument()
    const sig = await signature(SCAN_KEY, ticketId)
    fireEvent.change(screen.getByLabelText(/Biljettkod/), { target: { value: `${ticketId}.${sig}` } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Släpp in' })[0])
    expect(await screen.findByText(/Välkommen, Sara Svensson!/)).toBeInTheDocument()
    await waitFor(() => expect(api.sendCheckIns).toHaveBeenCalled())
    const sent = vi.mocked(api.sendCheckIns).mock.calls[0][3]
    expect(sent[0]).toMatchObject({ ticketId, sig })
  })
})

describe('scan helpers', () => {
  it('reads the QR payload and a typed code', () => {
    expect(parseCode(' tabcdef0123.0123456789ABCDEF ')).toEqual({ ticketId: 'TABCDEF0123', sig: '0123456789abcdef' })
    expect(parseCode('nope')).toBeNull()
  })

  it('signs like the server (HMAC-SHA256, first 16 hex)', async () => {
    // Fixed vector: python hmac.new(bytes.fromhex("ab"*32), b"T1", sha256).hexdigest()[:16]
    expect(await signature(SCAN_KEY, 'T1')).toBe('46fadd5eb4943a49')
  })
})

describe('EventsStats', () => {
  it('renders nothing without insights data and tiles with it', () => {
    const { container, rerender } = render(<EventsStats insights={{}} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<EventsStats insights={{ events: [{ day: '2026-12-04', occurrences: 1, ticketsSold: 10, revenueOre: 895000, checkedIn: 8 }] }} />)
    expect(screen.getByText('Sålda biljetter')).toBeInTheDocument()
    expect(screen.getByText('80 %')).toBeInTheDocument()
  })
})
