import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GUIDE_STEPS } from './steps'
import type { GuideStep } from './steps'
import './guide.css'

/**
 * Introduktionsguide ("tutorial") för nya användare av admin-appen.
 *
 * En bubbla i taget pekar på en del av gränssnittet (element med
 * `data-tour="..."`) i kronologisk ordning; resten av sidan tonas ner.
 * "Nästa" visar nästa bubbla, "Hoppa över" avslutar. Guiden startar av sig
 * själv första gången en användare loggar in (per användare och webbläsare)
 * och kan alltid startas igen från Hjälp-sidan.
 */

const STORAGE_PREFIX = 'booqy-guide-done:'

function storageKey(user: string): string {
  return `${STORAGE_PREFIX}${user}`
}

export function hasSeenGuide(user: string): boolean {
  try {
    return localStorage.getItem(storageKey(user)) === '1'
  } catch {
    // Blockerad lagring (privat läge): visa inte guiden varje gång.
    return true
  }
}

function markGuideSeen(user: string): void {
  try {
    localStorage.setItem(storageKey(user), '1')
  } catch {
    // Ingen lagring - guiden kan ändå startas från Hjälp.
  }
}

interface GuideApi {
  start: () => void
  active: boolean
}

const GuideContext = createContext<GuideApi>({ start: () => {}, active: false })

export function useGuide(): GuideApi {
  return useContext(GuideContext)
}

function targetOf(step: GuideStep): HTMLElement | null {
  if (!step.target) return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
  // Dolda element (display: none) har ingen yta att peka på.
  return el && el.getClientRects().length > 0 ? el : null
}

/** Stegen som går att visa just nu: mittsteg alltid, övriga om målet finns. */
function visibleSteps(): GuideStep[] {
  return GUIDE_STEPS.filter((s) => !s.target || targetOf(s) !== null)
}

export function GuideProvider({
  user,
  autoStart,
  children,
}: {
  /** Vem guiden gäller (Cognito-sub eller e-post); null = ingen inloggning än. */
  user: string | null
  /** Starta av sig själv för den som inte sett guiden (när appen är redo). */
  autoStart: boolean
  children: ReactNode
}) {
  const [steps, setSteps] = useState<GuideStep[] | null>(null)
  const [index, setIndex] = useState(0)

  const start = useCallback(() => {
    setIndex(0)
    setSteps(visibleSteps())
  }, [])

  const finish = useCallback(() => {
    if (user) markGuideSeen(user)
    setSteps(null)
  }, [user])

  useEffect(() => {
    if (!autoStart || !user || hasSeenGuide(user)) return
    // Vänta ett ögonblick så att menyn hunnit ritas.
    const timer = window.setTimeout(start, 400)
    return () => window.clearTimeout(timer)
  }, [autoStart, user, start])

  const api = useMemo(() => ({ start, active: steps !== null }), [start, steps])

  return (
    <GuideContext.Provider value={api}>
      {children}
      {steps && steps[index] && (
        <GuideBubble
          step={steps[index]}
          number={index + 1}
          total={steps.length}
          onNext={() => (index + 1 < steps.length ? setIndex(index + 1) : finish())}
          onBack={index > 0 ? () => setIndex(index - 1) : undefined}
          onSkip={finish}
        />
      )}
    </GuideContext.Provider>
  )
}

interface Placement {
  spot: { top: number; left: number; width: number; height: number } | null
  bubble: { top: number; left: number }
  side: 'right' | 'below' | 'center'
}

const BUBBLE_WIDTH = 320
const GAP = 14
const PAD = 6

function place(step: GuideStep, bubbleHeight: number): Placement {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const el = targetOf(step)
  if (!el) {
    return {
      spot: null,
      bubble: { top: Math.max(16, (vh - bubbleHeight) / 2), left: Math.max(16, (vw - BUBBLE_WIDTH) / 2) },
      side: 'center',
    }
  }
  const r = el.getBoundingClientRect()
  const spot = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
  const clampTop = (t: number) => Math.min(Math.max(16, t), vh - bubbleHeight - 16)
  const clampLeft = (l: number) => Math.min(Math.max(16, l), vw - BUBBLE_WIDTH - 16)
  if (vw - r.right >= BUBBLE_WIDTH + GAP + 16) {
    return { spot, bubble: { top: clampTop(r.top + r.height / 2 - bubbleHeight / 2), left: r.right + GAP }, side: 'right' }
  }
  return { spot, bubble: { top: clampTop(r.bottom + GAP), left: clampLeft(r.left) }, side: 'below' }
}

function GuideBubble({
  step,
  number,
  total,
  onNext,
  onBack,
  onSkip,
}: {
  step: GuideStep
  number: number
  total: number
  onNext: () => void
  onBack?: () => void
  onSkip: () => void
}) {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    targetOf(step)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const update = () => setPlacement(place(step, bubbleRef.current?.offsetHeight ?? 180))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step])

  useEffect(() => {
    nextRef.current?.focus()
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const last = number === total
  const titleId = `guide-title-${step.id}`

  return (
    <div className="guide-layer">
      {placement?.spot ? (
        <div className="guide-spot" style={placement.spot} aria-hidden="true" />
      ) : (
        <div className="guide-dim" aria-hidden="true" />
      )}
      <div
        ref={bubbleRef}
        className={`guide-bubble guide-bubble--${placement?.side ?? 'center'}`}
        style={placement ? { top: placement.bubble.top, left: placement.bubble.left } : { visibility: 'hidden' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <p className="guide-count">
          {number} av {total}
        </p>
        <h2 className="guide-title" id={titleId}>
          {step.title}
        </h2>
        <p className="guide-text">{step.text}</p>
        <div className="guide-actions">
          {!last && (
            <button type="button" className="guide-skip" onClick={onSkip}>
              Hoppa över
            </button>
          )}
          <span className="guide-actions-right">
            {onBack && (
              <button type="button" className="btn outline square" onClick={onBack}>
                Tillbaka
              </button>
            )}
            <button ref={nextRef} type="button" className="btn primary square" onClick={onNext}>
              {number === 1 ? 'Visa mig' : last ? 'Klar' : 'Nästa'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
