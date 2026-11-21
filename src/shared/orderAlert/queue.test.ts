import { describe, expect, it } from 'vitest'
import type { Order } from '../../features/bestallningar/ordersApi'
import {
  EMPTY_ALERT,
  MAX_SEEN,
  RESTORE_MS,
  acknowledge,
  fromStored,
  newestFirst,
  observe,
  orderSummary,
  toStored,
} from './queue'
import type { AlertState } from './queue'

function order(n: number, extra: Partial<Order> = {}): Order {
  return {
    orderId: `order-${n}`,
    locationId: 'loc-1',
    number: n,
    status: 'confirmed',
    mode: 'pickup',
    lines: [{ menuItemId: 'pizza', name: 'Margherita', unitPrice: 12500, quantity: 1, total: 12500, vatRate: 6 }],
    totalAmount: 12500,
    customerName: `Gäst ${n}`,
    confirmedAt: `2026-11-21T17:${String(n).padStart(2, '0')}:00Z`,
    ...extra,
  }
}

/** Kör listorna i tur och ordning; returnerar sista tillståndet och vad varje lista larmade om. */
function run(lists: Order[][], loc = 'loc-1', from: AlertState = EMPTY_ALERT) {
  let state = from
  const alerts: string[][] = []
  for (const orders of lists) {
    const r = observe(state, loc, orders)
    state = r.state
    alerts.push(r.added.map((o) => o.orderId))
  }
  return { state, alerts }
}

const ids = (orders: readonly Order[]) => orders.map((o) => o.orderId)

