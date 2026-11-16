import { describe, expect, it } from 'vitest'
import { personAreas, personSource, togglePerson } from './access'
import { canOpen } from './access'
import type { Tenant } from './tenant'

const config = { defaults: ['bokningar', 'meny'] as const, users: { s1: { add: ['webbplats'], remove: ['meny'] } } }
const cfg = config as unknown as Parameters<typeof personSource>[0]

describe('staff access', () => {
  it('tells where each tick comes from', () => {
    expect(personSource(cfg, 's1', 'bokningar')).toBe('group')
    expect(personSource(cfg, 's1', 'meny')).toBe('removed')
    expect(personSource(cfg, 's1', 'webbplats')).toBe('own')
    expect(personSource(cfg, 's1', 'gaster')).toBe('none')
    expect(personSource(cfg, 'new', 'meny')).toBe('group')
  })

  it('computes a person as group plus own minus removed', () => {
    expect(personAreas(cfg, 's1')).toEqual(['bokningar', 'webbplats'])
    expect(personAreas(cfg, 's2')).toEqual(['bokningar', 'meny'])
  })

  it('toggles: unticking a group area removes it for the person, ticking again undoes that', () => {
    expect(togglePerson(cfg, 's1', 'bokningar', false)).toEqual({ add: ['webbplats'], remove: ['bokningar', 'meny'] })
    expect(togglePerson(cfg, 's1', 'meny', true)).toEqual({ add: ['webbplats'], remove: [] })
    expect(togglePerson(cfg, 's1', 'webbplats', false)).toEqual({ add: [], remove: ['meny'] })
    expect(togglePerson(cfg, 's1', 'gaster', true)).toEqual({ add: ['gaster', 'webbplats'], remove: ['meny'] })
  })

  it('canOpen: owner always, staff by the server list, older API as before', () => {
    const t = (role: string, extra: object = {}) => ({ role, ...extra }) as unknown as Tenant
    expect(canOpen(t('owner_user', { access: { areas: [] } }), 'personal')).toBe(true)
    expect(canOpen(t('staff_user', { access: { areas: ['personal'] } }), 'personal')).toBe(true)
    expect(canOpen(t('staff_user', { access: { areas: ['personal'] } }), 'meny')).toBe(false)
    expect(canOpen(t('staff_user'), 'meny')).toBe(true)
    expect(canOpen(t('staff_user'), 'personal')).toBe(false)
    expect(canOpen(null, 'meny')).toBe(false)
  })
})
