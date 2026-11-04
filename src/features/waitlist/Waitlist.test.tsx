import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QueuePanel from './QueuePanel'
import WaitlistSettingsCard from './WaitlistSettingsCard'
import * as api from './api'

vi.mock('../bokningar/SlotTablePicker', () => ({
  SlotTablePicker: ({ onChange }: { onChange: (v: { date: string; startTime: string; tableIds: string[] }) => void }) => (
    <button type="button" onClick={() => onChange({ date: '2026-11-04', startTime: '19:00', tableIds: ['t9'] })}>Välj bord 9</button>
  ),
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
  vi.mocked(api.getQueue).mockResolvedValue({ settings, entries: [sara], suggestions: [{ entryId: 'e1', tableIds: ['t4'], startTime: '18:00' }] })
})

describe('QueuePanel', () => {
  it('shows the suggestion line and offers the suggested table', async () => {
    vi.mocked(api.offerTable).mockResolvedValue({ ...sara, status: 'offered', version: 2 })
    render(<QueuePanel locationId="loc-1" date="2026-11-04" />)
    expect(await screen.findByText('Bord t4 är ledigt för Sara, 2 pers.')).toBeInTheDocument()
    expect(screen.getByText('Sms ej skickat')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Erbjud bord' })[0])
    await waitFor(() => expect(api.offerTable).toHaveBeenCalledWith('loc-1', sara, ['t4'], '18:00'))
  })

  it('seats a waiting guest at a picked table', async () => {
    vi.mocked(api.seatNow).mockResolvedValue({ entry: { ...sara, status: 'seated' }, reservationId: 'r1' })
    render(<QueuePanel locationId="loc-1" date="2026-11-04" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Placera nu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Välj bord 9' }))
    fireEvent.click(screen.getByRole('button', { name: 'Placera' }))
    await waitFor(() => expect(api.seatNow).toHaveBeenCalledWith('loc-1', sara, ['t9']))
  })

  it('adds a walk-in with a client id', async () => {
    vi.mocked(api.addWalkIn).mockResolvedValue(sara)
    render(<QueuePanel locationId="loc-1" date="2026-11-04" />)
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

describe('WaitlistSettingsCard', () => {
  it('saves the settings with the version', async () => {
    vi.mocked(api.saveSettings).mockResolvedValue({ ...settings, holdMinutes: 15, version: 2 })
    render(<WaitlistSettingsCard locationId="loc-1" />)
    fireEvent.change(await screen.findByLabelText(/Hålltid/), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith('loc-1', { ...settings, holdMinutes: 15 }))
  })
})
