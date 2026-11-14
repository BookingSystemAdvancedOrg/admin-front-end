import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantBilling } from '../../shared/tenant'
import { PlanCard, planLabel, svDate, svKr } from './PlanCard'

const api = vi.hoisted(() => ({ getBooqyBilling: vi.fn(), createCardSession: vi.fn() }))
vi.mock('./billingApi', () => api)

const noCard: TenantBilling = {
  customer: true, hasCard: false, cardBrand: null, cardLast4: null,
  collection: 'invoice', preference: 'card', daysUntilDue: 10, pastDue: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getBooqyBilling.mockResolvedValue({ billing: noCard, invoices: [] })
})

describe('PlanCard', () => {
  it('shows a limited free period with its last day', () => {
    render(<PlanCard tenant={{ planId: 'free', free: { until: '2027-02-14' } }} />)
    expect(screen.getByText('Gratis till 14 februari 2027')).toBeInTheDocument()
    expect(screen.getByText('Gratis · SMS ingår')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows Gratis without an end date, and paid plans by name', () => {
    expect(planLabel({ planId: 'free', free: { until: null } })).toBe('Gratis')
    expect(planLabel({ planId: 'free' })).toBe('Gratis')
    expect(planLabel({ planId: 'starter' })).toBe('Starter')
    expect(planLabel({ planId: 'growth', free: null })).toBe('Growth')
    expect(planLabel({ planId: null })).toBe('Inget abonnemang')
    render(<PlanCard tenant={{ planId: 'growth' }} />)
    expect(screen.getByText(/SMS ingår/)).toBeInTheDocument()
  })

  it('writes Swedish dates and amounts without a time zone shift', () => {
    expect(svDate('2027-01-01')).toBe('1 januari 2027')
    expect(svDate('2026-12-31T23:00:00Z')).toBe('31 december 2026')
    expect(svKr(1237.5)).toMatch(/^1\s237,50 kr$/)
    expect(svKr(990)).toMatch(/^990 kr$/)
  })

  it('asks the owner to add a card and opens Stripe', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, search: '' })
    api.createCardSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/cs_1' })
    const user = userEvent.setup()
    render(<PlanCard tenant={{ planId: 'starter', role: 'owner_user', billing: noCard }} />)
    expect(screen.getByText(/Lägg till kort så dras månadsavgiften automatiskt. Utan kort skickas fakturan med 10 dagars betalningstid./))
      .toBeInTheDocument()
    expect(screen.getByText('Inget kort sparat')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lägg till kort' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/cs_1'))
    expect(await screen.findByText('Inga obetalda fakturor.')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows the card that is charged and the overdue invoice with its payment link', async () => {
    api.getBooqyBilling.mockResolvedValue({
      billing: noCard,
      invoices: [{ number: 'F-0007', amountDueSek: 1237.5, dueDate: '2026-11-10', overdue: true, collection: 'card',
                   url: 'https://invoice.stripe.com/i/7', description: null }],
    })
    render(<PlanCard tenant={{ planId: 'starter', role: 'owner_user', billing: {
      ...noCard, hasCard: true, cardBrand: 'visa', cardLast4: '4242', collection: 'card', daysUntilDue: null } }} />)
    expect(screen.getByText('Dras automatiskt från kortet (VISA som slutar på 4242)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Byt kort' })).toBeInTheDocument()
    expect(screen.queryByText(/Lägg till kort så dras/)).toBeNull()
    expect(await screen.findByText('Försenad')).toBeInTheDocument()
    expect(screen.getByText(/Faktura F-0007 · förföll 10 november 2026/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Betala' })).toHaveAttribute('href', 'https://invoice.stripe.com/i/7')
  })

  it('tells the owner to contact Booqy before the agreement exists, and staff see the plan only', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('../../shared/api')
    api.createCardSession.mockRejectedValue(new ApiError(409, 'no_billing_customer', { code: 'no_billing_customer' }))
    const { unmount } = render(<PlanCard tenant={{ planId: 'starter', role: 'owner_user', billing: noCard }} />)
    await user.click(screen.getByRole('button', { name: 'Lägg till kort' }))
    expect(await screen.findByText(/Booqy har inte startat ert avtal än/)).toBeInTheDocument()
    unmount()
    render(<PlanCard tenant={{ planId: 'starter', role: 'staff_user', billing: null }} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
