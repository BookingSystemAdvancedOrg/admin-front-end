import { describe, expect, it } from 'vitest'
import { activeOrders, bookingsToday, clockIn, revenueToday, todoQueue } from './overview'
import type { Reservation } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { RequestSummary } from '../catering/cateringApi'

const res = (over: Partial<Reservation>): Reservation =>
  ({ reservationId: 'r', locationId: 'l', date: '2026-10-15', startTime: '18:00', endTime: '20:00',
    tableIds: ['t'], partySize: 2, status: 'reserved', customerName: 'Gäst', ...over }) as Reservation

const order = (over: Partial<Order>): Order =>
  ({ orderId: 'o', locationId: 'l', status: 'confirmed', paymentStatus: 'paid', mode: 'pickup',
    lines: [], totalAmount: 10000, ...over }) as Order

const req = (status: RequestSummary['status']): RequestSummary =>
  ({ requestId: 'c', status, customerType: 'private', customerName: 'A', deliveryDate: 'x', deliveryTime: 'x',
    fulfilment: 'pickup', createdAt: 'x' }) as RequestSummary

describe('Översiktens nyckeltal', () => {
  it('Bokningar idag: räknar aktiva bokningar och gäster, och hittar nästa gäst som inte kommit', () => {
    const today = [
      res({ startTime: '12:00', status: 'arrived', partySize: 2 }),
      res({ startTime: '18:30', customerName: 'Sara', partySize: 6 }),
      res({ startTime: '18:00', customerName: 'Erik', partySize: 4 }),
      res({ startTime: '19:00', status: 'cancelled_no_charge', partySize: 3 }),
      res({ startTime: '16:00', partySize: 2 }),
    ]
    const k = bookingsToday(today, '17:15')!
    expect(k.count).toBe(4)
    expect(k.guests).toBe(14)
    expect(k.next?.customerName).toBe('Erik')
    expect(bookingsToday(today, '23:00')!.next).toBeNull()
    expect(bookingsToday(null, '12:00')).toBeNull()
  })

  it('Dagens omsättning: bara betalda beställningar som inte avbrutits eller återbetalats', () => {
    const orders = [
      order({ totalAmount: 46000 }),
      order({ totalAmount: 23500, status: 'completed' }),
      order({ totalAmount: 99900, status: 'cancelled', paymentStatus: 'refunded' }),
      order({ totalAmount: 5000, status: 'pending_payment', paymentStatus: 'processing' }),
      order({ totalAmount: 7000, status: 'failed', paymentStatus: 'failed' }),
    ]
    expect(revenueToday(orders)).toEqual({ amount: 69500, count: 2 })
    expect(revenueToday(null)).toBeNull()
  })

  it('Aktiva beställningar: betalda men inte klara eller hämtade', () => {
    const orders = [
      order({ status: 'confirmed' }), order({ status: 'confirmed' }), order({ status: 'preparing' }),
      order({ status: 'ready' }), order({ status: 'completed' }), order({ status: 'pending_payment' }),
    ]
    expect(activeOrders(orders)).toEqual({ count: 4, fresh: 2, preparing: 1, ready: 1 })
  })

  it('Att hantera: misslyckade betalningar först, sedan catering och obekräftade bokningar', () => {
    const today = [
      res({ status: 'pending' }),
      res({ status: 'no_show', payment: { status: 'failed' } }),
      res({ status: 'reserved' }),
    ]
    const q = todoQueue(today, [req('requested'), req('change_requested'), req('offer_sent'), req('signed')])!
    expect(q.total).toBe(4)
    expect(q.items.map((i) => [i.id, i.count])).toEqual([['payments', 1], ['catering', 2], ['unconfirmed', 1]])
    expect(q.items[0].to).toBe('/bokningar')
    expect(todoQueue([res({})], [])).toEqual({ total: 0, items: [] })
    expect(todoQueue(null, null)).toBeNull()
  })

  it('klockan räknas i restaurangens tidszon', () => {
    expect(clockIn('Europe/Stockholm', new Date('2026-10-15T15:05:00Z'))).toBe('17:05')
    expect(clockIn('Not/AZone', new Date('2026-10-15T15:05:00Z'))).toBe('17:05')
  })
})
