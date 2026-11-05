import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import EvenemangPage from './EvenemangPage'
import { validateCapacity, validateType, typeForm } from './edit'
import { occurrenceWindow } from './EventEditor'
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
  refundTicket: vi.fn(), updateTicketType: vi.fn(), updateOccurrence: vi.fn(),
}))

const OWNER = { role: 'owner_user', entitlements: { maxLocations: null, features: { events: true } } }
const STAFF = { role: 'staff_user', entitlements: { maxLocations: null, features: { events: true } } }
const OCC = 'EVENT1AAAAAAAA-20261204T1800Z'
const detail: api.EventDetail = {
  eventId: 'EVENT1AAAAAAAA', locationId: 'loc-a-1', title: 'Vinmiddag', description: 'Fem rätter.', status: 'published',
  settings: { perOrderMax: 6, transferAllowed: true }, version: 2,
  occurrences: [{ occurrenceId: OCC, startAt: '2026-12-04T18:00:00Z', endAt: '2026-12-04T22:00:00Z', capacity: 40, sold: 12,
    held: 0, checkedIn: 3, left: 28, status: 'scheduled', version: 1, revenueOre: 1074000 }],
  ticketTypes: [{ typeId: 'T1AAAAAAAA', name: 'Middag', priceOre: 89500, vatRate: 12, perOrderMax: 4, sortOrder: 0, sold: 12, held: 0, version: 1 }],
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

  it('lets an event end after midnight (the end rolls to the next day)', async () => {
    tenant = OWNER
    vi.mocked(api.createEvent).mockResolvedValue({ ...detail, status: 'draft' })
    at('/evenemang')
    fireEvent.click(await screen.findByRole('button', { name: 'Nytt evenemang' }))
    fireEvent.change(screen.getAllByLabelText(/Namn/)[0], { target: { value: 'Klubbkväll' } })
    fireEvent.change(screen.getByLabelText(/Datum/), { target: { value: '2026-12-10' } })
    fireEvent.change(screen.getByLabelText(/Börjar/), { target: { value: '21:00' } })
    fireEvent.change(screen.getByLabelText(/Slutar/), { target: { value: '01:00' } })
    fireEvent.change(screen.getAllByLabelText(/Namn/)[1], { target: { value: 'Inträde' } })
    fireEvent.change(screen.getByLabelText(/Pris/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.createEvent).toHaveBeenCalled())
    const { startAt, endAt } = vi.mocked(api.createEvent).mock.calls[0][1].occurrences[0]
    expect(new Date(endAt).getTime() - new Date(startAt).getTime()).toBe(4 * 3600 * 1000)
    expect(startAt).toBe(new Date('2026-12-10T21:00:00').toISOString())
    expect(endAt).toBe(new Date('2026-12-11T01:00:00').toISOString())
    // the same day when the end is after the start
    const same = occurrenceWindow('2026-12-10', '19:00', '22:00')
    expect(new Date(same.endAt).getTime() - new Date(same.startAt).getTime()).toBe(3 * 3600 * 1000)
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

  it('polls the job when the cancel call times out but the job exists', async () => {
    tenant = OWNER
    vi.mocked(api.cancelOccurrence).mockRejectedValue(new ApiError(504, 'timeout'))
    const running = { jobId: 'J1', kind: 'mass_refund', done: false, toRefund: 12, counts: { refunded: 10, failed: 2, notified: 0 } }
    vi.mocked(api.getJob).mockResolvedValueOnce(running).mockResolvedValueOnce(running)
      .mockResolvedValue({ ...running, done: true, counts: { refunded: 12, failed: 0, notified: 5 } })
    at('/evenemang/EVENT1AAAAAAAA')
    expect(await screen.findByText(/Intäkt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ställ in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ställ in och återbetala' }))
    expect(await screen.findByText('10 av 12 återbetalda')).toBeInTheDocument()
    expect(screen.getByText(/2 återbetalningar väntar på Stripe/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ställ in och återbetala' })).not.toBeInTheDocument()
    const sentJobId = vi.mocked(api.cancelOccurrence).mock.calls[0][3].jobId
    expect(vi.mocked(api.getJob).mock.calls.every(([, id]) => id === sentJobId)).toBe(true)
  })

  it('shows the error when the cancel call fails and no job was started', async () => {
    tenant = OWNER
    vi.mocked(api.cancelOccurrence).mockRejectedValue(new ApiError(409, 'changed_retry'))
    vi.mocked(api.getJob).mockRejectedValue(new ApiError(404, 'not_found'))
    at('/evenemang/EVENT1AAAAAAAA')
    expect(await screen.findByText(/Intäkt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ställ in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ställ in och återbetala' }))
    await waitFor(() => expect(api.getJob).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Ställ in och återbetala' })).toBeInTheDocument()
    expect(screen.queryByText(/återbetalda/)).not.toBeInTheDocument()
  })

  it('refunds a ticket with one txId derived from the ticket, so a retry is the same refund', () => {
    expect(api.refundTxId('T0123456789ABCDEF0123456789')).toBe('rf_T0123456789ABCDEF0123456789')
    expect(api.refundTxId('T0123456789ABCDEF0123456789')).toMatch(/^[0-9A-Za-z_]{8,40}$/)
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

describe('editing ticket types and occurrences after sales', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('sends a new price and VAT rate for later sales and warns that the VAT change is flagged', async () => {
    tenant = OWNER
    vi.mocked(api.updateTicketType).mockResolvedValue({ ...detail.ticketTypes[0], priceOre: 99500, vatRate: 25, version: 2,
      vatReview: 'needs_accountant_review' })
    at('/evenemang/EVENT1AAAAAAAA')
    fireEvent.click(await screen.findByRole('button', { name: 'Ändra Middag' }))
    expect(screen.getByText(/12 sålda\. Sålda och reserverade biljetter behåller sitt pris/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Pris/), { target: { value: '995' } })
    expect(screen.getByText(/Nya priset gäller bara nya köp. Sålda biljetter kostade 895 kr./)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Moms/), { target: { value: '25' } })
    expect(screen.getByText(/Momssatsen ändras från 12 % till 25 % för nya köp. Redan sålda biljetter behåller sin moms. Ändringen sparas och markeras för granskning av revisorn./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateTicketType).toHaveBeenCalled())
    const [loc, eventId, typeId, body] = vi.mocked(api.updateTicketType).mock.calls[0]
    expect([loc, eventId, typeId]).toEqual(['loc-a-1', 'EVENT1AAAAAAAA', 'T1AAAAAAAA'])
    expect(body).toEqual({ name: 'Middag', priceOre: 99500, vatRate: 25, perOrderMax: 4, sortOrder: 0, version: 1 })
    expect(await screen.findByText('Momsen ändrad: revisorn ska granska')).toBeInTheDocument()
  })

  it('refuses a type capacity below sold and held in Swedish, before calling the server', async () => {
    tenant = OWNER
    vi.mocked(api.getEvent).mockResolvedValue({ ...detail, ticketTypes: [{ ...detail.ticketTypes[0], capacity: 20, held: 2 }] })
    at('/evenemang/EVENT1AAAAAAAA')
    fireEvent.click(await screen.findByRole('button', { name: 'Ändra Middag' }))
    fireEvent.change(screen.getByLabelText(/^Antal av typen/), { target: { value: '13' } })
    fireEvent.change(screen.getByLabelText(/^Namn/), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText('Det finns redan 12 sålda och 2 reserverade i pågående köp, så antalet kan inte vara lägre än 14.')).toBeInTheDocument()
    expect(screen.getByText('Skriv ett namn på biljettypen.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Namn/)).toHaveAttribute('aria-invalid', 'true')
    expect(api.updateTicketType).not.toHaveBeenCalled()
  })

  it('shows a sale during the edit on the field (server invalid_capacity)', async () => {
    tenant = OWNER
    vi.mocked(api.updateOccurrence).mockRejectedValue(new ApiError(400, 'invalid_capacity', { code: 'invalid_capacity', field: 'capacity', fromServer: true }))
    at('/evenemang/EVENT1AAAAAAAA')
    fireEvent.click(await screen.findByRole('button', { name: /^Ändra platser/ }))
    fireEvent.change(screen.getByLabelText(/^Antal platser/), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText('Det finns redan 12 sålda, så antalet kan inte vara lägre än 12.')).toBeInTheDocument()
    expect(api.updateOccurrence).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Antal platser/), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText(/Fler platser såldes medan du ändrade/)).toBeInTheDocument()
    expect(vi.mocked(api.updateOccurrence).mock.calls[0].slice(2)).toEqual([OCC, { capacity: 12, version: 1 }])
  })

  it('saves a new occurrence capacity and shows it', async () => {
    tenant = OWNER
    vi.mocked(api.updateOccurrence).mockResolvedValue({ ...detail.occurrences[0], capacity: 60, left: 48, version: 2 })
    at('/evenemang/EVENT1AAAAAAAA')
    fireEvent.click(await screen.findByRole('button', { name: /^Ändra platser/ }))
    fireEvent.change(screen.getByLabelText(/^Antal platser/), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText('12 sålda av 60, 3 insläppta')).toBeInTheDocument()
  })

  it('offers no edits to staff or once the event is over', async () => {
    tenant = STAFF
    const { unmount } = at('/evenemang/EVENT1AAAAAAAA')
    expect(await screen.findByRole('heading', { name: 'Vinmiddag' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ändra Middag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ändra platser/ })).not.toBeInTheDocument()
    unmount()
    tenant = OWNER
    vi.setSystemTime(new Date('2026-12-05T00:00:00Z'))
    at('/evenemang/EVENT1AAAAAAAA')
    expect(await screen.findByText(/Intäkt/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ändra Middag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ändra platser/ })).not.toBeInTheDocument()
  })

  it('returns focus to the opening button after Avbryt and after a successful Spara (both modals)', async () => {
    tenant = OWNER
    vi.mocked(api.updateTicketType).mockResolvedValue({ ...detail.ticketTypes[0], version: 2 })
    vi.mocked(api.updateOccurrence).mockResolvedValue({ ...detail.occurrences[0], capacity: 50, left: 38, version: 2 })
    at('/evenemang/EVENT1AAAAAAAA')
    const typeButton = await screen.findByRole('button', { name: 'Ändra Middag' })
    typeButton.focus()
    fireEvent.click(typeButton)
    screen.getByRole('button', { name: 'Avbryt' }).focus()  // focus inside the modal (jsdom has no showModal)
    expect(screen.getByRole('button', { name: 'Avbryt' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ändra Middag' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Ändra Middag' }))
    screen.getByRole('button', { name: 'Spara' }).focus()  // focus inside the modal (jsdom has no showModal)
    expect(screen.getByRole('button', { name: 'Spara' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateTicketType).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ändra Middag' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: /^Ändra platser/ }))
    screen.getByRole('button', { name: 'Avbryt' }).focus()  // focus inside the modal (jsdom has no showModal)
    expect(screen.getByRole('button', { name: 'Avbryt' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Ändra platser/ })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: /^Ändra platser/ }))
    fireEvent.change(screen.getByLabelText(/^Antal platser/), { target: { value: '50' } })
    screen.getByRole('button', { name: 'Spara' }).focus()  // focus inside the modal (jsdom has no showModal)
    expect(screen.getByRole('button', { name: 'Spara' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.updateOccurrence).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /^Ändra platser/ })).toHaveFocus())
  })

  it('shows a server invalid_capacity on tier (the untilSold cap) on the capacity field', async () => {
    tenant = OWNER
    vi.mocked(api.updateTicketType).mockRejectedValue(new ApiError(400, 'invalid_capacity', { code: 'invalid_capacity', field: 'tier', fromServer: true }))
    at('/evenemang/EVENT1AAAAAAAA')
    fireEvent.click(await screen.findByRole('button', { name: 'Ändra Middag' }))
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText(/Fler biljetter såldes medan du ändrade/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Antal av typen/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^Säljs till/)).not.toHaveAttribute('aria-invalid')
  })

  it('validates in Swedish (pure helpers)', () => {
    const t = { ...detail.ticketTypes[0], held: 1 }
    const ok = typeForm(t)
    expect(ok.priceKr).toBe('895')
    expect(validateType(ok, t)).toEqual({})
    expect(validateType({ ...ok, priceKr: '-5' }, t).priceKr).toBe('Skriv priset i kronor, till exempel 495 eller 495,50.')
    expect(validateType({ ...ok, priceKr: '12,345' }, t).priceKr).toBeDefined()
    expect(validateType({ ...ok, perOrderMax: '21' }, t).perOrderMax).toBe('Max per köp ska vara ett heltal från 1 till 20.')
    expect(validateType({ ...ok, from: '2026-12-01T10:00', until: '2026-12-01T09:00' }, t).until)
      .toBe('Försäljningen måste sluta efter att den har börjat.')
    expect(validateType({ ...ok, capacity: '12' }, t).capacity).toBe('Det finns redan 12 sålda och 1 reserverade i pågående köp, så antalet kan inte vara lägre än 13.')
    const o = detail.occurrences[0]
    expect(validateCapacity('', o)).toBe('Skriv antalet platser.')
    expect(validateCapacity('2,5', o)).toBe('Antalet platser ska vara ett heltal, minst 1.')
    expect(validateCapacity('10001', o)).toBe('Antalet platser får vara högst 10\u00a0000.')
    expect(validateCapacity('12', o)).toBeNull()
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
