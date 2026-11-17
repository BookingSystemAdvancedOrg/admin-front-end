import { useEffect, type RefObject } from 'react'

/** Controls the button must never cover (see useDodge). Big focusable scroll areas are not controls. */
const CONTROL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=switch], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=slider], [contenteditable=true]'
export const YIELD_CLASS = 'help-launcher--yield'
/** How far apart the spots are that the button tries when a control is under it, and how high it may go. */
const STEP = 8
const MIN_TOP = 72

/**
 * The floating help button never covers anything that stays put on the screen
 * (a sticky save bar, a fixed notice, a cookie bar): when such an element sits
 * under the button, the button floats up above it, and back down when it is
 * gone. Content that scrolls past is left alone (it can be scrolled free).
 * The lift is the CSS variable --dodge, used by `translate` in the CSS.
 * A control is never covered either: the button floats up to the nearest
 * free spot, and only steps aside (YIELD_CLASS) when there is none.
 */
export function useDodge(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !active || typeof document.elementsFromPoint !== 'function') return
    let raf = 0
    let lift = 0
    const pinnedAncestor = (node: Element | null): Element | null => {
      for (let e = node; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const pos = getComputedStyle(e).position
        if (pos === 'fixed' || pos === 'sticky') return e
      }
      return null
    }
    let shift = 0
    const run = () => {
      raf = 0
      // Where the button rests without the lift, from its CSS bottom and right
      // (not its box, which is mid-move while the lift animates).
      const cs = getComputedStyle(el)
      const vh = window.innerHeight
      const vw = document.documentElement.clientWidth
      const bottom = vh - (parseFloat(cs.bottom) || 0)
      const top = bottom - el.offsetHeight
      const right = vw - (parseFloat(cs.right) || 0)
      const left = right - el.offsetWidth
      const xs = [left + 6, left + el.offsetWidth / 2, right - 6]
      const ys = [top + 6, top + el.offsetHeight / 2, bottom - 6]
      let obstacle: Element | null = null
      let obstacleTop = Infinity
      for (const x of xs) for (const y of ys) {
        for (const n of document.elementsFromPoint(x, y)) {
          if (el.contains(n)) continue
          const pin = pinnedAncestor(n)
          if (!pin || pin.contains(el)) continue
          const pr = pin.getBoundingClientRect()
          if (pr.height > vh * 0.5) continue // page frames and backgrounds, not bars
          if (pr.bottom > top && pr.top < bottom && pr.top < obstacleTop) {
            obstacleTop = pr.top
            obstacle = pin
          }
        }
      }
      let nextLift = obstacle ? Math.max(0, Math.ceil(bottom - obstacleTop + 10)) : 0
      // Line the button's right edge up with the bar's right edge (owner
      // 2026-11-14: Fråga Booqy ends on the same vertical line as the brown
      // save bar under it). Kept inside the window.
      let nextShift = 0
      if (obstacle) {
        const edge = obstacle.getBoundingClientRect().right
        nextShift = Math.round(right - edge)
        nextShift = Math.min(nextShift, Math.max(0, left - 12)) // not off the left side
        nextShift = Math.max(nextShift, -Math.max(0, vw - 12 - right)) // not off the right side
      }
      // Where the button ends up (after the lift) it may still sit on a
      // control (a row's menu, a link, a select). It never covers one: it
      // floats further up to the nearest spot with no control and no bar
      // under it, so it stays reachable even on a page that cannot scroll
      // the control free (Översikt at 1280 x 720). Text may pass under it.
      const blocked = (lift: number, shift: number) => {
        for (const x of xs) for (const y of ys) {
          const px = x - shift
          const py = y - lift
          if (px < 0 || px > vw) continue
          if (py < 0) return true
          for (const n of document.elementsFromPoint(px, py)) {
            if (el.contains(n)) continue
            const pin = pinnedAncestor(n)
            if (pin && !pin.contains(el) && pin.getBoundingClientRect().height <= vh * 0.5) return true
            if (!pin && n.closest(CONTROL)) return true
            break
          }
        }
        return false
      }
      let onControl = false
      if (blocked(nextLift, nextShift)) {
        onControl = true
        for (let up = nextLift + STEP; top - up >= MIN_TOP; up += STEP) {
          if (!blocked(up, nextShift)) {
            nextLift = up
            onControl = false
            break
          }
        }
      }
      if (nextLift !== lift || nextShift !== shift) {
        lift = nextLift
        shift = nextShift
        el.style.setProperty('--dodge', `${lift}px`)
        el.style.setProperty('--dodge-x', `${shift}px`)
      }
      // No free spot at all (rare): it steps aside (YIELD_CLASS) until the
      // control has scrolled away.
      // With keyboard focus it stays, so focus is never on something unseen.
      el.classList.toggle(YIELD_CLASS, onControl && document.activeElement !== el)
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(run) }
    schedule()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    const tick = window.setInterval(schedule, 1000)
    el.addEventListener('focus', schedule)
    return () => {
      el.removeEventListener('focus', schedule)
      el.classList.remove(YIELD_CLASS)
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      mo.disconnect()
      window.clearInterval(tick)
    }
  }, [ref, active])
}

/**
 * Owner 2026-11-14: the floating button slides out of view while the user
 * scrolls down and comes back when they scroll up or stop for about a second
 * (class help-launcher--away; the CSS keeps it to opacity under reduced
 * motion). It stays put while it has keyboard focus.
 */
export const AWAY_CLASS = 'help-launcher--away'
export const RETURN_AFTER_MS = 1000

export function useHideOnScroll(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const last = new WeakMap<EventTarget, number>()
    let timer = 0
    const back = () => {
      window.clearTimeout(timer)
      timer = 0
      el.classList.remove(AWAY_CLASS)
    }
    const onScroll = (e: Event) => {
      const target = e.target
      if (!target) return
      const box = target === document ? document.scrollingElement : (target as Element)
      if (!box || !(box instanceof Element) || el.contains(box)) return
      const y = box.scrollTop
      // A scroller seen for the first time started at the top.
      const prev = last.get(target) ?? 0
      last.set(target, y)
      if (Math.abs(y - prev) < 2) return
      if (y < prev || document.activeElement === el) {
        back()
        return
      }
      el.classList.add(AWAY_CLASS)
      window.clearTimeout(timer)
      timer = window.setTimeout(back, RETURN_AFTER_MS)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    el.addEventListener('focus', back)
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      el.removeEventListener('focus', back)
      window.clearTimeout(timer)
      el.classList.remove(AWAY_CLASS)
    }
  }, [ref, active])
}
