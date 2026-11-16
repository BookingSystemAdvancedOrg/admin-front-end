import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GasterPage from './GasterPage'
import GuestBadge from './GuestBadge'
import * as api from './api'
import { chooseOption } from '../../test/select'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  listGuests: vi.fn(),
  searchGuests: vi.fn(),
  getGuest: vi.fn(),
  updateGuest: vi.fn(),
  lookupGuests: vi.fn(),
  rebuildGuests: vi.fn(),
}))

const anna = { guestId: 'g1', name: 'Anna Andersson', lastSeenAt: '2026-10-01T18:00:00Z', visits: 3, returning: true }
const detail = {
  ...anna, firstSeenAt: '2026-01-01T18:00:00Z', noShows: 1, orders: 2, cateringRequests: 0, locations: ['loc-1'],
  tags: ['stamgäst'], note: null, birthday: null, segmentsExcluded: false, version: 4,
  spendSek: { bookingFees: 0, orders: 500, catering: 0 },
  history: [{ kind: 'booking', sourceId: 'r1', locationId: 'loc-1', date: '2026-10-01', status: 'arrived', at: null, partySize: 2, amountOre: 0 }],
  contact: { email: 'anna@example.se' }, consent: { email: 'granted', sms: 'none' },
}

beforeEach(() => {
  vi.mocked(api.listGuests).mockResolvedValue({ guests: [anna], cursor: null })
  vi.mocked(api.getGuest).mockResolvedValue(detail as unknown as api.GuestDetail)
})

describe('GasterPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} }, locations: [] }
    render(<GasterPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Gäster' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(api.listGuests).not.toHaveBeenCalled()
  })

  it('lists guests newest first with new/returning and opens the profile with history and consent', async () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { guestCrm: true } }, locations: [{ locationId: 'loc-1', name: 'Bistro' }] }
    render(<GasterPage />)
    const row = await screen.findByRole('button', { name: 'Anna Andersson' })
    expect(within(row.closest('tr')!).getByText('Återkommande')).toBeInTheDocument()
    fireEvent.click(row)
    expect(await screen.findByText('anna@example.se')).toBeInTheDocument()
    expect(screen.getByText('Ja')).toBeInTheDocument()
    expect(screen.getByText('500 kr')).toBeInTheDocument()
    const facts = screen.getByText('anna@example.se').closest('dl')!
    expect(facts).toHaveClass('gaster-facts')  // the profile facts, not the booking list's one-line meta
    expect(facts).not.toHaveClass('booking-meta')
    // the history table scrolls on its own at phone width (the shared table-scroll pattern)
    expect(screen.getByRole('columnheader', { name: 'Vad' }).closest('table')!.parentElement).toHaveClass('table-scroll')
    expect(screen.getByRole('button', { name: 'Spara' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bygg gästregistret' })).toBeInTheDocument()
  })

  it('is open to staff without edit or rebuild', async () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { guestCrm: true } }, locations: [] }
    vi.mocked(api.getGuest).mockResolvedValue({ ...detail, spendSek: undefined } as unknown as api.GuestDetail)
    render(<GasterPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Anna Andersson' }))
    await screen.findByText('Historik')
    expect(screen.queryByRole('button', { name: 'Spara' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bygg gästregistret' })).not.toBeInTheDocument()
    expect(screen.queryByText('Handlat för')).not.toBeInTheDocument()
  })

  it('searches by email in the body', async () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: { guestCrm: true } }, locations: [] }
    vi.mocked(api.searchGuests).mockResolvedValue({ guests: [] })
    render(<GasterPage />)
    await screen.findByRole('button', { name: 'Anna Andersson' })
    chooseOption(screen.getByLabelText('Sök på'), 'email')
    fireEvent.change(screen.getByLabelText('E-postadress'), { target: { value: 'b@x.se' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sök' }))
    await waitFor(() => expect(api.searchGuests).toHaveBeenCalledWith({ email: 'b@x.se' }))
  })
})

describe('GuestBadge', () => {
  it('batches every badge of a list into one lookup', async () => {
    vi.mocked(api.lookupGuests).mockResolvedValue({ results: { r1: { status: 'returning', visits: 4 }, r2: { status: 'new', visits: 0 } } })
    render(<><GuestBadge locationId="loc-1" reservationId="r1" email="a@x.se" /><GuestBadge locationId="loc-1" reservationId="r2" phone="+46701" /></>)
    expect(await screen.findByText('Återkommande (4)')).toBeInTheDocument()
    expect(screen.getByText('Ny gäst')).toBeInTheDocument()
    expect(api.lookupGuests).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.lookupGuests).mock.calls[0][1]).toEqual([{ key: 'r1', email: 'a@x.se' }, { key: 'r2', phone: '+46701' }])
  })

  it('shows nothing without contact or when the lookup fails', async () => {
    vi.mocked(api.lookupGuests).mockRejectedValue(new Error('x'))
    const { container } = render(<><GuestBadge locationId="loc-2" reservationId="r9" /><GuestBadge locationId="loc-2" reservationId="r8" email="a@x.se" /></>)
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('segment rules', () => {
  it('turns the form into only the rules that are filled in', () => {
    expect(api.rulesFrom({ segmentId: 's', name: 'x', lapsedDays: '90', birthdayWithinDays: '', minSpendSek: '2000', minVisits: '', locationId: '', optedIn: true }))
      .toEqual({ lapsedDays: 90, minSpendSek: 2000, optedIn: true })
    expect(api.describeRules({ lapsedDays: 90, optedIn: true })).toBe('Inte varit här på 90 dagar, vill ha erbjudanden')
  })
})
