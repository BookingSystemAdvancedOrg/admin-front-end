import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '../../features/bestallningar/ordersApi'
import { ORDER_ALERT_KEY } from '../storageRegistry'

const playOrderAlert = vi.fn()
let unlock: (() => void) | null = null
vi.mock('./alertSound', () => ({
  playOrderAlert: () => playOrderAlert(),
  onOrderAudioUnlocked: (l: () => void) => {
    unlock = l
    return () => {
      unlock = null
    }
  },
}))

const {
  acknowledgeOrders,
  feedOrders,
  forgetOrderAlerts,
  pageFedAt,
  getAlertSnapshot,
  onOrderFocus,
  requestOrderFocus,
  resetOrderAlerts,
  setAlertScope,
  takeOrderFocus,
} = await import('./store')

function order(n: number, extra: Partial<Order> = {}): Order {
  return {
    orderId: `order-${n}`, locationId: 'loc-1', number: n, status: 'confirmed', mode: 'pickup',
    lines: [], totalAmount: 10000, confirmedAt: `2026-11-21T17:${String(n).padStart(2, '0')}:00Z`, ...extra,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetOrderAlerts()
  playOrderAlert.mockReset()
  playOrderAlert.mockResolvedValue('played')
  unlock = null
})
afterEach(() => {
  resetOrderAlerts()
})

