import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tenant } from '../../shared/tenant'
import { TermsSection } from './TermsSection'
import { TERMS_SECTIONS, TERMS_VERSION } from './termsText'

let current: Tenant | null = null
const replaceTenant = vi.fn()
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant: current, status: 'ready', error: null, locationId: null, refresh: vi.fn() }),
  replaceTenant: (t: Tenant) => replaceTenant(t),
}))
const acceptTerms = vi.fn()
vi.mock('./dpaApi', async (orig) => ({
  ...(await orig<typeof import('./dpaApi')>()),
  acceptTerms: (t: Tenant) => acceptTerms(t),
}))

function tenant(upToDate: boolean, role: Tenant['role'] = 'owner_user'): Tenant {
  return {
    tenantId: 't1', name: 'Roma', slug: 'roma', status: 'active', planId: 'starter',
    entitlements: { maxLocations: 1, features: {} }, locationCount: 1,
    stripe: { connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false },
    primaryDomain: null, senderName: null, replyToEmail: null,
    notifications: { sms: false, staffEmails: true, reminderHours: 24 },
    terms: { currentVersion: TERMS_VERSION, acceptedVersion: upToDate ? TERMS_VERSION : null,
             acceptedAt: upToDate ? '2026-11-14T10:00:00Z' : null, upToDate },
    role, locations: [],
  }
}

beforeEach(() => vi.clearAllMocks())

describe('Allmänna villkor för restauranger', () => {
  it('states payment in advance, the 60 kr fee, 450 kr and interest, with no dashes', () => {
    const text = TERMS_SECTIONS.flatMap((s) => [s.title, ...s.paragraphs]).join(' ')
    expect(text).toMatch(/i förskott den 1:a/)
    expect(text).toMatch(/påminnelseavgift på 60 kronor/)
    expect(text).toMatch(/450 kronor enligt 4 a § lagen \(1981:739\)/)
    expect(text).toMatch(/referensränta plus åtta procentenheter/)
    expect(text).toMatch(/10 dagars betalningstid/)
    expect(text).not.toMatch(/[–—]/)
  })

  it('lets the owner accept the current version', async () => {
    current = tenant(false)
    acceptTerms.mockResolvedValue(tenant(true))
    const user = userEvent.setup()
    render(<TermsSection />)
    const button = screen.getByRole('button', { name: 'Godkänn villkoren' })
    expect(button).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(button)
    expect(acceptTerms).toHaveBeenCalledWith(current)
    expect(replaceTenant).toHaveBeenCalledWith(expect.objectContaining({ terms: expect.objectContaining({ upToDate: true }) }))
  })

  it('shows staff the text only, and an accepted version without the form', () => {
    current = tenant(false, 'staff_user')
    const { unmount } = render(<TermsSection />)
    expect(screen.getByText('Bara restaurangens ägare kan godkänna villkoren.')).toBeInTheDocument()
    unmount()
    current = tenant(true)
    render(<TermsSection />)
    expect(screen.queryByRole('button', { name: 'Godkänn villkoren' })).toBeNull()
    expect(screen.getByText(/godkänd/)).toBeInTheDocument()
  })
})
