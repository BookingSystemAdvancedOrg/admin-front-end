import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { stepsFor } from './steps'
import type { GuideContext, GuideStep } from './steps'
import { guideDoneOnAccount, markGuideDoneOnAccount, rememberLocally, seenLocally } from './guideApi'
import './guide.css'
import { BackButton } from '../../shared/BackButton'

/**
 * Introduktionsguide ("tutorial") för nya användare av admin-appen.
 *
 * Guiden går sida för sida (Översikt, Inställningar del för del, Meny,
 * Bokningar, Beställningar, Catering, Layout) och visar en bubbla i taget
 * vid knappen eller delen den förklarar (element med `data-tour="..."`);
 * resten av sidan tonas ner. "Nästa" visar nästa bubbla, "Hoppa över"
 * avslutar.
 *
 * Den startar av sig själv EN gång per användare - första gången hen
 * loggar in - och sparas på kontot, så den kommer inte tillbaka på en annan
 * dator. Efter det startas den bara från Hjälp-sidan. När den startar av sig
 * själv stannar den på sidan man öppnade tills man trycker vidare.
 */

interface GuideApi {
  start: () => void
  active: boolean
  /** Målet (data-tour) för steget guiden står på eller väntar på; null utan mål. */
  target: string | null
}

const GuideCtx = createContext<GuideApi>({ start: () => {}, active: false, target: null })

export function useGuide(): GuideApi {
  return useContext(GuideCtx)
}

/** Hur länge guiden väntar på knappen efter ett sidbyte (sidan hämtar data). */
export const TARGET_WAIT_MS = 3000
/** ...och på samma sida (t.ex. platsväljaren som bara finns med flera platser). */
const SAME_PAGE_WAIT_MS = 300

