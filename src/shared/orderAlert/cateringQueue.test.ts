import { describe, expect, it } from 'vitest'
import type { RequestSummary } from '../../features/catering/cateringApi'
import { CATERING_KIND, EMPTY_ALERT, fromStored, observeKind, toStored } from './queue'
import type { AlertState } from './queue'

function req(n: number, extra: Partial<RequestSummary> = {}): RequestSummary {
  return {
    requestId: `req-${n}`, status: 'requested', customerType: 'private', customerName: `Gäst ${n}`, deliveryDate: '2026-12-12',
    deliveryTime: '17:00', fulfilment: 'delivery', createdAt: `2026-11-21T10:${String(n).padStart(2, '0')}:00Z`, ...extra,
  }
}

function run(lists: RequestSummary[][], from: AlertState<RequestSummary> = EMPTY_ALERT) {
  let state = from
  const added: string[][] = []
  for (const l of lists) {
    const r = observeKind(CATERING_KIND, state, 'loc-1', l)
    state = r.state
    added.push(r.added.map((x) => x.requestId))
  }
  return { state, added }
}

describe('catering queue', () => {
  it('the first list is the baseline and never alerts', () => {
    const { state, added } = run([[req(1), req(2)]])
    expect(added).toEqual([[]])
    expect(state.open).toEqual([])
    expect(state.seen).toEqual(['req-1', 'req-2'])
  })

  it('alerts once for a new guest request, newest first, never twice', () => {
    const { state, added } = run([[req(1)], [req(1), req(2), req(3)], [req(1), req(2), req(3)], [req(3), req(1), req(2)]])
    expect(added).toEqual([[], ['req-3', 'req-2'], [], []])
    expect(state.open.map((r) => r.requestId)).toEqual(['req-3', 'req-2'])
  })

  it('does not alert for requests already reviewed or answered when first seen', () => {
    const { added } = run([
      [req(1)],
      [req(1), req(2, { reviewedAt: '2026-11-21T11:00:00Z' }), req(3, { status: 'offer_sent' }), req(4, { status: 'declined' }), req(5, { status: 'change_requested' })],
    ])
    expect(added[1]).toEqual([])
  })

  it('an edit or answer on a request already seen never alerts again', () => {
    const { added } = run([[req(1)], [req(1, { reviewedAt: 'x' })], [req(1, { status: 'change_requested' })], [req(1, { status: 'requested' })]])
    expect(added).toEqual([[], [], [], []])
  })

  it('a location change starts over with a new baseline', () => {
    const first = observeKind(CATERING_KIND, EMPTY_ALERT, 'loc-1', [req(1)])
    const second = observeKind(CATERING_KIND, first.state, 'loc-2', [req(2)])
    expect(second.added).toEqual([])
    expect(second.state.seen).toEqual(['req-2'])
  })

  it('survives a reload: restored without alerting again, seen ids kept', () => {
    const { state } = run([[req(1)], [req(1), req(2)]])
    const now = Date.now()
    const raw = toStored(state, now, CATERING_KIND.id)
    const back = fromStored<RequestSummary>(raw, now + 1000)
    const again = observeKind(CATERING_KIND, back, 'loc-1', [req(1), req(2), req(3)])
    expect(again.added.map((r) => r.requestId)).toEqual(['req-3'])
    expect(again.state.open.map((r) => r.requestId)).toEqual(['req-3', 'req-2'])
    const stale = observeKind(CATERING_KIND, back, 'loc-1', [req(1), req(2)])
    expect(stale.added).toEqual([])
  })
})
