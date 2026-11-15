import { useEffect, useSyncExternalStore } from 'react'
import { NAV_FOOTER, NAV_GROUPS, navVisible, onItem } from './nav'
import type { NavItem } from './nav'
import type { Tenant } from './tenant'

/**
 * Telefonens meny längst ner (BottomNav, MoreSheet): samma brytpunkt som när
 * sidomenyn tidigare blev en låda. Allt räknas fram ur nav.ts (NAV_GROUPS,
 * NAV_FOOTER, navVisible), så raden och arket visar exakt det sidomenyn visar
 * för rollen och planen, varken mer eller mindre.
 */
export const PHONE_NAV_QUERY = '(max-width: 900px)'

function phoneNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_NAV_QUERY).matches
}

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(PHONE_NAV_QUERY)
  mq.addEventListener?.('change', onChange)
  return () => mq.removeEventListener?.('change', onChange)
}

/** Telefon och smal surfplatta (900 px och smalare): raden längst ner i stället för sidomenyn. */
export function usePhoneNav(): boolean {
  return useSyncExternalStore(subscribePhone, phoneNow, () => false)
}

const ALL_PAGES = NAV_GROUPS.flatMap((g) => g.items)
const byPath = (to: string) => ALL_PAGES.find((i) => i.to === to)!

export type DockSlot =
  | { kind: 'page'; item: NavItem }
  | { kind: 'new-booking' }
  | { kind: 'more' }

/**
 * Raden: Översikt, Bokningar, Ny bokning (upphöjd, bara om rollen ser
 * Bokningar), Beställningar eller annars Meny, och Mer. Fråga Booqy kan i
 * stället stå i mitten: byt 'new-booking' mot den här.
 */
export function dockSlots(tenant: Tenant | null): DockSlot[] {
  const visible = (item: NavItem) => navVisible(item, tenant)
  const home = byPath('/')
  const bookings = byPath('/bokningar')
  const fourth = [byPath('/bestallningar'), byPath('/meny')].find(visible)
  const slots: DockSlot[] = []
  if (visible(home)) slots.push({ kind: 'page', item: home })
  if (visible(bookings)) slots.push({ kind: 'page', item: bookings }, { kind: 'new-booking' })
  if (fourth) slots.push({ kind: 'page', item: fourth })
  slots.push({ kind: 'more' })
  return slots
}

export type SheetGroup = { id: string; label: string | null; items: NavItem[] }

/**
 * Arket bakom Mer: menyns grupper (alltid öppna här) utan sidorna som redan
 * står i raden, och sist menyns fot (Inställningar, Hjälp, Installera appen).
 * Grupper utan något synligt visas inte.
 */
export function sheetGroups(tenant: Tenant | null, dockPaths: string[]): SheetGroup[] {
  const keep = (item: NavItem) => navVisible(item, tenant) && !dockPaths.includes(item.to)
  const groups = NAV_GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.items.filter(keep) }))
  groups.push({ id: 'fot', label: null, items: NAV_FOOTER.filter(keep) })
  return groups.filter((g) => g.items.length > 0)
}

/** Sidorna i raden (för sheetGroups). */
export function dockPaths(slots: DockSlot[]): string[] {
  return slots.flatMap((s) => (s.kind === 'page' ? [s.item.to] : []))
}

/** Länken som är aktiv: inte en länk till en del av en sida (#), som i sidomenyn. */
export function isActiveItem(pathname: string, item: NavItem): boolean {
  return !item.to.includes('#') && onItem(pathname, item)
}

/* --- När raden göms -------------------------------------------------------- */

export const DOCK_HIDDEN_CLASS = 'dock-hidden'

/** Fält som öppnar tangentbordet på skärmen. */
const KEYBOARD_FIELD =
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=color]):not([type=hidden]), textarea, select, [contenteditable]:not([contenteditable=false])'

/** Lager som täcker hela skärmen: dialoger, paletten, bildvisaren, hjälpassistenten, rullistornas ark. */
const FULL_LAYER = [
  '[aria-modal="true"]:not(#admin-more-sheet)',
  '.modal-overlay',
  '.palette-backdrop',
  '.help-panel',
  '.b-select-sheet',
  '[data-dock-hide]',
].join(', ')

export function isKeyboardField(el: Element | null): boolean {
  return !!el && el instanceof HTMLElement && el.matches(KEYBOARD_FIELD) && !el.closest('.bq-dock')
}

export function fullLayerOpen(root: ParentNode = document): boolean {
  return root.querySelector(FULL_LAYER) !== null
}

/**
 * Göm raden (html.dock-hidden) medan tangentbordet är uppe eller ett lager
 * täcker skärmen. Aldrig vid rullning: raden ligger kvar under tummen.
 */
export function useDockHiding(active: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    if (!active) {
      root.classList.remove(DOCK_HIDDEN_CLASS)
      return
    }
    let typing = isKeyboardField(document.activeElement)
    let layer = fullLayerOpen()
    let viewportShrunk = false
    let blurTimer = 0
    const apply = () => root.classList.toggle(DOCK_HIDDEN_CLASS, typing || layer || viewportShrunk)
    const onFocusIn = (e: FocusEvent) => {
      window.clearTimeout(blurTimer)
      typing = isKeyboardField(e.target as Element | null)
      apply()
    }
    // Från fält till fält: vänta lite så att raden inte blinkar fram.
    const onFocusOut = () => {
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => {
        typing = isKeyboardField(document.activeElement)
        apply()
      }, 100)
    }
    const vv = window.visualViewport
    const onViewport = () => {
      viewportShrunk = !!vv && vv.height < window.innerHeight - 120 && isKeyboardField(document.activeElement)
      apply()
    }
    let raf = 0
    const observer = new MutationObserver(() => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        layer = fullLayerOpen()
        apply()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'class', 'data-dock-hide'] })
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    vv?.addEventListener('resize', onViewport)
    apply()
    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      vv?.removeEventListener('resize', onViewport)
      window.clearTimeout(blurTimer)
      if (raf) window.cancelAnimationFrame(raf)
      root.classList.remove(DOCK_HIDDEN_CLASS)
    }
  }, [active])
}

/** Är raden gömd just nu (för inert)? */
function subscribeHidden(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
export function useDockHidden(): boolean {
  return useSyncExternalStore(
    subscribeHidden,
    () => document.documentElement.classList.contains(DOCK_HIDDEN_CLASS),
    () => false,
  )
}
