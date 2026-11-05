import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PersonalliggarePage from './PersonalliggarePage'
import * as api from './api'
import { ApiError } from '../../shared/api'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant, locationId: 'loc-1' }),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro', address: null, timezone: null }),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../installningar/usersApi', () => ({ listUsers: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getDay: vi.fn(), checkIn: vi.fn(), checkOut: vi.fn(), correct: vi.fn(), getInspection: vi.fn(),
  exportLedger: vi.fn(), listPersons: vi.fn(), savePerson: vi.fn(),
}))

const OWNER = { role: 'owner_user', entitlements: { maxLocations: null, features: { personalliggare: true } }, locations: [] }
const STAFF = { ...OWNER, role: 'staff_user' }
const ROW: api.Row = { seq: 1, kind: 'check_in', personId: 'p1', name: 'Sara', eventTime: '2026-11-05T07:00:00Z', recordedAt: '2026-11-05T07:00:00Z', recordedBy: { role: 'staff' } }
const day = (over: Partial<api.Day> = {}): api.Day => ({
  day: '2026-11-05', present: [], records: [], me: { personId: 'p1', name: 'Sara', present: false, worksHere: true }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getDay).mockResolvedValue(day())
  vi.mocked(api.listPersons).mockResolvedValue([
    { personId: 'p1', name: 'Sara', personalIdentity: '19900101-0017', userSub: 's1', locationIds: [], active: true, version: 1 },
    { personId: 'p2', name: 'Hugo', personalIdentity: '19850709-1236', userSub: null, locationIds: ['loc-1'], active: true, version: 1 },
  ])
})

describe('PersonalliggarePage', () => {
  it('says the feature is not in the plan while it is off, and never calls the API', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<PersonalliggarePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Personalliggare (under granskning)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(api.getDay).not.toHaveBeenCalled()
  })

  it('lets staff check in themselves and shows the paper fallback', async () => {
    tenant = STAFF
    vi.mocked(api.checkIn).mockResolvedValue(ROW)
    render(<PersonalliggarePage />)
    expect(screen.getByText(/För liggaren på papper och lägg in rättelser efteråt/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Checka in' }))
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledWith('loc-1', undefined))
    expect(screen.queryByRole('tab', { name: 'Personer' })).not.toBeInTheDocument()  // owner tabs hidden
    expect(api.listPersons).not.toHaveBeenCalled()
  })

  it('shows check-out when present and the corrected row beside the original', async () => {
    tenant = STAFF
    vi.mocked(api.getDay).mockResolvedValue(day({
      me: { personId: 'p1', name: 'Sara', present: true, worksHere: true },
      present: [{ personId: 'p1', name: 'Sara', since: '2026-11-05T07:00:00Z', checkInSeq: 1 }],
      records: [{ ...ROW, eventTime: '2026-11-05T06:30:00Z', reason: 'Glömde', correctedBySeq: 2, original: ROW }],
    }))
    render(<PersonalliggarePage />)
    expect(await screen.findByRole('button', { name: 'Checka ut' })).toBeInTheDocument()
    expect(screen.getByText(/Rättad \(var In 08:00\): Glömde/)).toBeInTheDocument()
  })

  it('tells a login without a person what to do', async () => {
    tenant = STAFF
    vi.mocked(api.getDay).mockResolvedValue(day({ me: null }))
    render(<PersonalliggarePage />)
    expect(await screen.findByText(/Be ägaren lägga till dig/)).toBeInTheDocument()
  })

  it('opens the inspection view with identity numbers', async () => {
    tenant = STAFF
    vi.mocked(api.getInspection).mockResolvedValue({
      day: '2026-11-05', employer: { legalName: 'Bistro AB', orgNumber: '556677-8899' }, premises: { name: 'Bistro', address: 'Storgatan 1' },
      present: [{ personId: 'p1', name: 'Sara', since: '2026-11-05T07:00:00Z', checkInSeq: 1, personalIdentity: '19900101-0017' }],
      records: [{ ...ROW, personalIdentity: '19900101-0017' }], generatedAt: '2026-11-05T08:00:00Z',
    })
    render(<PersonalliggarePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Visa för Skatteverket' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findAllByText('19900101-0017')).toHaveLength(2)
    expect(within(dialog).getByText(/Bistro AB \(556677-8899\)/)).toBeInTheDocument()
  })

  it('lets the owner record for someone else', async () => {
    tenant = OWNER
    vi.mocked(api.checkIn).mockResolvedValue({ ...ROW, personId: 'p2', name: 'Hugo' })
    render(<PersonalliggarePage />)
    fireEvent.change(await screen.findByLabelText('Registrera för någon annan'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Checka in Hugo' }))
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledWith('loc-1', 'p2'))
  })

  it('saves a correction with a reason from the Rättelser tab', async () => {
    tenant = OWNER
    vi.mocked(api.getDay).mockResolvedValue(day({ records: [ROW] }))
    vi.mocked(api.correct).mockResolvedValue({ ...ROW, seq: 2, kind: 'correction' })
    render(<PersonalliggarePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Rättelser' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rätta' }))
    fireEvent.change(screen.getByLabelText(/Rätt tid/), { target: { value: '07:45' } })
    fireEvent.change(screen.getByLabelText(/Orsak/), { target: { value: 'Kom tidigare' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara rättelse' }))
    await waitFor(() => expect(api.correct).toHaveBeenCalled())
    const [loc, body] = vi.mocked(api.correct).mock.calls[0]
    expect(loc).toBe('loc-1')
    expect(body).toMatchObject({ personId: 'p1', kind: 'check_in', correctsSeq: 1, reason: 'Kom tidigare' })
  })

  it('shows the API reason when a person is refused', async () => {
    tenant = OWNER
    vi.mocked(api.savePerson).mockRejectedValue(new ApiError(400, 'invalid_personal_identity', { fromServer: true }))
    render(<PersonalliggarePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Personer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lägg till person' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Namn/), { target: { value: 'Ny' } })
    fireEvent.change(within(dialog).getByLabelText(/Personnummer/), { target: { value: '811228-9875' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Spara' }))
    expect(await within(dialog).findByText(api.ERRORS.invalid_personal_identity)).toBeInTheDocument()
  })

  it('reports the chain check after an export', async () => {
    tenant = OWNER
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.mocked(api.exportLedger).mockResolvedValue({ filename: 'p.csv', format: 'csv', count: 4, chainOk: false, firstBadSeq: 3, content: 'x' })
    render(<PersonalliggarePage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Exportera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ladda ner CSV' }))
    expect(await screen.findByText(/hittade ett fel vid rad 3/)).toBeInTheDocument()
  })
})

describe('stockholmIso', () => {
  it('turns Stockholm local time into UTC across daylight saving', () => {
    expect(api.stockholmIso('2026-11-05', '08:15')).toBe('2026-11-05T07:15:00Z')
    expect(api.stockholmIso('2026-07-01', '08:15')).toBe('2026-07-01T06:15:00Z')
  })
})
