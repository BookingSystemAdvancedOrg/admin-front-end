import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '../../features/bestallningar/ordersApi'
import type { RequestSummary } from '../../features/catering/cateringApi'
import { CATERING_ALERT_KEY, ORDER_ALERT_KEY } from '../storageRegistry'

const playOrderAlert = vi.fn()
vi.mock('./alertSound', () => ({
  playOrderAlert: () => playOrderAlert(),
  onOrderAudioUnlocked: () => () => {},
}))

const {
  acknowledgeKind, acknowledgeOrders, feedCatering, feedOrders, forgetOrderAlerts, getAlertSnapshot, pageFedCateringAt, resetOrderAlerts,
  setAlertScope, setCateringScope,
} = await import('./store')

const req = (n: number, extra: Partial<RequestSummary> = {}): RequestSummary => ({
  requestId: `req-${n}`, status: 'requested', customerType: 'private', customerName: `Gäst ${n}`, deliveryDate: '2026-12-12',
  deliveryTime: '17:00', fulfilment: 'delivery', createdAt: `2026-11-21T10:${String(n).padStart(2, '0')}:00Z`, ...extra,
})
const order = (n: number): Order => ({
  orderId: `order-${n}`, locationId: 'loc-1', number: n, status: 'confirmed', mode: 'pickup', lines: [], totalAmount: 10000,
  confirmedAt: `2026-11-21T10:${String(n).padStart(2, '0')}:30Z`,
})

beforeEach(() => {
  localStorage.clear()
  resetOrderAlerts()
  playOrderAlert.mockReset()
  playOrderAlert.mockResolvedValue('played')
})
afterEach(() => resetOrderAlerts())

describe('catering alert store', () => {
  it('baseline first, then one sound and one box row per new request, once per id', () => {
    setCateringScope('loc-1')
    feedCatering('loc-1', [req(1)])
    expect(playOrderAlert).not.toHaveBeenCalled()
    feedCatering('loc-1', [req(1), req(2)])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    expect(getAlertSnapshot().requests.map((r) => r.requestId)).toEqual(['req-2'])
    expect(getAlertSnapshot().latest).toEqual(['req-2'])
    // Samma lista från sidan och skalet, överlappande hämtningar: inget nytt.
    feedCatering('loc-1', [req(1), req(2)], 'other')
    feedCatering('loc-1', [req(2), req(1)], 'page')
    feedCatering('loc-1', [req(1)], 'other')
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    expect(getAlertSnapshot().requests).toHaveLength(1)
  })

  it('a page feed is remembered so the shell backs off', () => {
    expect(pageFedCateringAt('loc-1')).toBe(0)
    feedCatering('loc-1', [], 'page')
    expect(pageFedCateringAt('loc-1')).toBeGreaterThan(0)
    feedCatering('loc-1', [], 'other')
  })

  it('is silent for the request already answered when the tab first sees it', () => {
    feedCatering('loc-1', [req(1)])
    feedCatering('loc-1', [req(1), req(2, { reviewedAt: 'x' }), req(3, { status: 'offer_sent' })])
    expect(playOrderAlert).not.toHaveBeenCalled()
    expect(getAlertSnapshot().requests).toEqual([])
  })

  it('catering and orders have their own scope and baseline', () => {
    setAlertScope('loc-1')
    setCateringScope(null)
    feedCatering('loc-1', [req(1)])
    feedCatering('loc-1', [req(1), req(2)])
    expect(playOrderAlert).not.toHaveBeenCalled()
    expect(getAlertSnapshot().requests).toEqual([])
    feedOrders('loc-1', [order(1)])
    feedOrders('loc-1', [order(1), order(2)])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    // Larmet slås på för Catering mitt i sessionen: första listan är facit, inte larm för allt gammalt.
    setCateringScope('loc-1')
    feedCatering('loc-1', [req(1), req(2), req(3)])
    expect(getAlertSnapshot().requests.map((r) => r.requestId)).toEqual([])
  })

  it('closes catering rows when the permission goes away, orders stay', () => {
    setAlertScope('loc-1')
    setCateringScope('loc-1')
    feedOrders('loc-1', [])
    feedCatering('loc-1', [])
    feedOrders('loc-1', [order(1)])
    feedCatering('loc-1', [req(1)])
    setCateringScope(null)
    expect(getAlertSnapshot().requests).toEqual([])
    expect(getAlertSnapshot().open).toHaveLength(1)
  })

  it('an order and a request in the same moment share one sound and one marking', () => {
    feedOrders('loc-1', [])
    feedCatering('loc-1', [])
    feedOrders('loc-1', [order(1)])
    feedCatering('loc-1', [req(1)])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    expect(new Set(getAlertSnapshot().latest)).toEqual(new Set(['order-1', 'req-1']))
    expect(getAlertSnapshot().open).toHaveLength(1)
    expect(getAlertSnapshot().requests).toHaveLength(1)
  })

  it('arrivals in different moments each play', async () => {
    feedOrders('loc-1', [])
    feedCatering('loc-1', [])
    feedOrders('loc-1', [order(1)])
    await new Promise((r) => setTimeout(r, 0))
    feedCatering('loc-1', [req(1)])
    expect(playOrderAlert).toHaveBeenCalledTimes(2)
  })

  it('OK closes both kinds; the next new request opens a fresh box', () => {
    feedOrders('loc-1', [])
    feedCatering('loc-1', [])
    feedOrders('loc-1', [order(1)])
    feedCatering('loc-1', [req(1)])
    acknowledgeOrders()
    expect(getAlertSnapshot().open).toEqual([])
    expect(getAlertSnapshot().requests).toEqual([])
    feedCatering('loc-1', [req(1)])
    expect(getAlertSnapshot().requests).toEqual([])
    feedCatering('loc-1', [req(1), req(2)])
    expect(getAlertSnapshot().requests.map((r) => r.requestId)).toEqual(['req-2'])
  })

  it('persists ids only in the tab (no names) and logout forgets them', () => {
    feedCatering('loc-1', [req(1)])
    feedCatering('loc-1', [req(1), req(2)])
    const raw = sessionStorage.getItem(CATERING_ALERT_KEY) ?? ''
    expect(raw).toContain('req-2')
    expect(raw).not.toContain('Gäst')
    expect(sessionStorage.getItem(ORDER_ALERT_KEY)).toBeNull()
    forgetOrderAlerts()
    expect(sessionStorage.getItem(CATERING_ALERT_KEY)).toBeNull()
    expect(getAlertSnapshot().requests).toEqual([])
  })
})

