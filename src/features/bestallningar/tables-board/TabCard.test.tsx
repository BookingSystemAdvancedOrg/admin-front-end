import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TabCard } from './TabCard'
import type { Tab, TabItem } from '../table-order/types'
import { canReopen, courseProgress, elapsed, fireReady, nextHeldCourse, toEnter } from './tabState'

const NOW = Date.parse('2026-11-19T18:40:00Z')

function item(extra: Partial<TabItem>): TabItem {
  return {
    itemId: 'i1', menuItemId: 'm1', name: 'Toast Skagen', unitPrice: 14500, quantity: 2, options: [], course: 'starters',
    stationId: 'kok', stationName: 'Kök', state: 'sent', round: 1, addedAt: '2026-11-19T18:00:00Z', addedByName: 'Anna', ...extra,
  }
}

function tab(extra: Partial<Tab> = {}): Tab {
  return {
    tabId: 'a'.repeat(32), status: 'open', tableId: 't5', tableLabel: '5', floorName: 'Matsal', covers: 4,
    guestName: 'Åsa Öberg', reservationId: null,
    items: [
      item({ itemId: 'd1', name: 'Cola', unitPrice: 4500, quantity: 2, course: 'drinks', stationId: 'bar', stationName: 'Bar' }),
      item({ itemId: 's1' }),
      item({ itemId: 'm1', name: 'Oxfilé', unitPrice: 32500, quantity: 4, course: 'mains', state: 'held', round: undefined }),
    ],
    rounds: [{
      round: 1, kind: 'order', at: '2026-11-19T18:02:00Z', byName: 'Anna', courses: ['drinks', 'starters'], itemIds: ['d1', 's1'],
      dispatched: true, stations: [], tickets: [
        { stationId: 'kok', stationName: 'Kök', status: 'preparing' },
        { stationId: 'bar', stationName: 'Bar', status: 'ready' },
      ],
    }],
    referenceTotal: 4500 * 2 + 14500 * 2 + 32500 * 4,
    openedAt: '2026-11-19T18:00:00Z', openedByName: 'Anna', version: 3, updatedAt: '2026-11-19T18:02:00Z', ...extra,
  }
}

describe('tabState', () => {
  it('shows each course as held, sent, preparing or ready from the station tickets', () => {
    const p = courseProgress(tab())
    expect(p.map((c) => [c.label, c.state, c.quantity])).toEqual([
      ['Dryck', 'ready', 2], ['Förrätt', 'preparing', 2], ['Varmrätt', 'held', 4],
    ])
    expect(nextHeldCourse(tab())).toBe('mains')
  })

  it('lights the next course only when the course before is ready on every station', () => {
    expect(fireReady(tab())).toBe(false)
    const ready = tab()
    ready.rounds[0].tickets![0].status = 'ready'
    expect(fireReady(ready)).toBe(true)
    // Only drinks sent before the mains: nothing to wait for, no highlight.
    expect(fireReady(tab({ items: tab().items.filter((i) => i.itemId !== 's1') }))).toBe(false)
  })

  it('counts minutes, flags long and overnight tables', () => {
    expect(elapsed('2026-11-19T18:00:00Z', NOW).text).toBe('40 min')
    expect(elapsed('2026-11-19T16:30:00Z', NOW)).toMatchObject({ text: '2 h 10 min', long: true, stale: false })
    expect(elapsed('2026-11-19T05:00:00Z', NOW).stale).toBe(true)
  })

  it('lists what to key into the POS without void items, merged per dish and price', () => {
    const t = tab({ items: [...tab().items, item({ itemId: 's2', quantity: 1 }), item({ itemId: 'v', state: 'void', name: 'Burrata' })] })
    expect(toEnter(t).map((l) => [l.name, l.quantity, l.amount])).toEqual([
      ['Cola', 2, 9000], ['Toast Skagen', 3, 43500], ['Oxfilé', 4, 130000],
    ])
  })

  it('allows Ångra for 15 minutes after close', () => {
    expect(canReopen(tab({ status: 'closed', closedAt: '2026-11-19T18:30:00Z' }), NOW)).toBe(true)
    expect(canReopen(tab({ status: 'closed', closedAt: '2026-11-19T18:20:00Z' }), NOW)).toBe(false)
  })
})

describe('TabCard', () => {
  function setup(t = tab()) {
    const props = { onOpen: vi.fn(), onAdd: vi.fn(), onFire: vi.fn(), onClose: vi.fn() }
    render(<TabCard tab={t} now={NOW} {...props} />)
    return props
  }

  it('shows the table, guest, time, course chips and the amount to key in', () => {
    setup()
    const card = screen.getByRole('article', { name: 'Bord 5, Åsa Öberg' })
    expect(within(card).getByText('Bord 5')).toBeInTheDocument()
    expect(within(card).getByText('40 min')).toBeInTheDocument()
    expect(within(card).getByText(/Varmrätt/)).toHaveTextContent('Varmrätt 4 · Väntar')
    expect(within(card).getByText(/Förrätt/)).toHaveTextContent('Tillagas')
    expect(within(card).getByText('Att slå in')).toBeInTheDocument()
  })

  it('adds, sends the held course and closes', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('button', { name: /Lägg till/ }))
    expect(p.onAdd).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Skicka varmrätt/ }))
    expect(p.onFire).toHaveBeenCalledWith(expect.objectContaining({ tableLabel: '5' }), 'mains')
    await user.click(screen.getByRole('button', { name: /^Stäng$/ }))
    expect(p.onClose).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Visa Bord 5' }))
    expect(p.onOpen).toHaveBeenCalled()
  })

  it('says when a table has been open since yesterday', () => {
    setup(tab({ openedAt: '2026-11-19T04:00:00Z' }))
    expect(screen.getByText('Öppen sedan igår')).toBeInTheDocument()
  })
})