function targetOf(step: GuideStep): HTMLElement | null {
  if (!step.target) return null
  // Samma mål kan finnas två gånger (sidomenyn och telefonens rad eller ark):
  // det som syns. Dolda element (display: none) har ingen yta att peka på.
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)
  return Array.from(all).find((el) => el.getClientRects().length > 0) ?? null
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
  /**
   * Steget som syns. Ligger kvar medan nästa steg laddas (sidbyte), så att
   * ramen och bubblan kan glida från förra målet till nästa.
   */
  const [shown, setShown] = useState<{ step: GuideStep; number: number } | null>(null)
  const direction = useRef<1 | -1>(1)
  const navigatedFor = useRef<string | null>(null)
  const contextRef = useRef(context)
  contextRef.current = context
  /**
   * Startade guiden av sig själv? Då visas välkomststeget på sidan man
   * öppnade (en direktlänk som /meny eller /avtal ska fungera) - guiden byter
   * sida först när användaren själv trycker vidare.
   */
  const stayPut = useRef(false)

  const start = useCallback(() => {
    stayPut.current = false
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
      else if (done === false) {
        start()
        stayPut.current = true
      }
    })
    return () => {
      cancelled = true
    }
  }, [autoStart, user, start])

  // Gå till stegets sida och vänta tills knappen finns - annars vidare.
  const step = steps?.[index] ?? null
  useEffect(() => {
    if (!steps || !step) return
    const keepPage = stayPut.current && index === 0 && !step.target
    if (step.route && !keepPage && !routeMatches(step.route, location.pathname, location.hash)) {
      navigatedFor.current = step.id
      // Ny sida: börja överst, som när man klickar i menyn.
      if (step.route.split('#')[0] !== location.pathname) window.scrollTo({ top: 0 })
      navigate(step.route)
      return
    }
    const wait = navigatedFor.current === step.id ? TARGET_WAIT_MS : SAME_PAGE_WAIT_MS
    const show = () => setShown({ step, number: index + 1 })
    if (!step.target || targetOf(step)) {
      show()
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (targetOf(step)) {
        window.clearInterval(timer)
        show()
      } else if (Date.now() - startedAt > wait) {
        window.clearInterval(timer)
        const next = index + direction.current
        if (next < 0 || next >= steps.length) finish()
        else setIndex(next)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [steps, step, index, location.pathname, location.hash, navigate, finish])

  const target = step?.target ?? null
  const api = useMemo(() => ({ start, active: steps !== null, target }), [start, steps, target])
  const waiting = !shown || shown.step !== step

  return (
    <GuideCtx.Provider value={api}>
      {children}
      {steps && (
        <GuideOverlay
          step={shown?.step ?? null}
          waiting={waiting}
          number={shown?.number ?? 1}
          total={steps.length}
          onNext={() => {
            stayPut.current = false
            direction.current = 1
            if (index + 1 < steps.length) setIndex(index + 1)
            else finish()
          }}
          onBack={
            index > 0
              ? () => {
                  stayPut.current = false
                  direction.current = -1
                  setIndex(index - 1)
                }
              : undefined
          }
          onSkip={finish}
        />
      )}
    </GuideCtx.Provider>
  )
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

interface Placement {
  /** Det upplysta området; mittsteg = en punkt mitt på skärmen (allt tonas ner). */
  spot: Rect
  bubble: { top: number; left: number }
  side: 'right' | 'left' | 'below' | 'above' | 'center'
}

/** Bubblans bredd (samma som i guide.css); smalare skärmar mäter den riktiga. */
const BUBBLE_WIDTH = 340
const GAP = 14
const PAD = 6

function centerPoint(): Rect {
  return { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }
}

function place(step: GuideStep | null, bubbleHeight: number, bubbleWidth = BUBBLE_WIDTH): Placement | null {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const centered: Placement = {
    spot: centerPoint(),
    bubble: { top: Math.max(16, (vh - bubbleHeight) / 2), left: Math.max(16, (vw - bubbleWidth) / 2) },
    side: 'center',
  }
  if (!step || !step.target) return centered
  const el = targetOf(step)
  // Målet är borta (sidan byts): behåll förra läget i stället för att hoppa.
  if (!el) return null
  const r = el.getBoundingClientRect()
  const spot = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
  const clampTop = (t: number) => Math.min(Math.max(16, t), vh - bubbleHeight - 16)
  const clampLeft = (l: number) => Math.min(Math.max(16, l), vw - bubbleWidth - 16)
  const middle = r.top + r.height / 2 - bubbleHeight / 2
  // Smala mål (menyval, knappar): bredvid. Breda mål (tabeller, tavlor): under/över.
  if (r.width < vw / 2 && vw - r.right >= bubbleWidth + GAP + 16) {
    return { spot, bubble: { top: clampTop(middle), left: r.right + GAP }, side: 'right' }
  }
  if (r.width < vw / 2 && r.left >= bubbleWidth + GAP + 16) {
    return { spot, bubble: { top: clampTop(middle), left: r.left - GAP - bubbleWidth }, side: 'left' }
  }
  if (vh - r.bottom >= bubbleHeight + GAP + 16) {
    return { spot, bubble: { top: r.bottom + GAP, left: clampLeft(r.left) }, side: 'below' }
  }
  if (r.top >= bubbleHeight + GAP + 16) {
    return { spot, bubble: { top: r.top - GAP - bubbleHeight, left: clampLeft(r.left) }, side: 'above' }
  }
  // Mycket stort mål (lång bokningslista): lys bara upp den övre delen som
  // får plats och lägg bubblan under den, så att bubblan inte täcker raderna
  // som steget pekar på.
  const capTop = Math.max(spot.top, 8)
  let capBottom = Math.min(spot.top + spot.height, vh - bubbleHeight - GAP - 16)
  // Klipp vid en hel rad, inte mitt i en bokning.
  let rowEnd = 0
  for (const row of el.querySelectorAll('tr, li, [role="row"]')) {
    const b = row.getBoundingClientRect().bottom + PAD
    if (b <= capBottom && b > rowEnd) rowEnd = b
  }
  if (rowEnd - capTop >= 120) capBottom = rowEnd
  if (capBottom - capTop >= 120) {
    return {
      spot: { top: capTop, left: spot.left, width: spot.width, height: capBottom - capTop },
      bubble: { top: capBottom + GAP, left: clampLeft(r.left) },
      side: 'below',
    }
  }
  // Inget annat går: bubblan inuti, nere till höger.
  return { spot, bubble: { top: vh - bubbleHeight - 16, left: vw - bubbleWidth - 16 }, side: 'center' }
}

/**
 * Ramen och bubblan ritas EN gång och ligger kvar genom hela guiden; bara
 * position och storlek ändras. CSS-övergångarna får dem då att glida från
 * förra målet till nästa - även när guiden byter sida - i stället för att
 * ritas om från skärmens hörn.
 */
function GuideOverlay({
  step,
  waiting,
  number,
  total,
  onNext,
  onBack,
  onSkip,
}: {
  step: GuideStep | null
  waiting: boolean
  number: number
  total: number
  onNext: () => void
  onBack?: () => void
  onSkip: () => void
}) {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState<Placement>(() => place(null, 180)!)
  // Övergångar först efter första uppritningen - annars glider allt in från hörnet.
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setAnimate(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  useLayoutEffect(() => {
    const el = step ? targetOf(step) : null
    if (el) {
      // Under det fasta sidhuvudet eller utanför skärmen: centrera målet.
      const r = el.getBoundingClientRect()
      const hidden = r.top < 100 && window.scrollY > 0 ? true : r.bottom > window.innerHeight
      el.scrollIntoView({ block: hidden ? 'center' : 'nearest', inline: 'nearest' })
    }
    const update = () => {
      const next = place(step, bubbleRef.current?.offsetHeight ?? 180, bubbleRef.current?.offsetWidth || BUBBLE_WIDTH)
      if (next) setPlacement(next)
    }
    // Målet glider in (telefonens ark bakom Mer): mät igen när det står still,
    // och rulla fram det om det då ligger utanför skärmen.
    const settled = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.guide-layer')) return
      const now = step ? targetOf(step) : null
      if (now) {
        const r = now.getBoundingClientRect()
        if (r.top < 0 || r.bottom > window.innerHeight) now.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      update()
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    document.addEventListener('animationend', settled, true)
    document.addEventListener('transitionend', settled, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('animationend', settled, true)
      document.removeEventListener('transitionend', settled, true)
    }
  }, [step])

  useEffect(() => {
    if (step && !waiting) nextRef.current?.focus()
  }, [step, waiting])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const last = number === total
  const titleId = step ? `guide-title-${step.id}` : undefined

  return (
    <div className={`guide-layer${animate ? ' guide-layer--animate' : ''}`}>
      <div className="guide-spot" style={placement.spot} aria-hidden="true" />
      {step && (
        <div
          ref={bubbleRef}
          className={`guide-bubble guide-bubble--${placement.side}${waiting ? ' guide-bubble--waiting' : ''}`}
          style={{ top: placement.bubble.top, left: placement.bubble.left }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-hidden={waiting || undefined}
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
                <BackButton onClick={onBack} />
              )}
              <button ref={nextRef} type="button" className="btn primary square" onClick={onNext}>
                {number === 1 ? 'Visa mig' : last ? 'Klar' : 'Nästa'}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
