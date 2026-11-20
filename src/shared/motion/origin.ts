import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { lastPress } from '../press'

export interface Point {
  x: number
  y: number
}

/**
 * Var en panel ska växa ifrån (ux-motion 11, ursprung): punkten där man
 * tryckte, eller mitten av knappen som öppnade den, räknat från panelens
 * eget hörn. Långt borta ligger punkten högst en panelbredd utanför, så att
 * en dialog mitt på skärmen ändå bara förskjuts lite medan den växer.
 */
export function originFor(panel: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, from: Point): string {
  const clamp = (v: number, size: number) => Math.round(Math.min(size * 1.5, Math.max(-size * 0.5, v)))
  return `${clamp(from.x - panel.left, panel.width)}px ${clamp(from.y - panel.top, panel.height)}px`
}

/** Mitten av ett element, eller null. */
export function centreOf(el: Element | null | undefined): Point | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return null
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Sätter transform-origin på panelen innan den ritas (useLayoutEffect), så
 * att dess in-övergång (motion.css, @starting-style) växer ur knappen
 * `anchor`, annars ur det senaste trycket. Utan någon av dem gäller CSS:ens.
 */
export function setOrigin(panel: HTMLElement | null, anchor?: Element | null) {
  if (!panel) return
  const from = centreOf(anchor) ?? lastPress()
  if (!from) return
  panel.style.transformOrigin = originFor(panel.getBoundingClientRect(), from)
}

export function useOrigin(panel: RefObject<HTMLElement | null>, open: boolean, anchor?: RefObject<Element | null>) {
  useLayoutEffect(() => {
    if (open) setOrigin(panel.current, anchor?.current)
  }, [open, panel, anchor])
}

let dialogsWatched = false

/**
 * Dialogerna från @booqy/brand (<Modal>, dialog.bq-modal) öppnas utanför
 * vår kod. När en av dem får `open` sätts dess transform-origin till det
 * senaste trycket innan den ritas (MutationObserver körs före nästa bild),
 * så att även de växer ur knappen eller raden (motion.css).
 */
export function installDialogOrigin() {
  if (dialogsWatched || typeof MutationObserver === 'undefined') return
  dialogsWatched = true
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target
      if (el instanceof HTMLDialogElement && el.open && el.classList.contains('bq-modal')) setOrigin(el)
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
}
