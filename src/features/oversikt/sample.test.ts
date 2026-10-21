import { afterEach, describe, expect, it } from 'vitest'
import { SAMPLE_TABLE_LABELS, sampleData, sampleModeOn, setSampleMode } from './sample'
import { activeOrders, bookingsToday, revenueToday, todoQueue } from './overview'
import { tableNames } from '../../shared/tables'
import { SAMPLE_DATA_KEY } from '../../shared/storageRegistry'

describe('sample data for Översikt', () => {
  const data = sampleData('2026-10-21')

  it('is a full day: bookings, guests and a next guest in the morning', () => {
    const b = bookingsToday(data.today, '10:00')
    expect(b?.count).toBe(9)
    expect(b?.guests).toBe(36)
    expect(b?.next?.customerName).toBe('Sara Nyström')
  })

  it('adds up: paid orders make the revenue, three are in progress', () => {
    const revenue = revenueToday(data.orders)
    expect(revenue?.count).toBe(14)
    expect(revenue?.amount).toBe(940500)
    expect(activeOrders(data.orders)).toEqual({ count: 3, fresh: 1, preparing: 1, ready: 1 })
  })

  it('leaves something to handle, most urgent first', () => {
    const todo = todoQueue(data.today, data.catering)
    expect(todo?.total).toBe(4)
    expect(todo?.items.map((i) => i.id)).toEqual(['payments', 'catering', 'unconfirmed'])
  })

  it('names every table it uses', () => {
    for (const r of data.today) {
      expect(tableNames(r.tableIds, SAMPLE_TABLE_LABELS as Map<string, string>)).not.toContain('?')
    }
  })

  it('every id is marked as a sample', () => {
    for (const r of data.today) expect(r.reservationId).toMatch(/^sample-/)
    for (const o of data.orders) expect(o.orderId).toMatch(/^sample-/)
    for (const c of data.catering) expect(c.requestId).toMatch(/^sample-/)
  })

  describe('the choice', () => {
    afterEach(() => localStorage.removeItem(SAMPLE_DATA_KEY))

    it('is off until chosen and remembered once chosen', () => {
      expect(sampleModeOn()).toBe(false)
      setSampleMode(true)
      expect(sampleModeOn()).toBe(true)
      setSampleMode(false)
      expect(sampleModeOn()).toBe(false)
      expect(localStorage.getItem(SAMPLE_DATA_KEY)).toBeNull()
    })
  })
})
