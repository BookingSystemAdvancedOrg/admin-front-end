import { useEffect, useState } from 'react'
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react'

/**
 * Verktygstipset för alla diagram i admin: hovra, tryck eller tabba till
 * diagrammet och gå med piltangenterna, så visas punktens etikett, värde
 * och (med flera serier) seriens namn. Diagrammet ritar sina egna
 * träffytor och säger var tipset ska sitta, i SVG:ns egna koordinater.
 */

export type TipTone = 'ink' | 'red' | 'steel' | 'muted' | 'line' | 'border'

export interface TipRow {
  /** Seriens namn; utelämnas när diagrammet bara har en serie. */
  label?: string
  value: string
  tone?: TipTone
}

export interface TipContent {
  heading: string
  rows: TipRow[]
  /** En extra rad under värdena, t.ex. "i 12 bokningar". */
  note?: string
}

export interface ChartTipState {
  active: number | null
  set: (i: number | null) => void
  /** Diagrammets <svg>, när det har ritats. */
  svg: SVGSVGElement | null
  /** Spridda på diagrammets <svg>: fokus, piltangenter och musen som lämnar. */
  surface: {
    ref: (el: SVGSVGElement | null) => void
    tabIndex: number
    onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => void
    onFocus: (e: FocusEvent<SVGSVGElement>) => void
    onBlur: () => void
    onPointerLeave: (e: PointerEvent<SVGSVGElement>) => void
  }
  /** Spridda på en punkts träffyta. */
  hit: (i: number) => { onPointerEnter: () => void; onPointerDown: () => void }
}

/** `cols` gör pil upp/ned till ett hopp en rad (värmekartan). */
export function useChartTip(count: number, cols = 0): ChartTipState {
  const [active, setActive] = useState<number | null>(null)
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const shown = active !== null && active < count ? active : null

  // Ett tryck utanför diagrammet stänger tipset (på mobil finns ingen "lämna").
  useEffect(() => {
    if (shown === null) return
    const close = (e: globalThis.PointerEvent) => {
      const host = svg?.parentElement
      if (host && e.target instanceof Node && !host.contains(e.target)) setActive(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [shown, svg])

  const move = (step: number) => setActive((cur) => Math.max(0, Math.min(count - 1, (cur ?? -1) + step)))

  return {
    active: shown,
    set: setActive,
    svg,
    surface: {
      ref: setSvg,
      tabIndex: count > 0 ? 0 : -1,
      onKeyDown: (e) => {
        const down = cols > 0 ? cols : 1
        const keys: Record<string, () => void> = {
          ArrowRight: () => move(1),
          ArrowLeft: () => move(-1),
          ArrowDown: () => move(down),
          ArrowUp: () => move(-down),
          Home: () => setActive(0),
          End: () => setActive(count - 1),
          Escape: () => setActive(null),
        }
        const act = keys[e.key]
        if (!act || count === 0) return
        e.preventDefault()
        act()
      },
      onFocus: (e) => {
        // Bara tangentbordet: ett musklick sätter redan punkten under musen.
        let keyboard = true
        try {
          keyboard = e.currentTarget.matches(':focus-visible')
        } catch {
          keyboard = true
        }
        if (keyboard && count > 0) setActive((cur) => cur ?? 0)
      },
      onBlur: () => setActive(null),
      onPointerLeave: (e) => {
        if (e.pointerType === 'mouse') setActive(null)
      },
    },
    hit: (i) => ({ onPointerEnter: () => setActive(i), onPointerDown: () => setActive(i) }),
  }
}