describe('order alert queue', () => {
  it('never alerts on the first list for a location (login, new tab)', () => {
    const { state, alerts } = run([[order(1), order(2), order(3)]])
    expect(alerts).toEqual([[]])
    expect(state.open).toEqual([])
    expect(state.seen).toEqual(['order-1', 'order-2', 'order-3'])
  })

  it('alerts once for an order that appears after the first list', () => {
    const { state, alerts } = run([[order(1)], [order(1), order(2)], [order(1), order(2)]])
    expect(alerts).toEqual([[], ['order-2'], []])
    expect(ids(state.open)).toEqual(['order-2'])
  })

  it('appends while the box is open: newest on top, sound for each new one', () => {
    const { state, alerts } = run([[], [order(1)], [order(1), order(2)], [order(1), order(2), order(3), order(4)]])
    expect(alerts).toEqual([[], ['order-1'], ['order-2'], ['order-4', 'order-3']])
    expect(ids(state.open)).toEqual(['order-4', 'order-3', 'order-2', 'order-1'])
  })

  it('never lists the same order twice (same order in several lists, out of order answers)', () => {
    const first = run([[], [order(1), order(2)]])
    // Ett gammalt svar utan 2 och sedan ett nytt med 2 igen: ingen dubblett, inget nytt ljud.
    const { state, alerts } = run([[order(1)], [order(1), order(2)], [order(2), order(1), order(2)]], 'loc-1', first.state)
    expect(alerts).toEqual([[], [], []])
    expect(ids(state.open)).toEqual(['order-2', 'order-1'])
    expect(new Set(ids(state.open)).size).toBe(state.open.length)
  })

  it('OK clears the box; the next new order opens a fresh one', () => {
    const open = run([[], [order(1)], [order(1), order(2)]]).state
    const closed = acknowledge(open)
    expect(closed.open).toEqual([])
    expect(closed.seen).toEqual(open.seen)
    const { state, alerts } = run([[order(1), order(2)], [order(1), order(2), order(3)]], 'loc-1', closed)
    expect(alerts).toEqual([[], ['order-3']])
    expect(ids(state.open)).toEqual(['order-3'])
  })

  it('does not alert again after a reconnect or a page revisit (same list again)', () => {
    const before = run([[order(1)], [order(1), order(2)]]).state
    const after = acknowledge(before)
    const { alerts } = run([[order(1), order(2)], [order(1), order(2)]], 'loc-1', after)
    expect(alerts).toEqual([[], []])
  })

  it('after a gap only alerts orders still waiting under Nya, not ones colleagues already handled', () => {
    const base = run([[order(1)]]).state
    const { state, alerts } = run(
      [[order(1), order(2, { status: 'preparing' }), order(3, { status: 'cancelled' }), order(4)]],
      'loc-1',
      base,
    )
    expect(alerts).toEqual([['order-4']])
    // Ett påbörjat id räknas som sett: det larmar inte senare heller.
    expect(state.seen).toContain('order-2')
    const later = observe(state, 'loc-1', [order(2, { status: 'confirmed' })])
    expect(later.added).toEqual([])
  })

  it('treats a location switch as a first list and closes the old box', () => {
    const a = run([[], [order(1)]]).state
    expect(a.open).toHaveLength(1)
    const { state, alerts } = run([[order(7, { locationId: 'loc-2' })]], 'loc-2', a)
    expect(alerts).toEqual([[]])
    expect(state.locationId).toBe('loc-2')
    expect(state.open).toEqual([])
  })

  it('returns the same state when nothing changed (no re-render)', () => {
    const s = run([[order(1)]]).state
    expect(observe(s, 'loc-1', [order(1)]).state).toBe(s)
    const closed = acknowledge(s)
    expect(closed).toBe(s)
  })

  it('keeps at most MAX_SEEN ids, dropping the oldest', () => {
    const many = Array.from({ length: MAX_SEEN + 5 }, (_, i) => order(i + 1, { orderId: `x-${i}` }))
    const { state } = run([many])
    expect(state.seen).toHaveLength(MAX_SEEN)
    expect(state.seen[0]).toBe('x-5')
  })

  it('sorts newest first by paid time, then by number', () => {
    const a = order(1, { confirmedAt: '2026-11-21T17:00:00Z' })
    const b = order(2, { confirmedAt: '2026-11-21T17:05:00Z' })
    const c = order(3, { confirmedAt: '2026-11-21T17:05:00Z' })
    expect([a, b, c].sort(newestFirst).map((o) => o.number)).toEqual([3, 2, 1])
  })

  describe('reload in the same tab', () => {
    const now = Date.parse('2026-11-21T18:00:00Z')

    it('stores only ids and restores the open box without alerting again', () => {
      const open = run([[order(1)], [order(1), order(2)], [order(1), order(2), order(3)]]).state
      const raw = toStored(open, now)!
      expect(raw).not.toContain('Gäst')
      expect(raw).not.toContain('12500')
      const restored = fromStored(raw, now + 5_000)
      expect(restored.open).toEqual([])
      expect(restored.restore).toEqual(['order-3', 'order-2'])
      // Listan efter omladdningen: 2 och 3 tillbaka i rutan utan ljud, 4 är ny.
      const { state, alerts } = run([[order(1), order(2), order(3), order(4)]], 'loc-1', restored)
      expect(alerts).toEqual([['order-4']])
      expect(ids(state.open)).toEqual(['order-4', 'order-3', 'order-2'])
      expect(state.restore).toEqual([])
    })

    it('alerts an order that came in during the reload', () => {
      const s = run([[order(1)]]).state
      const restored = fromStored(toStored(s, now), now + 3_000)
      expect(run([[order(1), order(2)]], 'loc-1', restored).alerts).toEqual([['order-2']])
    })

    it('starts over when the stored state is old, broken or for nothing', () => {
      const s = run([[order(1)]]).state
      expect(fromStored(toStored(s, now), now + RESTORE_MS + 1)).toEqual(EMPTY_ALERT)
      expect(fromStored('{"v":1', now)).toEqual(EMPTY_ALERT)
      expect(fromStored(JSON.stringify({ v: 2, loc: 'loc-1', seen: [], open: [], at: now }), now)).toEqual(EMPTY_ALERT)
      expect(fromStored(null, now)).toEqual(EMPTY_ALERT)
      expect(toStored(EMPTY_ALERT, now)).toBeNull()
      // Det första efter en gammal sparning larmar inte.
      const fresh = fromStored(toStored(s, now), now + RESTORE_MS + 1)
      expect(run([[order(1), order(2)]], 'loc-1', fresh).alerts).toEqual([[]])
    })
  })

  it('summarises the first lines and how many more', () => {
    const line = (name: string, quantity = 1) => ({ menuItemId: name, name, unitPrice: 100, quantity, total: 100 * quantity, vatRate: 6 })
    expect(orderSummary({ lines: [line('Burgarmeny'), line('Toast Skagen', 2)] })).toBe('Burgarmeny, 2 × Toast Skagen')
    expect(orderSummary({ lines: [line('A'), line('B'), line('C'), line('D'), line('E')] })).toBe('A, B, C +2')
    expect(orderSummary({ lines: [] })).toBe('')
  })
})
