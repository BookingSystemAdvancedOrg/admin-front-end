import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import MarknadsforingPage from './MarknadsforingPage'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant, locationId: 'loc-1' }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../meta-ads/AnnonserTab', () => ({ default: () => <p>Annonsfliken</p> }))

const owner = (features: Record<string, boolean>, role = 'owner_user') => {
  tenant = { role, primaryDomain: null, locations: [], entitlements: { maxLocations: null, features } }
}

describe('MarknadsforingPage feature tabs', () => {
  it('shows a tenant with only metaAds the Annonser tab alone, opened by default', async () => {
    owner({ metaAds: true })
    render(<MemoryRouter><MarknadsforingPage /></MemoryRouter>)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Annonser'])
    expect(screen.getByRole('tab', { name: 'Annonser' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Annonsfliken')).toBeInTheDocument()
  })

  it('keeps the guard for staff and for a plan without any of the four', () => {
    owner({ metaAds: true }, 'staff_user')
    const { unmount } = render(<MemoryRouter><MarknadsforingPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Bara för ägare' })).toBeInTheDocument()
    unmount()
    owner({ giftCards: true })
    render(<MemoryRouter><MarknadsforingPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
  })
})
