import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RETURN_CHECK_MS, RestaurantSigning } from './RestaurantSigning'
import type { CateringRequest } from './cateringApi'

const restaurantSign = vi.fn()
const restaurantSignStatus = vi.fn()
vi.mock('./cateringApi', async (orig) => ({
  ...(await orig<typeof import('./cateringApi')>()),
  restaurantSign: (...a: unknown[]) => restaurantSign(...a),
  restaurantSignStatus: (...a: unknown[]) => restaurantSignStatus(...a),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: (d: string) => Promise.resolve(`data:qr,${d}`) } }))

const request = { locationId: 'loc-1', requestId: 'req-1', currentOfferVersion: 1 } as CateringRequest

describe('RestaurantSigning back from the signing page', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('checks until the signature is registered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const signed = { ...request, restaurantSignedAt: '2026-10-28T10:00:00Z' }
    restaurantSignStatus.mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce({ state: 'signed', request: signed })
    const onSigned = vi.fn()
    render(<RestaurantSigning request={request} onSigned={onSigned} returned />)
    expect(await screen.findByText(/Kontrollerar signeringen/)).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(RETURN_CHECK_MS) })
    await vi.waitFor(() => expect(onSigned).toHaveBeenCalledWith(signed))
    expect(restaurantSignStatus).toHaveBeenCalledTimes(2)
  })

  it('explains a signing that timed out at the provider', async () => {
    restaurantSignStatus.mockResolvedValue({ state: 'failed', hint: 'timedout' })
    render(<RestaurantSigning request={request} onSigned={vi.fn()} returned />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tiden för att signera har gått ut.')
    expect(screen.getByRole('button', { name: 'Signera med BankID' })).toBeInTheDocument()
  })
})
