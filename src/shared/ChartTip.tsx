import { useLayoutEffect, useRef, useState } from 'react'
import type { ChartTipState, TipContent } from './chartTipState'
import './chartTip.css'

/**
 * Själva tipset. Läggs i diagrammets <figure> (som har position: relative)
 * och placeras ovanför punkten, eller under när det inte får plats.
 */
export function ChartTip({ tip, at, content }: { tip: ChartTipState; at: { x: number; y: number } | null; content: TipContent | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const open = tip.active !== null && at !== null && content !== null

  useLayoutEffect(() => {
    const el = ref.current
    const svg = tip.svg
    const host = el?.offsetParent as HTMLElement | null
    if (!open || !el || !svg || !host) {
      setPos(null)
      return
    }
    const box = svg.viewBox.baseVal
    const s = svg.getBoundingClientRect()
    const h = host.getBoundingClientRect()
    const sx = box && box.width ? s.width / box.width : 1
    const sy = box && box.height ? s.height / box.height : 1
    const px = s.left - h.left + (at.x - (box?.x ?? 0)) * sx
    const py = s.top - h.top + (at.y - (box?.y ?? 0)) * sy
    const w = el.offsetWidth
    const ht = el.offsetHeight
    const left = Math.round(Math.max(0, Math.min(h.width - w, px - w / 2)))
    const below = py - ht - 10 < 0
    const top = Math.round(below ? py + 12 : py - ht - 10)
    setPos((cur) => (cur && cur.left === left && cur.top === top && cur.below === below ? cur : { left, top, below }))
  }, [open, tip.svg, at, content])

  return (
    <div
      ref={ref}
      className={`chart-tip${pos?.below ? ' chart-tip--below' : ''}`}
      aria-live="polite"
      data-open={open && pos ? 'true' : undefined}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
    >
      {open && (
        <>
          <strong className="chart-tip-heading">{content.heading}</strong>
          {content.rows.map((r, i) => (
            <span key={i} className="chart-tip-row">
              {r.tone && <i className={`chart-tip-swatch chart-tip-swatch--${r.tone}`} aria-hidden="true" />}
              {r.label && <span className="chart-tip-label">{r.label}</span>}
              <span className="chart-tip-value">{r.value}</span>
            </span>
          ))}
          {content.note && <span className="chart-tip-note">{content.note}</span>}
        </>
      )}
    </div>
  )
}
