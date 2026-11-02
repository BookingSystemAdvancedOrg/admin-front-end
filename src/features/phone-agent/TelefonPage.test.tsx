import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TelefonPage from './TelefonPage'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))

describe('TelefonPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<TelefonPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Telefon' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(screen.queryByText('Den här delen är på väg.')).not.toBeInTheDocument()
  })

  it('shows the placeholder when the feature is on', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { phoneAgent: true } } }
    render(<TelefonPage />)
    expect(screen.getByRole('heading', { level: 2, name: 'Telefon' })).toBeInTheDocument()
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
  })

  it('shows the placeholder to staff too (not owner-only)', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { phoneAgent: true } } }
    render(<TelefonPage />)
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
    expect(screen.queryByText('Bara för ägare')).not.toBeInTheDocument()
  })
})
