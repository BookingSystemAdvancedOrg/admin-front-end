import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BokforingCard } from './BokforingCard'
import { ACCOUNT_ROLES } from './accountingApi'

vi.mock('./accountingApi', async (orig) => ({
  ...(await orig<typeof import('./accountingApi')>()),
  saveFile: () => {},
}))

describe('BokforingCard Presentkort group', () => {
  it('has the two gift card roles', () => {
    expect(ACCOUNT_ROLES).toContain('giftCardLiability')
    expect(ACCOUNT_ROLES).toContain('giftCardBreakage')
  })

  it('is hidden without giftCards', async () => {
    render(<BokforingCard locationId="loc-1" />)
    expect(await screen.findByText('Försäljning')).toBeInTheDocument()
    expect(screen.queryByText('Presentkort')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Ej inlösta presentkort/)).not.toBeInTheDocument()
  })

  it('is shown with giftCards, with the BAS defaults', async () => {
    render(<BokforingCard locationId="loc-1" giftCards />)
    expect(await screen.findByText('Presentkort')).toBeInTheDocument()
    expect(screen.getByLabelText(/Ej inlösta presentkort/)).toHaveValue('2421')
    expect(screen.getByLabelText(/Övriga ersättningar och intäkter/)).toHaveValue('3990')
  })
})
