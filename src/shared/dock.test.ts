import { describe, expect, it, vi } from 'vitest'
import { dockPaths, dockSlots, fullLayerOpen, isKeyboardField, PHONE_NAV_QUERY, sheetGroups, useDockHiding } from './dock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { visibleNav } from './nav'
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
  // Personal utan behörighet till Bokningar (bara Statistik, Meny och Beställningar).
  const withoutBookings = (features: Record<string, boolean>) =>
    ({ ...tenant(features, 'staff_user'), access: { areas: ['statistik', 'meny', 'bestallningar'] } }) as Tenant

  // (c) Utan Bokningar: ingen Ny bokning, platserna delar raden.
  it('has no raised button and fewer slots', () => {
    const slots = dockSlots(withoutBookings({}))
    expect(slots.some((s) => s.kind === 'new-booking')).toBe(false)
    expect(slots).toHaveLength(3)
    const withOrders = dockSlots(withoutBookings({ ordering: true }))
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

  it('stays up for the guide card, which points at the bar', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="guide-layer"><div role="dialog" aria-modal="true"></div></div>'
    expect(fullLayerOpen(root)).toBe(false)
  })

  it('comes back when a focused field is removed without focusout (Safari)', async () => {
    const { renderHook } = await import('@testing-library/react')
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    const { unmount } = renderHook(() => useDockHiding(true))
    expect(document.documentElement.classList.contains('dock-hidden')).toBe(true)
    // Safari: no focusout when the element goes away.
    const stop = (e: Event) => e.stopImmediatePropagation()
    document.addEventListener('focusout', stop, true)
    field.remove()
    document.body.appendChild(document.createElement('div'))
    await new Promise((r) => setTimeout(r, 50))
    expect(document.documentElement.classList.contains('dock-hidden')).toBe(false)
    document.removeEventListener('focusout', stop, true)
    unmount()
  })
})

vi.mock('./desktopDownloads', async (orig) => ({ ...(await orig<typeof import('./desktopDownloads')>()), showDownloadNav: () => false }))

describe('PHONE_NAV_QUERY', () => {
  // Tablets and computers keep the sidebar; a phone stays a phone in landscape.
  function matches(w: number, h: number, coarse: boolean): boolean {
    return PHONE_NAV_QUERY.split(',').some((part) =>
      part.trim().split(' and ').every((cond) => {
        const m = /\((max-width|max-height|pointer): ?([a-z0-9]+)\)/.exec(cond.trim())
        if (!m) throw new Error(`unknown condition ${cond}`)
        if (m[1] === 'pointer') return coarse === (m[2] === 'coarse')
        const limit = parseInt(m[2], 10)
        return (m[1] === 'max-width' ? w : h) <= limit
      }),
    )
  }

  it('is a phone in both orientations, never a tablet or a computer', () => {
    expect(matches(390, 844, true)).toBe(true) // iPhone, portrait
    expect(matches(932, 430, true)).toBe(true) // iPhone Pro Max, landscape
    expect(matches(926, 428, true)).toBe(true) // iPhone Plus, landscape
    expect(matches(768, 1024, true)).toBe(false) // iPad, portrait
    expect(matches(820, 1180, true)).toBe(false) // iPad Air, portrait
    expect(matches(1180, 820, true)).toBe(false) // iPad Air, landscape
    expect(matches(880, 900, false)).toBe(false) // narrow desktop window
    expect(matches(1280, 480, false)).toBe(false) // short desktop window
  })

  it('is the same query in the stylesheets', () => {
    const bottomNavCss = readFileSync(join('src', 'shared', 'bottomNav.css'), 'utf8')
    const adminCss = readFileSync(join('src', 'shared', 'admin.css'), 'utf8')
    expect(bottomNavCss).toContain(`@media ${PHONE_NAV_QUERY} {`)
    expect(adminCss).toContain(`@media ${PHONE_NAV_QUERY} {`)
    expect(bottomNavCss).not.toContain('max-width: 900px')
    // ds.css och brand.css döljer sidomenyn och visar raden: samma fråga, annars står en surfplatta utan meny.
    for (const file of ['ds.css', 'brand.css']) {
      const css = readFileSync(join('src', 'shared', file), 'utf8')
      expect(css, file).toContain(`@media ${PHONE_NAV_QUERY} {`)
      expect(css, file).not.toContain('@media (max-width: 900px) {')
    }
  })
})