describe('per kind acknowledge and tabs', () => {
  function mixed() {
    feedOrders('loc-1', [])
    feedCatering('loc-1', [])
    feedOrders('loc-1', [order(1)])
    feedCatering('loc-1', [req(1)])
  }

  it('acknowledging one kind keeps the other in the box', () => {
    mixed()
    acknowledgeKind('catering')
    expect(getAlertSnapshot().requests).toEqual([])
    expect(getAlertSnapshot().open).toHaveLength(1)
    expect(getAlertSnapshot().latest).toEqual(['order-1'])
    acknowledgeKind('orders')
    expect(getAlertSnapshot().open).toEqual([])
    expect(getAlertSnapshot().latest).toEqual([])
  })

  it('the cleared kind stays seen after a reload', () => {
    mixed()
    acknowledgeKind('orders')
    expect(JSON.parse(sessionStorage.getItem(CATERING_ALERT_KEY) ?? '{}').open).toEqual(['req-1'])
    expect(JSON.parse(sessionStorage.getItem(ORDER_ALERT_KEY) ?? '{}').open).toEqual([])
  })

  it('a request another tab claimed is seen here but silent', () => {
    feedCatering('loc-1', [])
    localStorage.setItem('booqy-catering-pinged:loc-1', JSON.stringify([{ id: 'req-1', at: Date.now() }]))
    feedCatering('loc-1', [req(1)])
    expect(playOrderAlert).not.toHaveBeenCalled()
    expect(getAlertSnapshot().requests).toEqual([])
    feedCatering('loc-1', [req(1)])
    expect(getAlertSnapshot().requests).toEqual([])
  })

  it('a new request is claimed for other tabs', () => {
    feedCatering('loc-1', [])
    feedCatering('loc-1', [req(1)])
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('booqy-catering-pinged:loc-1')).toContain('req-1')
  })
})
