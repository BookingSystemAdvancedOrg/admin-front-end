import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { kronor, moveErrorText, refundLabel } from './ordersApi'
import type { Order } from './ordersApi'

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

describe('refundLabel with a refund that came back', () => {
  const base = { orderId: 'o1', locationId: 'l1', status: 'completed', totalAmount: 30000, mode: 'pickup', lines: [] } as unknown as Order

  it('counts only what reached the guest', () => {
    expect(refundLabel({ ...base, paymentStatus: 'refunded', refund: { amount: 30000 } } as Order)).toBe('Återbetald 300 kr')
    expect(refundLabel({ ...base, paymentStatus: 'refunded', refund: { amount: 30000 },
      refundFailed: [{ amount: 10000 }] } as Order)).toBe('Delvis återbetald 200 kr')
    expect(refundLabel({ ...base, paymentStatus: 'refunded', refund: { amount: 30000 },
      refundFailed: [{ amount: 30000 }] } as Order)).toBeNull()
  })
})
