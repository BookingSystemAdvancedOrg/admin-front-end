import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { kronor, moveErrorText } from './ordersApi'

describe('ordersApi', () => {
  it('formats öre as kronor', () => {
    expect(kronor(28550)).toBe('285,50 kr')
    expect(kronor(25000)).toBe('250 kr')
  })

  it('turns server errors into Swedish', () => {
    expect(moveErrorText(new ApiError(409, 'changed_retry'))).toMatch(/Någon annan ändrade beställningen/)
    expect(moveErrorText(new ApiError(409, 'cannot_move_completed_to_ready'))).toMatch(/kan inte flyttas/)
    expect(moveErrorText(new ApiError(404, 'not found'))).toMatch(/finns inte längre/)
    expect(moveErrorText(new Error('x'))).toMatch(/^Beställningen ändrades inte\. /)
  })
})

describe('clock', () => {
  it('shows the restaurant time (Europe/Stockholm), not the device zone', async () => {
    const { clock } = await import('./ordersApi')
    // 16:40 UTC in November is 17:40 in Stockholm.
    expect(clock('2026-11-16T16:40:00Z')).toBe('17:40')
    expect(clock('2026-11-16T16:40:00Z', 'Europe/London')).toBe('16:40')
    expect(clock('2026-11-16T16:40:00Z', 'Not/AZone')).toBe('17:40')
    expect(clock(undefined)).toBe('')
  })
})

describe('table bills', () => {
  it('names the new payment states', async () => {
    const { paymentLabel } = await import('./ordersApi')
    expect(paymentLabel({ paymentStatus: 'unpaid' })).toBe('Obetald')
    expect(paymentLabel({ paymentStatus: 'paid_outside' })).toBe('Betald utanför Booqy')
    expect(paymentLabel({ paymentStatus: 'written_off' })).toBe('Avskriven')
    expect(paymentLabel({ paymentStatus: 'void' })).toBe('Avbruten')
    expect(paymentLabel({ paymentStatus: 'paid' })).toBeNull()
  })

  it('without an API: two open bills, the old one first and amber, closed as the server does', async () => {
    const api = await import('./ordersApi')
    api.resetOrdersMock()
    const list = await api.listTabs('mock')
    expect(list.tabs.map((t) => [t.title, t.count, t.stale])).toEqual([['Bord 2', 1, true], ['Bord 4', 2, false]])
    const four = list.tabs[1]
    expect(four.amount).toBe(2 * 12500 + 2 * 7200 + 2 * 8500)
    await expect(api.markPaidOutside('mock', four, { method: 'cash', expectedAmount: four.amount - 1 }))
      .rejects.toMatchObject({ code: 'bill_changed' })
    const done = await api.markPaidOutside('mock', four, { method: 'cash', expectedAmount: four.amount })
    expect(done.orders.map((o) => o.paymentStatus)).toEqual(['paid_outside', 'paid_outside'])
    expect((await api.listTabs('mock')).tabs.map((t) => t.title)).toEqual(['Bord 2'])
    // Dagens lista: gårdagens obetalda beställning syns bara på notan.
    const today = await api.listOrders('mock')
    expect(today.orders.some((o) => o.tableId === 't2')).toBe(false)
    api.resetOrdersMock()
  })

  it('cancelling an unpaid order without an API voids it (nothing refunded)', async () => {
    const api = await import('./ordersApi')
    api.resetOrdersMock()
    const { orders } = await api.listOrders('mock')
    const unpaid = orders.find((o) => o.paymentStatus === 'unpaid')!
    const cancelled = await api.moveOrder('mock', unpaid, 'cancelled')
    expect(cancelled).toMatchObject({ status: 'cancelled', paymentStatus: 'void' })
    api.resetOrdersMock()
  })

  it('turns bill errors into Swedish that says who acts', async () => {
    const { tabErrorText, moveErrorText } = await import('./ordersApi')
    const err = (code: string) => new ApiError(409, code, { code, fromServer: true })
    expect(tabErrorText(err('bill_being_paid'), 'x')).toBe('Gästen betalar notan just nu. Vänta en minut.')
    expect(tabErrorText(err('bill_paid'), 'x')).toBe('Notan är redan betald.')
    expect(tabErrorText(new ApiError(500, 'boom'), 'Notan sparades inte.')).toMatch(/^Notan sparades inte\. Felet ligger hos Booqy/)
    expect(moveErrorText(err('settled_outside_booqy'))).toMatch(/betald utanför Booqy eller avskriven/)
  })
})

describe('revenueToday', () => {
  it('counts paid orders only: unpaid, paid outside Booqy and written off are not revenue', async () => {
    const { revenueToday } = await import('../oversikt/overview')
    const base = { locationId: 'l', status: 'completed' as const, mode: 'table' as const, lines: [], totalAmount: 10000 }
    const orders = [
      { ...base, orderId: '1', paymentStatus: 'paid' as const },
      { ...base, orderId: '2', paymentStatus: 'unpaid' as const },
      { ...base, orderId: '3', paymentStatus: 'paid_outside' as const },
      { ...base, orderId: '4', paymentStatus: 'written_off' as const },
      { ...base, orderId: '5', paymentStatus: 'void' as const, status: 'cancelled' as const },
    ]
    expect(revenueToday(orders)).toEqual({ amount: 10000, count: 1 })
  })
})
