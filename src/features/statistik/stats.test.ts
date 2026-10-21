import { describe, expect, it } from 'vitest'
import {
  addDays,
  datesIn,
  daysBetween,
  deltaPct,
  fmtKr,
  fmtPct,
  insightTitle,
  presetRange,
  previousRange,
  summarize,
  weekdayOf,
} from './stats'
import type { DayData } from './stats'
import type { Reservation } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { RequestSummary } from '../catering/cateringApi'

function res(partial: Partial<Reservation> & Pick<Reservation, 'startTime' | 'partySize' | 'status'>): Reservation {
  return {
    reservationId: Math.random().toString(36).slice(2),
    locationId: 'l',
    date: '2026-10-20',
    endTime: '21:00',
    tableIds: [],
    ...partial,
  }
}

function order(partial: Partial<Order> & Pick<Order, 'totalAmount'>): Order {
  return {
    orderId: Math.random().toString(36).slice(2),
    locationId: 'l',
    status: 'completed',
    paymentStatus: 'paid',
    mode: 'pickup',
    lines: [{ menuItemId: 'm', name: 'Pizza', unitPrice: partial.totalAmount, quantity: 1, total: partial.totalAmount, vatRate: 12 }],
    ...partial,
  }
}

describe('periods', () => {
  it('presets end today and are the right length', () => {
    expect(presetRange('d7', '2026-10-21')).toEqual({ from: '2026-10-15', to: '2026-10-21' })
    expect(presetRange('d30', '2026-10-21')).toEqual({ from: '2026-09-22', to: '2026-10-21' })
    expect(presetRange('month', '2026-10-21')).toEqual({ from: '2026-10-01', to: '2026-10-21' })
    expect(presetRange('lastMonth', '2026-10-21')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('the previous period is the same length, ending the day before', () => {
    expect(previousRange('2026-10-15', '2026-10-21')).toEqual({ from: '2026-10-08', to: '2026-10-14' })
    expect(daysBetween('2026-10-15', '2026-10-21')).toBe(7)
    expect(datesIn('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekdayOf('2026-10-21')).toBe(2)
  })
})

describe('summarize', () => {
  const days: DayData[] = [
    {
      date: '2026-10-19',
      reservations: [
        res({ startTime: '18:00', partySize: 2, status: 'arrived', source: 'online', cardOnFile: true }),
        res({ startTime: '18:30', partySize: 4, status: 'reserved', source: 'phone' }),
        res({ startTime: '19:00', partySize: 6, status: 'no_show_charged', source: 'online' }),
        res({ startTime: '20:00', partySize: 2, status: 'cancelled_no_charge', source: 'online' }),
        res({ startTime: '12:00', partySize: 3, status: 'expired', source: 'online' }),
      ],
      orders: [
        order({ totalAmount: 20000, mode: 'pickup' }),
        order({ totalAmount: 30000, mode: 'table', lines: [{ menuItemId: 'a', name: 'Pasta', unitPrice: 15000, quantity: 2, total: 30000, vatRate: 12 }] }),
        order({ totalAmount: 99900, status: 'cancelled' }),
        order({ totalAmount: 5000, paymentStatus: 'refunded' }),
      ],
    },
    {
      date: '2026-10-20',
      reservations: [res({ startTime: '18:15', partySize: 2, status: 'reserved', source: 'walk_in' })],
      orders: [order({ totalAmount: 10000 })],
    },
  ]
  const catering: RequestSummary[] = [
    { requestId: 'c1', status: 'confirmed', customerType: 'company', customerName: 'A', deliveryDate: '2026-10-20', deliveryTime: '12:00', fulfilment: 'delivery', createdAt: '2026-10-01T10:00:00Z', total: 500000 },
    { requestId: 'c2', status: 'requested', customerType: 'private', customerName: 'B', deliveryDate: '2026-11-05', deliveryTime: '12:00', fulfilment: 'pickup', createdAt: '2026-10-20T10:00:00Z' },
    { requestId: 'c3', status: 'delivered', customerType: 'private', customerName: 'C', deliveryDate: '2026-09-01', deliveryTime: '12:00', fulfilment: 'pickup', createdAt: '2026-08-20T10:00:00Z', total: 100000 },
  ]
  const s = summarize(days, catering, { from: '2026-10-19', to: '2026-10-20' })

  it('counts paid orders only and splits them by channel', () => {
    expect(s.orders).toBe(3)
    expect(s.orderRevenue).toBe(60000)
    expect(s.pickupRevenue).toBe(30000)
    expect(s.tableRevenue).toBe(30000)
    expect(s.avgOrder).toBe(20000)
  })

  it('adds catering delivered in the period and counts new requests', () => {
    expect(s.cateringRevenue).toBe(500000)
    expect(s.cateringWon).toBe(1)
    expect(s.cateringRequests).toBe(1)
    expect(s.revenue).toBe(560000)
  })

  it('leaves cancelled bookings out of the volume but keeps no-shows', () => {
    expect(s.bookings).toBe(4)
    expect(s.guests).toBe(14)
    expect(s.cancelled).toBe(2)
    expect(s.noShows).toBe(1)
    expect(s.completed).toBe(3)
    expect(s.noShowPct).toBe(25)
    expect(s.cancelledPct).toBeCloseTo(33.33, 1)
    expect(s.cardOnFilePct).toBe(25)
    expect(s.source).toEqual({ online: 2, phone: 1, onsite: 1 })
    expect(s.avgParty).toBe(3.5)
  })

  it('builds the day, hour, weekday and dish series', () => {
    expect(s.byDay.map((d) => [d.date, d.revenue, d.bookings])).toEqual([
      ['2026-10-19', 50000, 3],
      ['2026-10-20', 10000, 1],
    ])
    expect(s.byHour).toEqual([{ hour: 18, bookings: 3 }, { hour: 19, bookings: 1 }])
    expect(s.byWeekday[0]).toEqual({ weekday: 0, label: 'Mån', bookings: 3, guests: 12 })
    expect(s.byWeekday[1]).toEqual({ weekday: 1, label: 'Tis', bookings: 1, guests: 2 })
    // Lika antal och belopp: i bokstavsordning.
    expect(s.topDishes[0]).toEqual({ name: 'Pasta', quantity: 2, revenue: 30000 })
    expect(s.topDishes[1]).toEqual({ name: 'Pizza', quantity: 2, revenue: 30000 })
    expect(s.days).toBe(2)
  })

  it('is empty but well-formed without data', () => {
    const e = summarize([], [], { from: '2026-10-19', to: '2026-10-20' })
    expect(e.revenue).toBe(0)
    expect(e.avgOrder).toBeNull()
    expect(e.noShowPct).toBeNull()
    expect(e.byHour).toEqual([])
    expect(e.topDishes).toEqual([])
  })
})

describe('text', () => {
  it('compares and words the change in Swedish', () => {
    expect(deltaPct(120, 100)).toBe(20)
    expect(deltaPct(100, 0)).toBeNull()
    expect(deltaPct(null, 5)).toBeNull()
    expect(insightTitle('Omsättningen', 12.4)).toBe('Omsättningen upp 12\u00a0%')
    expect(insightTitle('Omsättningen', -5.55)).toBe('Omsättningen ned 5,6\u00a0%')
    expect(insightTitle('Omsättningen', 0.2)).toBe('Omsättningen oförändrad')
    expect(insightTitle('Omsättningen', null)).toBe('Omsättningen')
  })

  it('formats money and percentages the Swedish way', () => {
    expect(fmtKr(940500).replace(/ /g, ' ')).toBe('9 405 kr')
    expect(fmtKr(null)).toBe('-')
    expect(fmtPct(33.333)).toBe('33\u00a0%')
    expect(fmtPct(2.5)).toBe('2,5\u00a0%')
    expect(fmtPct(0)).toBe('0\u00a0%')
  })
})
