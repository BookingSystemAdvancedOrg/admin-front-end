import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RemovedTablesBookings, dayLabel } from './RemovedTablesBookings'

// En vanlig funktion (inte vi.fn): ett avvisat löfte genom en spion räknas som ohanterat.
let calls: unknown[][] = []
let impl: (...a: unknown[]) => Promise<unknown> = () => Promise.resolve([])
vi.mock('../bokningar/bookingsApi', () => ({
  listReservations: (...a: unknown[]) => {
    calls.push(a)
    return impl(...a)
  },
}))
vi.mock('../../shared/tables', async () => {
  const actual = await vi.importActual<typeof import('../../shared/tables')>('../../shared/tables')
  return { ...actual, useTables: () => ({ tables: null, labels: new Map([['t9', '7']]), error: false }) }
})

beforeEach(() => {
  calls = []
})

describe('RemovedTablesBookings', () => {
  it('lists day, time, guest and table number for each booking', async () => {
    impl = () => Promise.resolve([{ reservationId: 'r1', customerName: 'Sara Ek' }])
    render(
      <RemovedTablesBookings
        locationId="loc"
        bookings={[{ reservationId: 'r1', date: '2026-11-20', startTime: '18:00', tableIds: ['t9'] }]}
      />,
    )
    expect(await screen.findByText('Sara Ek')).toBeTruthy()
    expect(screen.getByText('18:00')).toBeTruthy()
    expect(screen.getByText('Bord 7')).toBeTruthy()
    expect(screen.getByText(dayLabel('2026-11-20'))).toBeTruthy()
    expect(calls).toEqual([['loc', '2026-11-20']])
  })

  it('still lists the booking when the guest names cannot be read', async () => {
    impl = () => Promise.reject(new Error('offline'))
    render(
      <RemovedTablesBookings
        locationId="loc"
        bookings={[{ reservationId: 'r2', date: '2026-11-21', startTime: '12:30', tableIds: ['t9'] }]}
      />,
    )
    expect(await screen.findByText('Gäst')).toBeTruthy()
    expect(screen.getByText('12:30')).toBeTruthy()
  })

  it('formats the day in Swedish', () => {
    expect(dayLabel('2026-11-20')).toMatch(/20 nov/)
  })
})
