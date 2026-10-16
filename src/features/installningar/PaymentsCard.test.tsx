import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentsCard } from './PaymentsCard'
import type { Tenant } from '../../shared/tenant'

function tenant(stripe: Partial<Tenant['stripe']>): Tenant {
  return {
    stripe: {
      connected: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      ...stripe,
    },
  } as Tenant
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PaymentsCard', () => {
  it('polls the status after returning from Stripe until it is ready', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <PaymentsCard tenant={tenant({})} isOwner stripeReturn="return" onRefresh={onRefresh} />,
    )
    expect(screen.getByText('Tillbaka från Stripe. Hämtar den nya statusen…')).toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(3)

    rerender(
      <PaymentsCard
        tenant={tenant({ chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true })}
        isOwner
        stripeReturn="return"
        onRefresh={onRefresh}
      />,
    )
    expect(screen.getByText('Redo att ta emot betalningar')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(30000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(3)
  })

  it('stops after a minute and asks for a reload', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(<PaymentsCard tenant={tenant({})} isOwner stripeReturn="return" onRefresh={onRefresh} />)
    await act(async () => {
      vi.advanceTimersByTime(120000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(21)
    expect(screen.getByText(/Stripe behandlar fortfarande uppgifterna/)).toBeInTheDocument()
  })

  it('does not poll on a normal visit', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(<PaymentsCard tenant={tenant({})} isOwner stripeReturn={null} onRefresh={onRefresh} />)
    await act(async () => {
      vi.advanceTimersByTime(30000)
    })
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByText('Stripe är inte klart')).toBeInTheDocument()
  })
})
