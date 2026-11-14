import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanCard, planLabel, svDate } from './PlanCard'

describe('PlanCard', () => {
  it('shows a limited free period with its last day', () => {
    render(<PlanCard tenant={{ planId: 'free', free: { until: '2027-02-14' } }} />)
    expect(screen.getByText('Gratis till 14 februari 2027')).toBeInTheDocument()
    expect(screen.getByText('Inget att betala. SMS ingår.')).toBeInTheDocument()
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
    expect(screen.getByText('Fast pris per månad. SMS ingår.')).toBeInTheDocument()
  })

  it('writes Swedish dates without a time zone shift', () => {
    expect(svDate('2027-01-01')).toBe('1 januari 2027')
    expect(svDate('2026-12-31T23:00:00Z')).toBe('31 december 2026')
  })
})