describe('order alert store', () => {
  it('plays the sound once per batch of new orders, never for the first list', async () => {
    setAlertScope('loc-1')
    feedOrders('loc-1', [order(1)])
    expect(playOrderAlert).not.toHaveBeenCalled()
    expect(getAlertSnapshot().open).toEqual([])
    feedOrders('loc-1', [order(1), order(2), order(3)])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    expect(getAlertSnapshot().open.map((o) => o.number)).toEqual([3, 2])
    expect(getAlertSnapshot().latest).toEqual(['order-3', 'order-2'])
    feedOrders('loc-1', [order(1), order(2), order(3)])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    feedOrders('loc-1', [order(1), order(2), order(3), order(4)])
    expect(playOrderAlert).toHaveBeenCalledTimes(2)
    expect(getAlertSnapshot().open.map((o) => o.number)).toEqual([4, 3, 2])
    await flush()
  })

  it('OK closes the box and the next order opens a fresh one with sound', () => {
    setAlertScope('loc-1')
    feedOrders('loc-1', [])
    feedOrders('loc-1', [order(1)])
    acknowledgeOrders()
    expect(getAlertSnapshot().open).toEqual([])
    feedOrders('loc-1', [order(1)])
    expect(getAlertSnapshot().open).toEqual([])
    feedOrders('loc-1', [order(1), order(2)])
    expect(getAlertSnapshot().open.map((o) => o.number)).toEqual([2])
    expect(playOrderAlert).toHaveBeenCalledTimes(2)
  })

  it('ignores lists for another location (a late answer after a switch) and nothing when alerts are off', () => {
    setAlertScope('loc-1')
    feedOrders('loc-1', [])
    feedOrders('loc-2', [order(1, { locationId: 'loc-2' })])
    feedOrders('loc-1', [order(5)])
    expect(getAlertSnapshot().open.map((o) => o.number)).toEqual([5])
    setAlertScope('loc-2')
    expect(getAlertSnapshot().open).toEqual([])
    setAlertScope(null)
    feedOrders('loc-2', [])
    feedOrders('loc-2', [order(9, { locationId: 'loc-2' })])
    expect(getAlertSnapshot().open).toEqual([])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
  })

  it('shows the tap-for-sound hint while audio is locked and drops it when a tap unlocks it', async () => {
    playOrderAlert.mockResolvedValue('locked')
    setAlertScope('loc-1')
    feedOrders('loc-1', [])
    feedOrders('loc-1', [order(1)])
    await flush()
    expect(getAlertSnapshot().muted).toBe(true)
    unlock?.()
    expect(getAlertSnapshot().muted).toBe(false)
  })

  it('plays the chime that was not heard once audio comes back, while the box is still open', async () => {
    playOrderAlert.mockResolvedValue('locked')
    setAlertScope('loc-1')
    feedOrders('loc-1', [])
    feedOrders('loc-1', [order(1)])
    await flush()
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    playOrderAlert.mockResolvedValue('played')
    unlock?.()
    await flush()
    expect(playOrderAlert).toHaveBeenCalledTimes(2)
    expect(getAlertSnapshot().muted).toBe(false)
  })

  it('does not replay after OK', async () => {
    playOrderAlert.mockResolvedValue('locked')
    setAlertScope('loc-1')
    feedOrders('loc-1', [])
    feedOrders('loc-1', [order(1)])
    await flush()
    acknowledgeOrders()
    unlock?.()
    await flush()
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
  })

  it('keeps the saved time fresh while lists keep coming, so a reload after a quiet spell still alerts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-11-21T14:00:00Z'))
    setAlertScope('loc-1')
    feedOrders('loc-1', [order(1)])
    vi.setSystemTime(Date.parse('2026-11-21T14:20:00Z'))
    feedOrders('loc-1', [order(1)])
    const stored = JSON.parse(sessionStorage.getItem(ORDER_ALERT_KEY) ?? '{}') as { at: number }
    expect(stored.at).toBe(Date.parse('2026-11-21T14:20:00Z'))
    vi.useRealTimers()
  })

  it('starts from scratch after a logout, so the first list after the next login never alerts', () => {
    setAlertScope('loc-1')
    feedOrders('loc-1', [order(1)])
    forgetOrderAlerts()
    expect(sessionStorage.getItem(ORDER_ALERT_KEY)).toBeNull()
    setAlertScope('loc-1')
    feedOrders('loc-1', [order(1), order(2), order(3)])
    expect(getAlertSnapshot().open).toEqual([])
    expect(playOrderAlert).not.toHaveBeenCalled()
  })

  it('no hint when the sound is off on this device', async () => {
    playOrderAlert.mockResolvedValue('off')
    setAlertScope('loc-1')
    feedOrders('loc-1', [])
    feedOrders('loc-1', [order(1)])
    await flush()
    expect(getAlertSnapshot().muted).toBe(false)
    expect(getAlertSnapshot().open).toHaveLength(1)
  })

  it('saves ids (never names) in the tab and remembers when a page fed the list', () => {
    setAlertScope('loc-1')
    feedOrders('loc-1', [order(1, { customerName: 'Åsa Öberg' })], 'other')
    const raw = sessionStorage.getItem(ORDER_ALERT_KEY) ?? ''
    expect(raw).toContain('order-1')
    expect(raw).not.toContain('Åsa')
    // Skalets egna hämtningar räknas inte: bara en sida som matar får skalet att vänta.
    expect(pageFedAt('loc-1')).toBe(0)
    feedOrders('loc-1', [order(1)])
    expect(Date.now() - pageFedAt('loc-1')).toBeLessThan(1000)
    expect(pageFedAt('loc-2')).toBe(0)
  })

  it('hands the tapped order to Beställningar, now or when the page mounts', () => {
    const seen: string[] = []
    const off = onOrderFocus((id) => seen.push(id))
    requestOrderFocus('order-1')
    expect(seen).toEqual(['order-1'])
    expect(takeOrderFocus()).toBeNull()
    off()
    requestOrderFocus('order-2')
    expect(takeOrderFocus()).toBe('order-2')
    expect(takeOrderFocus()).toBeNull()
  })

  it('forgets a focus request nobody took (a navigation that was cancelled)', () => {
    vi.useFakeTimers()
    requestOrderFocus('order-3')
    vi.advanceTimersByTime(6000)
    expect(takeOrderFocus()).toBeNull()
    vi.useRealTimers()
  })
})
