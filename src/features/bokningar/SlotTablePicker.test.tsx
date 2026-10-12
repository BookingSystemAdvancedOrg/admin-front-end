import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotTablePicker } from './SlotTablePicker'
import { dayNotice } from './bookingsApi'

const getAvailability = vi.fn()
vi.mock('./bookingsApi', async (orig) => ({
  ...(await orig<typeof import('./bookingsApi')>()),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
}))
vi.mock('../../shared/tables', async (orig) => ({
  ...(await orig<typeof import('../../shared/tables')>()),
  useTables: () => ({
    tables: null,
    labels: new Map([
      ['0f9c2d6e-uuid', '1'],
      ['7ab3e1c4-uuid', '2'],
    ]),
    error: false,
  }),
}))

const TODAY = '2026-10-12'

function picker(startTime = '18:00') {
  return render(
    <SlotTablePicker
      locationId="loc-1"
      date={TODAY}
      startTime={startTime}
      tableIds={[]}
      partySize={2}
      today={TODAY}
      onChange={() => {}}
    />,
  )
}

beforeEach(() => getAvailability.mockReset())

describe('SlotTablePicker', () => {
  it('shows tables by number, never by id, in number order', async () => {
    getAvailability.mockResolvedValue({
      slots: [{ startTime: '18:00', endTime: '20:00', layoutVersion: 1, tables: [
        { tableId: '7ab3e1c4-uuid', seats: 4 }, { tableId: '0f9c2d6e-uuid', seats: 2 }] }],
      day: null,
    })
    picker()
    const chips = await screen.findAllByRole('checkbox')
    expect(chips.map((c) => c.closest('label')?.textContent)).toEqual(['Bord 1 · 2 pl', 'Bord 2 · 4 pl'])
    expect(screen.queryByText(/uuid/)).toBeNull()
  })

  it('explains a closed day instead of just "no times"', async () => {
    getAvailability.mockResolvedValue({ slots: [], day: { kind: 'closed', note: 'Privat fest' } })
    picker('')
    expect(await screen.findByText('Restaurangen är stängd den dagen (Privat fest).')).toBeInTheDocument()
  })

  it('tells staff they can still book on a day without online booking', async () => {
    getAvailability.mockResolvedValue({ slots: [], day: { kind: 'no_online' } })
    picker('')
    expect(await screen.findByText(/Onlinebokningen är stängd den dagen - här kan du ändå boka/)).toBeInTheDocument()
  })
})

describe('dayNotice', () => {
  it('describes each kind of special day', () => {
    expect(dayNotice(null)).toBeNull()
    expect(dayNotice({ kind: 'hours', intervals: [{ opensAt: '11:00', closesAt: '14:00' },
      { opensAt: '17:00', closesAt: '22:00' }] })).toBe(
      'Avvikande öppettider den dagen: 11:00–14:00, 17:00–22:00.',
    )
  })
})
