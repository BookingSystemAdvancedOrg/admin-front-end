import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WebbplatsPage from './WebbplatsPage'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))

describe('WebbplatsPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<WebbplatsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Webbplats' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(screen.queryByText('Den här delen är på väg.')).not.toBeInTheDocument()
  })

  it('shows the placeholder when the feature is on', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { siteBuilder: true } } }
    render(<WebbplatsPage />)
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
  })

  it('tells staff it is for the owner', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { siteBuilder: true } } }
    render(<WebbplatsPage />)
    expect(screen.getByRole('heading', { name: 'Bara för ägare' })).toBeInTheDocument()
    expect(screen.queryByText('Den här delen är på väg.')).not.toBeInTheDocument()
  })
})
