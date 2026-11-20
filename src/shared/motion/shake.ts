import { reducedMotion } from './countUp'

/**
 * Fältet som är fel skakar tre gånger på 300 ms (ux-motion 9) och får
 * fokus, så att man ser vad som ska rättas. Med "minska rörelse" bara fokus.
 */
export function shake(el: HTMLElement | null, focus = true) {
  if (!el) return
  if (focus) el.focus({ preventScroll: false })
  if (reducedMotion() || typeof el.animate !== 'function') return
  el.animate(
    [
      { translate: '0 0' },
      { translate: '-6px 0' },
      { translate: '6px 0' },
      { translate: '-4px 0' },
      { translate: '4px 0' },
      { translate: '-2px 0' },
      { translate: '0 0' },
    ],
    { duration: 300, easing: 'ease-out' },
  )
}
