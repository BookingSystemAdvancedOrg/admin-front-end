import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Slot } from './slots'

let tenant: Record<string, unknown> | null
vi.mock('./tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../features/meta-ads/AnnonserTab', () => ({ default: () => <p>Annonser från funktionen</p> }))
vi.mock('../features/waitlist/QueuePanel', () => ({
  default: ({ date }: { date: string }) => <p>Kön {date}</p>,
}))

const as = (role: string, features: Record<string, boolean>) => {
  tenant = { role, entitlements: { maxLocations: null, features } }
}

describe('Slot', () => {
  beforeEach(() => as('owner_user', {}))

  it('renders nothing while the feature is off', () => {
    expect(render(<Slot id="marketing.tab.annonser" props={{}} />).container).toBeEmptyDOMElement()
  })

  it('renders nothing without a tenant or with one lacking entitlements', () => {
    tenant = null
    expect(render(<Slot id="marketing.tab.annonser" props={{}} />).container).toBeEmptyDOMElement()
    tenant = { role: 'owner_user' }
    expect(render(<Slot id="marketing.tab.annonser" props={{}} />).container).toBeEmptyDOMElement()
  })

  it('lazy-loads the component when the feature is on', async () => {
    as('owner_user', { metaAds: true })
    render(<Slot id="marketing.tab.annonser" props={{}} />)
    expect(await screen.findByText('Annonser från funktionen')).toBeInTheDocument()
  })

  it('hides an owner-only slot from staff', () => {
    as('staff_user', { metaAds: true })
    expect(render(<Slot id="marketing.tab.annonser" props={{}} />).container).toBeEmptyDOMElement()
  })

  it('shows a staff slot to staff and passes the props', async () => {
    as('staff_user', { waitlist: true })
    render(<Slot id="bokningar.panel.waitlist" props={{ locationId: 'loc-1', date: '2026-11-01' }} />)
    expect(await screen.findByText('Kön 2026-11-01')).toBeInTheDocument()
  })
})
