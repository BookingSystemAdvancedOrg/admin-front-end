import { describe, expect, it, vi } from 'vitest'
import * as shared from '../../shared/api'
import { refundTicket, refundTxId } from './api'

vi.mock('../../shared/api', async () => {
  const actual = await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn() }
})
const apiFetch = vi.mocked(shared.apiFetch)

describe('refundTicket', () => {
  it('sends the same txId on every attempt for a ticket (Stripe down, then retry)', async () => {
    apiFetch.mockRejectedValueOnce(new shared.ApiError(502, 'stripe_unavailable'))
    apiFetch.mockResolvedValueOnce({ ticketId: 'T1', status: 'refunded' })
    await expect(refundTicket('loc-1', 'T0123456789ABCDEF0123456789', 'Sjuk')).rejects.toBeInstanceOf(shared.ApiError)
    await refundTicket('loc-1', 'T0123456789ABCDEF0123456789', 'Sjuk')
    const bodies = apiFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { txId: string; reason: string })
    expect(bodies).toHaveLength(2)
    expect(bodies[0].txId).toBe(bodies[1].txId)
    expect(bodies[0]).toEqual({ txId: refundTxId('T0123456789ABCDEF0123456789'), reason: 'Sjuk' })
    expect(apiFetch.mock.calls[0][0]).toBe('/locations/loc-1/events/tickets/T0123456789ABCDEF0123456789/refund')
  })
})
