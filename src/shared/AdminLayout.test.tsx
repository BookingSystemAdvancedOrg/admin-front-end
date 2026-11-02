import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminLayout } from './AdminLayout'

let tenant: Record<string, unknown>
vi.mock('../features/auth/useAuth', () => ({
  useAuth: () => ({ email: 'a@example.se', sub: 'u1', groups: [], logout: () => {} }),
}))
vi.mock('./tenant', async (orig) => ({
  ...(await orig<typeof import('./tenant')>()),
  useTenant: () => ({ tenant, status: 'ready', error: null, locationId: null, refresh: async () => null }),
}))
vi.mock('../features/dpa/DpaBanner', () => ({ DpaBanner: () => null }))

function owner(features: Record<string, boolean>, role = 'owner_user') {
  tenant = { tenantId: 't1', name: 'Roma', role, locations: [], entitlements: { maxLocations: null, features } }
}

function navLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Huvudmeny' })
  return within(nav).getAllByRole('link').map((a) => a.textContent ?? '')
}

function renderLayout() {
  render(
    <MemoryRouter>
      <AdminLayout />
    </MemoryRouter>,
  )
}

const NEW = ['Personalliggare', 'Gäster', 'Presentkort', 'Webbplats']

describe('AdminLayout sidebar', () => {
  beforeEach(() => owner({}))

  it('hides the new items and Marknadsföring while their features are off', () => {
    renderLayout()
    const labels = navLabels()
    for (const l of [...NEW, 'Marknadsföring']) expect(labels).not.toContain(l)
    expect(labels).toEqual(['Översikt', 'Statistik', 'Bokningar', 'Meny', 'Layout', 'Inställningar'])
  })

  it('shows the new items in contract order when on', () => {
    owner({ catering: true, personalliggare: true, guestCrm: true, giftCards: true, siteBuilder: true, marketing: true })
    renderLayout()
    expect(navLabels()).toEqual([
      'Översikt', 'Statistik', 'Bokningar', 'Catering', 'Personalliggare',
      'Meny', 'Layout', 'Gäster', 'Presentkort', 'Webbplats', 'Marknadsföring', 'Inställningar',
    ])
  })

  it('shows Marknadsföring when any one of its four features is on', () => {
    owner({ googleBusiness: true })
    renderLayout()
    expect(navLabels()).toContain('Marknadsföring')
  })

  it('hides owner-only items from staff', () => {
    owner({ personalliggare: true, guestCrm: true, giftCards: true, siteBuilder: true, metaAds: true }, 'staff_user')
    renderLayout()
    const labels = navLabels()
    expect(labels).toContain('Personalliggare')
    expect(labels).toContain('Gäster')
    for (const l of ['Presentkort', 'Webbplats', 'Marknadsföring']) expect(labels).not.toContain(l)
  })

  it('hides Telefon and Evenemang while phoneAgent and events are off', () => {
    owner({ personalliggare: true, siteBuilder: true })
    renderLayout()
    const labels = navLabels()
    expect(labels).not.toContain('Telefon')
    expect(labels).not.toContain('Evenemang')
  })

  it('shows Telefon after Personalliggare and Evenemang after Webbplats when on', () => {
    owner({ personalliggare: true, siteBuilder: true, phoneAgent: true, events: true })
    renderLayout()
    expect(navLabels()).toEqual([
      'Översikt', 'Statistik', 'Bokningar', 'Personalliggare', 'Telefon',
      'Meny', 'Layout', 'Webbplats', 'Evenemang', 'Inställningar',
    ])
  })

  it('shows Telefon and Evenemang to staff', () => {
    owner({ phoneAgent: true, events: true }, 'staff_user')
    renderLayout()
    const labels = navLabels()
    expect(labels).toContain('Telefon')
    expect(labels).toContain('Evenemang')
  })
})
