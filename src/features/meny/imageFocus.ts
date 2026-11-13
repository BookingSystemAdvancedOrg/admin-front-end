/**
 * Rättbildens fokuspunkt: den del av fotot (x %, y % av bredd och höjd)
 * som ska synas när en ram beskär bilden. Blir CSS object-position överallt
 * där bilden visas beskuren (listan, redigeringen, gästsajtens meny och
 * beställning). API-fältet heter imageFocus; saknas det gäller mitten.
 */
export interface ImageFocus {
  x: number
  y: number
}

export const CENTRE: ImageFocus = { x: 50, y: 50 }

/** Steg för piltangenterna, och med Skift. */
export const NUDGE = 2
export const NUDGE_LARGE = 10

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Heltal 0-100 på båda axlarna; trasiga värden blir mitten. */
export function clampFocus(focus: Partial<ImageFocus> | null | undefined): ImageFocus {
  if (!focus) return CENTRE
  return { x: clampAxis(focus.x ?? 50), y: clampAxis(focus.y ?? 50) }
}

export function isCentre(focus: ImageFocus | null | undefined): boolean {
  const f = clampFocus(focus)
  return f.x === 50 && f.y === 50
}

export function sameFocus(a: ImageFocus | null | undefined, b: ImageFocus | null | undefined): boolean {
  const fa = clampFocus(a)
  const fb = clampFocus(b)
  return fa.x === fb.x && fa.y === fb.y
}

/** Värdet för CSS object-position. */
export function focusPosition(focus: ImageFocus | null | undefined): string {
  const f = clampFocus(focus)
  return `${f.x}% ${f.y}%`
}

/**
 * Ny fokuspunkt efter att bilden dragits (dx, dy) px i ramen. Med
 * object-fit: cover sticker bilden ut (rendered - frame) px på en axel, och
 * object-position p % flyttar den (frame - rendered) * p / 100 px. Drar man
 * bilden åt höger syns mer av vänsterkanten, så x minskar. En axel där
 * bilden inte sticker ut ändras inte.
 */
export function dragFocus(
  start: ImageFocus,
  dx: number,
  dy: number,
  frame: { width: number; height: number },
  natural: { width: number; height: number },
): ImageFocus {
  if (frame.width <= 0 || frame.height <= 0 || natural.width <= 0 || natural.height <= 0) {
    return clampFocus(start)
  }
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height)
  const overflowX = natural.width * scale - frame.width
  const overflowY = natural.height * scale - frame.height
  return clampFocus({
    x: overflowX > 0.5 ? start.x - (dx / overflowX) * 100 : start.x,
    y: overflowY > 0.5 ? start.y - (dy / overflowY) * 100 : start.y,
  })
}

/**
 * Piltangent -> ny fokuspunkt, eller null för andra tangenter. Pilen följer
 * bilden som vid dragning: höger flyttar bilden åt höger (x minskar).
 */
export function nudgeFocus(focus: ImageFocus, key: string, large = false): ImageFocus | null {
  const step = large ? NUDGE_LARGE : NUDGE
  const f = clampFocus(focus)
  switch (key) {
    case 'ArrowLeft':
      return clampFocus({ x: f.x + step, y: f.y })
    case 'ArrowRight':
      return clampFocus({ x: f.x - step, y: f.y })
    case 'ArrowUp':
      return clampFocus({ x: f.x, y: f.y + step })
    case 'ArrowDown':
      return clampFocus({ x: f.x, y: f.y - step })
    default:
      return null
  }
}

/** Kort svensk beskrivning för skärmläsare: "mitten", "uppe till höger" … */
export function focusLabel(focus: ImageFocus | null | undefined): string {
  const f = clampFocus(focus)
  const col = f.x < 34 ? 'vänster' : f.x > 66 ? 'höger' : ''
  const row = f.y < 34 ? 'uppe' : f.y > 66 ? 'nere' : ''
  if (!col && !row) return 'mitten'
  if (!row) return `till ${col}`
  if (!col) return row
  return `${row} till ${col}`
}
