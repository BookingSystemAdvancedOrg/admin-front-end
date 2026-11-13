import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { dragFocus, focusLabel, focusPosition, nudgeFocus } from './imageFocus'
import type { ImageFocus } from './imageFocus'

/** Rörelse (px) innan ett tryck räknas som dragning i stället för klick. */
const DRAG_THRESHOLD = 4

interface Drag {
  pointerId: number
  x: number
  y: number
  start: ImageFocus
  frame: { width: number; height: number }
  natural: { width: number; height: number }
  moved: boolean
}

/**
 * Rättens bild i en ram där man drar bilden för att välja vilken del som
 * syns (fokuspunkten), med mus, finger eller piltangenter (Skift = större
 * steg). Ett klick utan dragning, eller Enter, visar bilden i stort.
 */
export function FocusFrame({
  src,
  alt,
  focus,
  onChange,
  onOpen,
}: {
  src: string
  alt: string
  focus: ImageFocus
  onChange: (focus: ImageFocus) => void
  onOpen: () => void
}) {
  const img = useRef<HTMLImageElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !img.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: focus,
      frame: { width: rect.width, height: rect.height },
      natural: { width: img.current.naturalWidth, height: img.current.naturalHeight },
      moved: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    onChange(dragFocus(d.start, dx, dy, d.frame, d.natural))
  }

  function endDrag(e: PointerEvent<HTMLDivElement>, open: boolean) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (open && !d.moved) onOpen()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
      return
    }
    const next = nudgeFocus(focus, e.key, e.shiftKey)
    if (next) {
      e.preventDefault()
      onChange(next)
    }
  }

  return (
    <div
      className={`dish-focus-frame${dragging ? ' is-dragging' : ''}`}
      tabIndex={0}
      role="group"
      aria-roledescription="bildfokus"
      aria-label={`Bildens fokus: ${focusLabel(focus)}. Dra bilden eller använd piltangenterna för att välja vad som syns. Enter visar bilden i stort.`}
      data-help="meny:bildfokus"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
      onKeyDown={onKeyDown}
    >
      <img
        ref={img}
        className="dish-focus-img"
        src={src}
        alt={alt}
        draggable={false}
        style={{ objectPosition: focusPosition(focus) }}
      />
      <span className="dish-focus-grid" aria-hidden="true" />
    </div>
  )
}
