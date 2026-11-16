import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import QueuePanel from './QueuePanel'
import { tableHref } from '../../shared/TableLinks'
import WaitlistSettingsCard from './WaitlistSettingsCard'
import * as api from './api'
import { ApiError } from '../../shared/api'

vi.mock('../bokningar/SlotTablePicker', () => ({
  SlotTablePicker: ({ onChange }: { onChange: (v: { date: string; startTime: string; tableIds: string[] }) => void }) => (
    <button type="button" onClick={() => onChange({ date: '2026-11-04', startTime: '19:00', tableIds: ['t9'] })}>Välj bord 9</button>
  ),
}))
let role = 'owner_user'
let labels: Map<string, string> | null = new Map([['t4', '4'], ['t9', '9']])
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant: { role } }) }))
vi.mock('../../shared/tables', async (orig) => ({
  ...(await orig<typeof import('../../shared/tables')>()),
  useTables: () => ({ tables: null, labels, error: false }),
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getQueue: vi.fn(), addWalkIn: vi.fn(), offerTable: vi.fn(), seatNow: vi.fn(), removeEntry: vi.fn(), saveSettings: vi.fn(),
}))

const settings: api.Settings = { enabled: true, holdMinutes: 10, maxWaiting: 50, publicJoin: true, version: 1 }
const sara: api.Entry = {
  entryId: 'e1', date: '2026-11-04', name: 'Sara', partySize: 2, phone: '+46701234567', source: 'site',
  status: 'waiting', joinedAt: '2026-11-04T16:00:00Z', position: 1, version: 1,
  notice: { kind: 'joined', at: '2026-11-04T16:00:00Z' },
}

beforeEach(() => {
  vi.clearAllMocks()
  role = 'owner_user'
  labels = new Map([['t4', '4'], ['t9', '9']])
  vi.mocked(api.getQueue).mockResolvedValue({ settings, entries: [sara], suggestions: [{ entryId: 'e1', tableIds: ['t4'], startTime: '18:00' }] })
})

describe('QueuePanel', () => {
  it('shows the suggestion line and offers the suggested table', async () => {
    vi.mocked(api.offerTable).mockResolvedValue({ ...sara, status: 'offered', version: 2 })
    render(<MemoryRouter><QueuePanel locationId="loc-1" date="2026-11-04" /></MemoryRouter>)
    const link = await screen.findByRole('link', { name: 'Bord 4, visa i bordskartan' })
    expect(link).toHaveAttribute('href', tableHref('t4', '2026-11-04'))
    expect(document.body.textContent).toContain('Bord 4 är ledigt för Sara, 2 pers.')
    expect(screen.getByText('Sms ej skickat')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Erbjud bord' })[0])
    await waitFor(() => expect(api.offerTable).toHaveBeenCalledWith('loc-1', sara, ['t4'], '18:00'))
  })

  it('seats a waiting guest at a picked table', async () => {
    vi.mocked(api.seatNow).mockResolvedValue({ entry: { ...sara, status: 'seated' }, reservationId: 'r1' })
    render(<MemoryRouter><QueuePanel locationId="loc-1" date="2026-11-04" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Placera nu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Välj bord 9' }))
    fireEvent.click(screen.getByRole('button', { name: 'Placera' }))
    await waitFor(() => expect(api.seatNow).toHaveBeenCalledWith('loc-1', sara, ['t9']))
  })

  it('adds a walk-in with a client id', async () => {
    vi.mocked(api.addWalkIn).mockResolvedValue(sara)
    render(<MemoryRouter><QueuePanel locationId="loc-1" date="2026-11-04" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Ställ i kö' }))
    fireEvent.change(screen.getByLabelText(/Namn/), { target: { value: 'Ali' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Ställ i kö' }).at(-1)!)
    await waitFor(() => expect(api.addWalkIn).toHaveBeenCalled())
    const [loc, body] = vi.mocked(api.addWalkIn).mock.calls[0]
    expect(loc).toBe('loc-1')
    expect(body).toMatchObject({ name: 'Ali', partySize: 2 })
    expect(body.entryId).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('QueuePanel errors', () => {
  it('never shows table ids while the table names are missing', async () => {
    labels = null
    vi.mocked(api.getQueue).mockResolvedValue({ settings, entries: [{ ...sara, status: 'offered', offer: { reservationId: 'r1', tableIds: ['t4'], startTime: '18:00', endTime: '20:00', expiresAt: '2026-11-04T16:10:00Z' } }],
      suggestions: [{ entryId: 'e1', tableIds: ['t4'], startTime: '18:00' }] })
    const { container } = render(<MemoryRouter><QueuePanel locationId="loc-1" date="2026-11-04" /></MemoryRouter>)
    expect(await screen.findByText('Ett bord är ledigt för Sara, 2 pers.')).toBeInTheDocument()
    expect(container.textContent).not.toContain('t4')
  })

  it('shows the load error with Försök igen instead of vanishing', async () => {
    vi.mocked(api.getQueue).mockRejectedValueOnce(new ApiError(500, 'internal_error', { code: 'internal_error', fromServer: true }))
    render(<MemoryRouter><QueuePanel locationId="loc-1" date="2026-11-04" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Försök igen' }))
    const link = await screen.findByRole('link', { name: 'Bord 4, visa i bordskartan' })
    expect(link).toHaveAttribute('href', tableHref('t4', '2026-11-04'))
    expect(document.body.textContent).toContain('Bord 4 är ledigt för Sara, 2 pers.')
  })
})

describe('WaitlistSettingsCard', () => {
  it('is not shown to staff (owner only on the server)', () => {
    role = 'staff_user'
    const { container } = render(<WaitlistSettingsCard locationId="loc-1" />)
    expect(container).toBeEmptyDOMElement()
    expect(api.getQueue).not.toHaveBeenCalled()
  })

  it('shows the load error with Försök igen', async () => {
    vi.mocked(api.getQueue).mockRejectedValueOnce(new ApiError(503, 'service_unavailable', { code: 'service_unavailable', fromServer: true }))
    render(<WaitlistSettingsCard locationId="loc-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByLabelText(/Hålltid/)).toBeInTheDocument()
  })

  it('saves the settings with the version', async () => {
    vi.mocked(api.saveSettings).mockResolvedValue({ ...settings, holdMinutes: 15, version: 2 })
    render(<WaitlistSettingsCard locationId="loc-1" />)
    fireEvent.change(await screen.findByLabelText(/Hålltid/), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith('loc-1', { ...settings, holdMinutes: 15 }))
  })
})

describe('TableLinks chip', () => {
  it('is one button for a booking at several tables, linking to all of them', async () => {
    const { TableLinks } = await import('../../shared/TableLinks')
    render(
      <MemoryRouter>
        <TableLinks ids={['u3', 'u4']} labels={new Map([['u3', '3'], ['u4', '4']])} date="2026-11-16" />
      </MemoryRouter>,
    )
    const chip = screen.getByRole('link', { name: 'Bord 3 och 4, visa i bordskartan' })
    expect(chip.textContent).toBe('Bord 3 + 4')
    expect(chip).toHaveAttribute('href', tableHref(['u3', 'u4'], '2026-11-16'))
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
