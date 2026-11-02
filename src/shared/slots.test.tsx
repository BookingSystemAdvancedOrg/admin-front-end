import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Slot } from './slots'
import type { SlotProps } from './slots'

let tenant: Record<string, unknown> | null
vi.mock('./tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../features/meta-ads/AnnonserTab', () => ({ default: () => <p>Annonser från funktionen</p> }))
vi.mock('../features/phone-agent/CallbacksPanel', () => ({
  default: ({ date }: { date: string }) => <p>Återuppringningar {date}</p>,
}))
vi.mock('../features/phone-agent/CallBadge', () => ({
  default: ({ reservationId }: { reservationId: string }) => <p>Samtal {reservationId}</p>,
}))
vi.mock('../features/events-tickets/EventsStats', () => ({
  default: ({ from }: { from: string }) => <p>Biljetter från {from}</p>,
}))
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

  describe('addendum slots (phoneAgent, events)', () => {
    const insights = {} as SlotProps['statistik.events']['insights']
    const all = () => (
      <>
        <Slot id="bokningar.panel.callbacks" props={{ locationId: 'loc-1', date: '2026-11-01' }} />
        <Slot id="bokningar.reservation.call" props={{ locationId: 'loc-1', reservationId: 'r-1' }} />
        <Slot id="statistik.events" props={{ insights, locationId: 'loc-1', from: '2026-10-01', to: '2026-10-31' }} />
      </>
    )

    it('render nothing while the features are off', () => {
      as('owner_user', { waitlist: true, guestCrm: true, dishMargin: true })
      expect(render(all()).container).toBeEmptyDOMElement()
    })

    it('render for staff when on, with the host props', async () => {
      as('staff_user', { phoneAgent: true, events: true })
      render(all())
      expect(await screen.findByText('Återuppringningar 2026-11-01')).toBeInTheDocument()
      expect(await screen.findByText('Samtal r-1')).toBeInTheDocument()
      expect(await screen.findByText('Biljetter från 2026-10-01')).toBeInTheDocument()
    })

    it('follow their own feature only', async () => {
      as('owner_user', { events: true })
      render(all())
      expect(await screen.findByText('Biljetter från 2026-10-01')).toBeInTheDocument()
      expect(screen.queryByText('Samtal r-1')).not.toBeInTheDocument()
      expect(screen.queryByText('Återuppringningar 2026-11-01')).not.toBeInTheDocument()
    })
  })
})
