import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BokforingCard } from './BokforingCard'

vi.mock('./accountingApi', async (orig) => ({
  ...(await orig<typeof import('./accountingApi')>()),
  saveFile: () => {},
}))

// Kort i kassan dras på restaurangens egen terminal och bokas på ett eget konto, inte Stripe-avräkningen.
describe('BokforingCard Kassa group', () => {
  it('is hidden without kassa', async () => {
    render(<BokforingCard locationId="loc-1" />)
    expect(await screen.findByText('Försäljning')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Kort i kassan/)).not.toBeInTheDocument()
  })

  it('is shown with kassa, 1580 by default', async () => {
    render(<BokforingCard locationId="loc-1" kassa />)
    expect(await screen.findByText('Kassa')).toBeInTheDocument()
    expect(screen.getByLabelText(/Kort i kassan \(egen kortterminal\)/)).toHaveValue('1580')
  })
})
