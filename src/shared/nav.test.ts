import { describe, expect, it } from 'vitest'
import { roleAllows } from './nav'
import type { Tenant } from './tenant'

const as = (role: string, staffAccess?: string) =>
  ({ role, insights: staffAccess ? { staffAccess } : undefined }) as unknown as Tenant

describe('roleAllows', () => {
  it('stops staff on every owner-only page, also deeper paths', () => {
    for (const p of ['/personal', '/presentkort', '/webbplats', '/marknadsforing', '/marknadsforing/kampanjer'])
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
    for (const p of ['/personal', '/presentkort', '/webbplats', '/marknadsforing']) {
      expect(roleAllows(p, as('owner_user'))).toBe(true)
      expect(roleAllows(p, null)).toBe(true)
    }
  })
})
