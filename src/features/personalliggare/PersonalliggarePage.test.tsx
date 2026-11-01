import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PersonalliggarePage from './PersonalliggarePage'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))

describe('PersonalliggarePage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<PersonalliggarePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Personalliggare (under granskning)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(screen.queryByText('Den här delen är på väg.')).not.toBeInTheDocument()
  })

  it('shows the placeholder when the feature is on', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { personalliggare: true } } }
    render(<PersonalliggarePage />)
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
  })

  it('is open to staff too', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { personalliggare: true } } }
    render(<PersonalliggarePage />)
    expect(screen.getByText('Den här delen är på väg.')).toBeInTheDocument()
  })
})
