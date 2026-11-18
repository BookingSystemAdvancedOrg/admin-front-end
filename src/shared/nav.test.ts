import { describe, expect, it } from 'vitest'
import { areaOf, roleAllows, visibleNav } from './nav'
import type { Tenant } from './tenant'
import type { Area } from './access'

const as = (role: string, staffAccess?: string, areas?: Area[]) =>
  ({
    role,
    insights: staffAccess ? { staffAccess } : undefined,
    access: areas ? { areas } : undefined,
    entitlements: { maxLocations: null, features: { ordering: true, catering: true, giftCards: true, events: true } },
  }) as unknown as Tenant

describe('roleAllows (older API without access.areas)', () => {
  it('stops staff on every owner-only page, also deeper paths', () => {
    for (const p of ['/personal', '/presentkort', '/marknadsforing', '/marknadsforing/kampanjer'])
      expect(roleAllows(p, as('staff_user'))).toBe(false)
  })

  it('lets staff open the shared pages', () => {
    for (const p of ['/', '/bokningar', '/personalliggare', '/meny', '/installningar', '/avtal', '/hjalp', '/statistik'])
      expect(roleAllows(p, as('staff_user'))).toBe(true)
  })

  it('stops staff on Statistik when the owner turned it off', () => {
    expect(roleAllows('/statistik', as('staff_user', 'none'))).toBe(false)
    expect(roleAllows('/statistik', as('owner_user', 'none'))).toBe(true)
  })

  it('lets the owner open everything, and waits while the tenant loads', () => {
    for (const p of ['/personal', '/presentkort', '/marknadsforing']) {
      expect(roleAllows(p, as('owner_user'))).toBe(true)
      expect(roleAllows(p, null)).toBe(true)
    }
  })
})

describe('staff permissions per area', () => {
  const staff = as('staff_user', undefined, ['bokningar', 'evenemang'])

  it('opens only the granted areas, also on direct URLs and sub-pages', () => {
    expect(roleAllows('/bokningar', staff)).toBe(true)
    expect(roleAllows('/evenemang', staff)).toBe(true)
    for (const p of ['/meny', '/statistik', '/personal', '/catering/loc/req', '/cateringkalkyl', '/kunder'])
      expect(roleAllows(p, staff)).toBe(false)
    // Always open: Översikt, Inställningar, Hjälp.
    for (const p of ['/', '/installningar', '/hjalp']) expect(roleAllows(p, staff)).toBe(true)
  })

  it('hides what is not granted from the menu and search', () => {
    const labels = visibleNav(staff).map((i) => i.label)
    expect(labels).toContain('Bokningar')
    expect(labels).toContain('Evenemang')
    expect(labels).not.toContain('Meny')
    expect(labels).not.toContain('Statistik')
    expect(labels).not.toContain('Beställningar')
  })

  it('never takes anything from the owner', () => {
    const owner = as('owner_user', undefined, [])
    expect(visibleNav(owner).map((i) => i.label)).toContain('Personal')
    expect(roleAllows('/meny', owner)).toBe(true)
  })

  it('ignores the removed site builder: a stored siteBuilder flag or webbplats grant shows nothing', () => {
    const stale = {
      role: 'staff_user',
      access: { areas: ['bokningar', 'webbplats'] },
      entitlements: { maxLocations: null, features: { siteBuilder: true } },
    } as unknown as Tenant
    expect(visibleNav(stale).map((i) => i.label)).not.toContain('Webbplats')
    expect(visibleNav(as('owner_user')).map((i) => i.to)).not.toContain('/webbplats')
    expect(areaOf('/webbplats')).toBeNull()
  })

  it('knows the area of a path', () => {
    expect(areaOf('/cateringkalkyl')).toBe('catering')
    expect(areaOf('/evenemang/e1/inslapp/o1')).toBe('evenemang')
    expect(areaOf('/')).toBeNull()
    expect(areaOf('/installningar')).toBeNull()
  })
})
