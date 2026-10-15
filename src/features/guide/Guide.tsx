import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { stepsFor } from './steps'
import type { GuideContext, GuideStep } from './steps'
import { guideDoneOnAccount, markGuideDoneOnAccount, rememberLocally, seenLocally } from './guideApi'
import './guide.css'

/**
 * Introduktionsguide ("tutorial") för nya användare av admin-appen.
 *
 * Guiden går sida för sida (Översikt, Inställningar flik för flik, Meny,
 * Bokningar, Beställningar, Catering, Layout) och visar en bubbla i taget
 * vid knappen eller delen den förklarar (element med `data-tour="..."`);
 * resten av sidan tonas ner. "Nästa" visar nästa bubbla, "Hoppa över"
 * avslutar.
 *
 * Den startar av sig själv EN gång per användare - första gången hen
 * loggar in - och sparas på kontot, så den kommer inte tillbaka på en annan
 * dator. Efter det startas den bara från Hjälp-sidan.
 */

interface GuideApi {
  start: () => void
  active: boolean
}

const GuideCtx = createContext<GuideApi>({ start: () => {}, active: false })

export function useGuide(): GuideApi {
  return useContext(GuideCtx)
}

/** Hur länge guiden väntar på knappen efter ett sidbyte (sidan hämtar data). */
export const TARGET_WAIT_MS = 3000
/** ...och på samma sida (t.ex. platsväljaren som bara finns med flera platser). */
const SAME_PAGE_WAIT_MS = 300

function targetOf(step: GuideStep): HTMLElement | null {
  if (!step.target) return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
  // Dolda element (display: none) har ingen yta att peka på.
  return el && el.getClientRects().length > 0 ? el : null
}

function routeMatches(route: string, pathname: string, hash: string): boolean {
  const [path, fragment] = route.split('#')
  return pathname === path && (!fragment || hash === `#${fragment}`)
}

export function GuideProvider({
  user,
  context,
  autoStart,
  children,
}: {
  /** Vem guiden gäller (Cognito-sub eller e-post); null = ingen inloggning än. */
  user: string | null
  /** Roll och plan: avgör vilka steg som visas. */
  context: GuideContext
  /** Starta av sig själv för den som aldrig sett guiden (när appen är redo). */
  autoStart: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [steps, setSteps] = useState<GuideStep[] | null>(null)
  const [index, setIndex] = useState(0)
  /** Steget som syns: satt först när sidan är rätt och målet hittat. */
  const [shown, setShown] = useState<GuideStep | null>(null)
  const direction = useRef<1 | -1>(1)
  const navigatedFor = useRef<string | null>(null)
  const contextRef = useRef(context)
  contextRef.current = context

  const start = useCallback(() => {
    direction.current = 1
    setIndex(0)
    setShown(null)
    setSteps(stepsFor(contextRef.current))
  }, [])

  const finish = useCallback(() => {
    if (user) {
      rememberLocally(user)
      void markGuideDoneOnAccount()
    }
    setSteps(null)
    setShown(null)
  }, [user])

  // Första inloggningen: fråga kontot (en gång) och starta om guiden aldrig visats.
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!autoStart || !user || asked.current === user) return
    asked.current = user
    if (seenLocally(user)) return
    let cancelled = false
    void guideDoneOnAccount().then((done) => {
      if (cancelled) return
      if (done === true) rememberLocally(user)
      else if (done === false) start()
    })
    return () => {
      cancelled = true
    }
  }, [autoStart, user, start])

  // Gå till stegets sida och vänta tills knappen finns - annars vidare.
  const step = steps?.[index] ?? null
  useEffect(() => {
    if (!steps || !step) return
    setShown(null)
    if (step.route && !routeMatches(step.route, location.pathname, location.hash)) {
      navigatedFor.current = step.id
      navigate(step.route)
      return
    }
    const wait = navigatedFor.current === step.id ? TARGET_WAIT_MS : SAME_PAGE_WAIT_MS
    if (!step.target) {
      setShown(step)
      return
    }
    if (targetOf(step)) {
      setShown(step)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (targetOf(step)) {
        window.clearInterval(timer)
        setShown(step)
      } else if (Date.now() - startedAt > wait) {
        window.clearInterval(timer)
        const next = index + direction.current
        if (next < 0 || next >= steps.length) finish()
        else setIndex(next)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [steps, step, index, location.pathname, location.hash, navigate, finish])

  const api = useMemo(() => ({ start, active: steps !== null }), [start, steps])

  return (
    <GuideCtx.Provider value={api}>
      {children}
      {steps && (
        <div className="guide-layer">
          {shown ? (
            <GuideBubble
              step={shown}
              number={index + 1}
              total={steps.length}
              onNext={() => {
                direction.current = 1
                if (index + 1 < steps.length) setIndex(index + 1)
                else finish()
              }}
              onBack={
                index > 0
                  ? () => {
                      direction.current = -1
                      setIndex(index - 1)
                    }
                  : undefined
              }
              onSkip={finish}
            />
          ) : (
            <div className="guide-dim" aria-hidden="true" />
          )}
        </div>
      )}
    </GuideCtx.Provider>
  )
}

interface Placement {
  spot: { top: number; left: number; width: number; height: number } | null
  bubble: { top: number; left: number }
  side: 'right' | 'left' | 'below' | 'above' | 'center'
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
  const middle = r.top + r.height / 2 - bubbleHeight / 2
  // Smala mål (menyval, knappar): bredvid. Breda mål (tabeller, tavlor): under/över.
  if (r.width < vw / 2 && vw - r.right >= BUBBLE_WIDTH + GAP + 16) {
    return { spot, bubble: { top: clampTop(middle), left: r.right + GAP }, side: 'right' }
  }
  if (r.width < vw / 2 && r.left >= BUBBLE_WIDTH + GAP + 16) {
    return { spot, bubble: { top: clampTop(middle), left: r.left - GAP - BUBBLE_WIDTH }, side: 'left' }
  }
  if (vh - r.bottom >= bubbleHeight + GAP + 16) {
    return { spot, bubble: { top: r.bottom + GAP, left: clampLeft(r.left) }, side: 'below' }
  }
  if (r.top >= bubbleHeight + GAP + 16) {
    return { spot, bubble: { top: r.top - GAP - bubbleHeight, left: clampLeft(r.left) }, side: 'above' }
  }
  // Mycket stort mål: bubblan inuti, nere till höger.
  return { spot, bubble: { top: vh - bubbleHeight - 16, left: vw - BUBBLE_WIDTH - 16 }, side: 'center' }
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
    <>
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
    </>
  )
}
