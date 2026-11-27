import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let tenant: Record<string, unknown> = {}
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant, locationId: 'loc-1', status: 'ready' }),
}))

const { AppearanceCard } = await import('./AppearanceCard')

const features = (f: Record<string, boolean>, extra: Record<string, unknown> = {}) => ({
  role: 'owner_user', entitlements: { features: f }, ...extra,
})

describe('AppearanceCard alert sound row', () => {
  beforeEach(() => {
    tenant = features({})
  })

  it('is hidden without ordering and catering', () => {
    render(<AppearanceCard />)
    expect(screen.queryByText('Larmljud')).toBeNull()
  })

  it('shows for ordering, for catering only, and not for staff without either area', () => {
    tenant = features({ ordering: true })
    const a = render(<AppearanceCard />)
    expect(screen.getByText('Larmljud')).toBeInTheDocument()
    a.unmount()
    tenant = features({ catering: true })
    const b = render(<AppearanceCard />)
    expect(screen.getByRole('button', { name: /^Ljud på, larmljud/ })).toBeInTheDocument()
    b.unmount()
    tenant = features({ ordering: true, catering: true }, { role: 'staff_user', access: { areas: ['bokningar'] } })
    render(<AppearanceCard />)
    expect(screen.queryByText('Larmljud')).toBeNull()
  })
})
