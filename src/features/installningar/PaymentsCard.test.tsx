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
    expect(screen.getByText(/Stripe behandlar uppgifterna/)).toBeInTheDocument()
  })

  it('lists the payment methods with their status when Stripe is ready', () => {
    const ready = { chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true }
    render(
      <PaymentsCard
        tenant={tenant({ ...ready, paymentMethods: { card: 'active', swish: 'pending', klarna: 'unrequested' } })}
        isOwner
        stripeReturn={null}
        onRefresh={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual([
      'KortAktiv', 'Apple PayAktiv', 'Google PayAktiv', 'SwishGranskas', 'KlarnaInte aktiveradAktivera i Stripe',
    ])
    const link = screen.getByRole('link', { name: 'Aktivera i Stripe' })
    expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/settings/payment_methods')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
    expect(screen.getByRole('button', { name: 'Förklaring: Betalsätt' })).toBeInTheDocument()
  })

  it('treats a missing method as not activated and shows staff no Stripe link', () => {
    render(
      <PaymentsCard
        tenant={tenant({ chargesEnabled: true, detailsSubmitted: true, paymentMethods: { card: 'active', swish: 'inactive' } })}
        isOwner={false}
        stripeReturn={null}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText('Swish').nextElementSibling).toHaveTextContent('Inte aktiverad')
    expect(screen.getByText('Klarna').nextElementSibling).toHaveTextContent('Inte aktiverad')
    expect(screen.queryByRole('link', { name: 'Aktivera i Stripe' })).toBeNull()
  })

  it('shows no method list without paymentMethods (older backend) or before Stripe is ready', () => {
    const { unmount } = render(
      <PaymentsCard tenant={tenant({ chargesEnabled: true, detailsSubmitted: true })} isOwner stripeReturn={null}
        onRefresh={vi.fn()} />,
    )
    expect(screen.getByText('Redo att ta emot betalningar')).toBeInTheDocument()
    expect(screen.queryByText('Betalsätt')).toBeNull()
    unmount()
    render(
      <PaymentsCard tenant={tenant({ detailsSubmitted: true, paymentMethods: { card: 'pending' } })} isOwner
        stripeReturn={null} onRefresh={vi.fn()} />,
    )
    expect(screen.queryByText('Betalsätt')).toBeNull()
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
