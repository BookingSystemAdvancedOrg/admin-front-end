import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'))
  vi.resetModules()
})
afterEach(() => vi.useRealTimers())

describe('catering mock requests (no API)', () => {
  it('a new guest request arrives a while after the first list, and opens', async () => {
    const api = await import('./cateringApi')
    const first = await api.listRequests('loc-1')
    expect(first.map((r) => r.requestId)).toEqual(['mock-req-1'])
    vi.advanceTimersByTime(api.MOCK_REQUEST_ARRIVES_MS + 1000)
    const later = await api.listRequests('loc-1')
    expect(later.map((r) => r.status)).toEqual(['requested', 'offer_sent'])
    expect((await api.listRequests('loc-1', 'requested')).map((r) => r.requestId)).toEqual(['mock-req-2'])
    expect((await api.getRequest('loc-1', 'mock-req-2')).customerName).toBe('Maria Lind')
    await expect(api.getRequest('loc-1', 'nope')).rejects.toThrow()
  })
})
