import { describe, expect, it } from 'vitest'
import { pollVersion, TICKET_POLL_MS, waitsOnTickets } from './tableOrderApi'
import type { Tab } from './types'

function tab(status: 'sent' | 'preparing' | 'ready' | 'cancelled' | null): Tab {
  return {
    tabId: 't1', status: 'open', tableId: 'b1', tableLabel: 'Bord 1', covers: 2, guestName: null, reservationId: null,
    items: [], referenceTotal: 0, openedAt: '', openedByName: 'Anna', version: 1, updatedAt: '',
    rounds: status === null ? [] : [{
      round: 1, kind: 'order', at: '', byName: 'Anna', courses: ['mains'], itemIds: [], dispatched: true, stations: [],
      tickets: [{ stationId: 'kok', stationName: 'Kök', status }],
    }],
  }
}

describe('table order poll', () => {
  it('reloads the whole list while a ticket waits on Kök or Bar', () => {
    expect(waitsOnTickets([tab('sent')])).toBe(true)
    expect(waitsOnTickets([tab('preparing')])).toBe(true)
    expect(waitsOnTickets([tab('ready'), tab('cancelled'), tab(null)])).toBe(false)
    const now = 100_000
    expect(pollVersion(4, [tab('sent')], now - TICKET_POLL_MS, now)).toBeUndefined()
    expect(pollVersion(4, [tab('sent')], now - 1000, now)).toBe(4)
    expect(pollVersion(4, [tab('ready')], 0, now)).toBe(4)
    expect(pollVersion(undefined, [], 0, now)).toBeUndefined()
  })
})
