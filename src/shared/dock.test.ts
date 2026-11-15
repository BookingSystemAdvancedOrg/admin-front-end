import { afterEach, describe, expect, it, vi } from 'vitest'
import { dockPaths, dockSlots, fullLayerOpen, isKeyboardField, sheetGroups } from './dock'
import { NAV_GROUPS, visibleNav } from './nav'
import type { Tenant } from './tenant'

function tenant(features: Record<string, boolean>, role: Tenant['role'] = 'owner_user'): Tenant {
  return { tenantId: 't1', name: 'Roma', role, locations: [], entitlements: { maxLocations: null, features } } as unknown as Tenant
}

const labels = (t: Tenant) => {
  const slots = dockSlots(t)
  const bar = slots.flatMap((s) => (s.kind === 'page' ? [s.item.label] : []))
  const sheet = sheetGroups(t, dockPaths(slots)).flatMap((g) => g.items.map((i) => i.label))
  return { slots, bar, sheet }
}

describe('dockSlots and sheetGroups', () => {
  it('lays out Översikt, Bokningar, Ny bokning, slot 4 and Mer', () => {
    expect(dockSlots(tenant({ ordering: true })).map((s) => (s.kind === 'page' ? s.item.to : s.kind))).toEqual([
      '/', '/bokningar', 'new-booking', '/bestallningar', 'more',
    ])
    expect(dockSlots(tenant({})).map((s) => (s.kind === 'page' ? s.item.to : s.kind))).toEqual([
      '/', '/bokningar', 'new-booking', '/meny', 'more',
    ])
  })

  it('splits visibleNav exactly once between bar and sheet', () => {
    for (const t of [tenant({}), tenant({ ordering: true, catering: true, events: true, marketing: true }), tenant({ ordering: true, giftCards: true }, 'staff_user')]) {
      const { bar, sheet } = labels(t)
      expect([...bar, ...sheet].sort()).toEqual(visibleNav(t).map((i) => i.label).sort())
    }
  })

  it('drops empty groups and keeps the menu order', () => {
    const groups = sheetGroups(tenant({}), dockPaths(dockSlots(tenant({}))))
    expect(groups.map((g) => g.label)).toEqual([null, 'Restaurang', null])
    expect(groups[0].items.map((i) => i.label)).toEqual(['Statistik'])
  })
})

describe('dockSlots without Bokningar', () => {
  const bookings = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === '/bokningar')!
  afterEach(() => {
    delete bookings.ownerOnly
  })

  // (c) Utan Bokningar: ingen Ny bokning, platserna delar raden.
  it('has no raised button and fewer slots', () => {
    bookings.ownerOnly = true
    const slots = dockSlots(tenant({}, 'staff_user'))
    expect(slots.some((s) => s.kind === 'new-booking')).toBe(false)
    expect(slots).toHaveLength(3)
    const withOrders = dockSlots(tenant({ ordering: true }, 'staff_user'))
    expect(withOrders.map((s) => s.kind)).toEqual(['page', 'page', 'more'])
  })
})

describe('when the bar hides', () => {
  it('knows keyboard fields from checkboxes and buttons', () => {
    const make = (html: string) => {
      const d = document.createElement('div')
      d.innerHTML = html
      return d.firstElementChild
    }
    expect(isKeyboardField(make('<input type="text">'))).toBe(true)
    expect(isKeyboardField(make('<input>'))).toBe(true)
    expect(isKeyboardField(make('<textarea></textarea>'))).toBe(true)
    expect(isKeyboardField(make('<div contenteditable="true"></div>'))).toBe(true)
    expect(isKeyboardField(make('<input type="checkbox">'))).toBe(false)
    expect(isKeyboardField(make('<input type="range">'))).toBe(false)
    expect(isKeyboardField(make('<button>x</button>'))).toBe(false)
  })

  it('sees full-screen layers but not its own sheet', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div id="admin-more-sheet" aria-modal="true"></div>'
    expect(fullLayerOpen(root)).toBe(false)
    root.innerHTML += '<div class="modal-overlay"></div>'
    expect(fullLayerOpen(root)).toBe(true)
  })
})

vi.mock('./desktopDownloads', async (orig) => ({ ...(await orig<typeof import('./desktopDownloads')>()), showDownloadNav: () => false }))
