import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EvenemangPage from './EvenemangPage'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))

describe('EvenemangPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<EvenemangPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Evenemang' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(screen.queryByText('Den här delen är på väg.')).not.toBeInTheDocument()
  })

  it('shows the placeholder when the feature is on', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { events: true } } }
    render(<EvenemangPage />)
    expect(screen.getByRole('heading', { level: 2, name: 'Evenemang' })).toBeInTheDocument()
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
  })

  it('shows the placeholder to staff too (not owner-only)', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { events: true } } }
    render(<EvenemangPage />)
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
    expect(screen.queryByText('Bara för ägare')).not.toBeInTheDocument()
  })
})
