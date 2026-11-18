import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { requestPageAction } from '../../shared/nav'
import { useTenant } from '../../shared/tenant'
import { HelpLimited, HelpOff, HelpUnavailable, askHelp, getHelpStatus } from './helpApi'
import { ErrorActions } from '../../shared/ErrorNote'
import { BOOQY_FAULT } from '../../shared/errors'
import type { ErrorInfo } from '../../shared/errors'
import { METRICS, resolveLive } from './live'
import { spotlight } from './spotlight'
import { useDodge, useHideOnScroll } from './dodge'
import { usePhoneNav } from '../../shared/dock'
import type { HelpTurn } from './helpApi'
import { OPEN_EVENT, helpChatEnabled, setHelpChatEnabled, withContext } from './chatState'
import type { HelpContext } from './chatState'
import { KB, actionAllowed, actionHref, entryVisible, viewOf } from './kb'
import type { HelpAction, HelpAnswer } from './kb'
import './helpChat.css'

/**
 * Hjälpassistenten: en glaspanel till höger (hela skärmen på mobil) där man
 * frågar hur Booqy fungerar. Svaret är steg för steg ur hjälptexterna och
 * har knappar som tar en direkt till rätt sida, ibland med formuläret öppet.
 * Knapparna kontrolleras här (kb.ts actionAllowed), oavsett vad servern
 * skickar. Samtalet finns bara i fliken och försvinner vid utloggning.
 *
 * Öppnas med knappen nere till höger eller från ⌘K ("Fråga hjälpassistenten").
 * Från ? vid ett steg i Kom igång öppnas den med steget som sammanhang:
 * stegets frågor föreslås och stegets namn följer med varje fråga.
 */

type Message =
  | { id: number; role: 'user'; text: string; sent: string }
  | { id: number; role: 'assistant'; answer: HelpAnswer }
  | { id: number; role: 'notice'; text: string; info?: ErrorInfo; retry?: string }

let nextId = 1

export function HelpChat() {
  const { tenant, status, locationId } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [waiting, setWaiting] = useState(false)
  // Steget man frågar om (Kom igång), och om dess förslag redan använts.
  const [context, setContext] = useState<HelpContext | null>(null)
  const [contextAsked, setContextAsked] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  // Telefon: ingen flytande knapp, Fråga Booqy ligger under Mer i menyn längst ner.
  const phone = usePhoneNav()
  useDodge(launcherRef, enabled && status === 'ready' && !open && !phone)
  useHideOnScroll(launcherRef, enabled && status === 'ready' && !open && !phone)
  const logRef = useRef<HTMLOListElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const panelId = useId()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void getHelpStatus().then((s) => {
      if (!live) return
      setHelpChatEnabled(s.enabled)
      setEnabled(s.enabled)
    })
    return () => {
      live = false
      setHelpChatEnabled(false)
    }
  }, [status])

  const show = useCallback((e?: Event) => {
    if (!helpChatEnabled()) return
    const next = e instanceof CustomEvent ? (e.detail as HelpContext | undefined) : undefined
    if (next) {
      setContext(next)
      setContextAsked(false)
    }
    // Safari fokuserar inte knappar vid klick: då är det <body>, inget att gå tillbaka till.
    const from = document.activeElement
    returnTo.current = from instanceof HTMLElement && from !== document.body ? from : null
    setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
    // Tillbaka dit man var; knappen nere till höger ritas om när panelen stängs.
    // På telefonen öppnades den från arket bakom Mer: tillbaka till Mer.
    // Raden längst ner visas igen först en bild senare (den var gömd under
    // panelen och går inte att fokusera förrän då): två bildrutor.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const more = document.querySelector<HTMLElement>('.bq-dock__more')
        const back = returnTo.current?.isConnected ? returnTo.current : launcherRef.current ?? more
        back?.focus?.()
      }),
    )
  }, [])

  useEffect(() => {
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [show])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, context])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, waiting, context])

  const ask = async (question: string) => {
    const text = question.trim()
    if (!text || waiting) return
    const sent = withContext(text, context)
    const history: HelpTurn[] = messages.flatMap((m): HelpTurn[] =>
      m.role === 'user' ? [{ role: 'user', text: m.sent }] : m.role === 'assistant' ? [{ role: 'assistant', text: m.answer.text }] : [],
    )
    setMessages((ms) => [...ms, { id: nextId++, role: 'user', text, sent }])
    setDraft('')
    setContextAsked(true)
    setWaiting(true)
    try {
      let answer = await askHelp(sent, history, viewOf(tenant))
      if (answer.live) answer = await withLive(answer)
      setMessages((ms) => [...ms, { id: nextId++, role: 'assistant', answer }])
      // En levande siffra visas också där den står (Statistik), upplyst.
      if (answer.live && answer.actions[0] && actionAllowed(answer.actions[0], tenant)) go(answer.actions[0], { keepOpen: true })
    } catch (err) {
      if (err instanceof HelpOff) {
        // Booqy har stängt av assistenten: borta direkt, knappen och ⌘K också.
        turnOff()
        return
      }
      if (err instanceof HelpLimited) {
        setMessages((ms) => [...ms, { id: nextId++, role: 'notice', text: 'Du har ställt många frågor på kort tid. Vänta en stund och fråga igen.' }])
        return
      }
      const fault = err instanceof HelpUnavailable ? err : new HelpUnavailable(null)
      const notice = `Assistenten kunde inte svara just nu. ${BOOQY_FAULT}`
      const info: ErrorInfo = {
        text: notice,
        actor: 'booqy',
        code: fault.code,
        status: fault.status,
        ...(fault.requestId ? { requestId: fault.requestId } : {}),
      }
      setMessages((ms) => [...ms, { id: nextId++, role: 'notice', text: notice, info, retry: text }])
    } finally {
      setWaiting(false)
      inputRef.current?.focus()
    }
  }

  const restart = () => {
    setMessages([])
    setContext(null)
  }

  const turnOff = () => {
    setHelpChatEnabled(false)
    restart()
    close()
    setEnabled(false)
  }

  const withLive = async (answer: HelpAnswer): Promise<HelpAnswer> => {
    const live = answer.live!
    const metric = METRICS[live.metric]
    const isOwner = tenant?.role === 'owner_user'
    let text: string | null = null
    try {
      text = await resolveLive(live, { locationId, timezone: tenant?.locations.find((l) => l.locationId === locationId)?.timezone ?? null, isOwner })
    } catch {
      text = null
    }
    if (text) return { ...answer, text }
    return {
      ...answer,
      text: metric?.money && !isOwner ? 'Den siffran ser bara restaurangens ägare.' : 'Jag kunde inte hämta siffran just nu. Den finns på Statistik.',
    }
  }

  /** Dit knappen pekar, och lys upp målen. Står man redan där skrollar den bara dit. */
  function go(action: HelpAction, opts: { keepOpen?: boolean } = {}) {
    if (!actionAllowed(action, tenant)) return
    const href = actionHref(action)
    const here = `${location.pathname}${location.search}${location.hash}`
    const samePage = location.pathname === action.to && (!action.hash || location.hash === `#${action.hash}`) &&
      Object.entries(action.query ?? {}).every(([k, v]) => new URLSearchParams(location.search).get(k) === v)
    if (action.pageAction) requestPageAction(action.pageAction)
    if (!samePage || (action.pageAction && here !== href)) navigate(href)
    // På mobil täcker panelen sidan: stäng så att man ser dit man kom.
    if (!opts.keepOpen && window.matchMedia?.('(max-width: 600px)').matches) close()
    if (action.highlight?.length) {
      void spotlight(action.highlight).then((lit) => {
        // Panelen får inte skymma det som lyses upp: då stängs den (svaret finns kvar när den öppnas igen).
        const panel = panelRef.current?.getBoundingClientRect()
        const covered = panel && lit.some((el) => {
          const r = el.getBoundingClientRect()
          return r.right > panel.left && r.left < panel.right && r.bottom > panel.top && r.top < panel.bottom && r.width > 0
        })
        if (covered) close()
      })
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void ask(draft)
  }
  const onInputKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void ask(draft)
    }
  }

  if (!enabled || status !== 'ready') return null

  const view = viewOf(tenant)
  const suggestions = KB.entries
    .filter((e) => e.suggestion && entryVisible(e, view))
    .slice(0, 3)
    .map((e) => e.suggestion as string)
  const contextQuestions = context && !contextAsked ? context.questions.slice(0, 3) : []
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <>
      {!open && !phone && (
        <button
          ref={launcherRef}
          type="button"
          className="help-launcher"
          aria-label="Fråga Booqy"
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => show()}
        >
          <Icon name="help" size={18} />
          <span className="help-launcher-text" aria-hidden="true">Fråga Booqy</span>
        </button>
      )}
      {open && (
        <section
          id={panelId}
          ref={panelRef}
          className="help-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        >
          <header className="help-head">
            <div>
              <h2 className="help-title" id={titleId}>
                Hjälpassistenten
              </h2>
              <p className="help-sub">Svarar utifrån Booqys hjälptexter</p>
            </div>
            <div className="help-head-actions">
              {messages.length > 0 && (
                <button type="button" className="help-icon-btn" onClick={restart} aria-label="Börja om">
                  <Icon name="undo" size={16} />
                </button>
              )}
              <button type="button" className="help-icon-btn" onClick={close} aria-label="Stäng hjälpassistenten">
                <Icon name="close" size={16} />
              </button>
            </div>
          </header>

          {context && (
            <div className="help-context">
              <span className="help-context__pill" data-help-context={context.key}>
                <span className="help-context__label">{context.label}</span>
                <button
                  type="button"
                  className="help-context__clear"
                  onClick={() => setContext(null)}
                  aria-label={`Sluta fråga om ${context.label}`}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            </div>
          )}

          <ol className="help-log" ref={logRef} aria-live="polite" aria-label="Samtal">
            {messages.length === 0 && !context && (
              <li className="help-empty">
                <p>Fråga hur något fungerar.</p>
                {suggestions.length > 0 && (
                  <div className="help-suggestions">
                    {suggestions.map((s) => (
                      <button key={s} type="button" className="help-chip" onClick={() => void ask(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="help-msg help-msg--user">
                  <span className="sr-only">Du: </span>
                  {m.text}
                </li>
              ) : m.role === 'notice' ? (
                <li key={m.id} className={`help-msg help-msg--notice${m.info ? ' help-msg--fault' : ''}`}>
                  <span role="status">{m.text}</span>
                  {m.info && (
                    <ErrorActions text={m.text} info={m.info} onRetry={m.retry ? () => void ask(m.retry!) : undefined} />
                  )}
                </li>
              ) : (
                <li key={m.id} className="help-msg help-msg--bot">
                  <span className="sr-only">Assistenten: </span>
                  <p className="help-answer">{m.answer.text}</p>
                  {m.answer.steps.length > 0 && (
                    <ol className="help-steps">
                      {m.answer.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                  <Actions
                    actions={m.answer.actions.filter((a) => actionAllowed(a, tenant))}
                    primary={m.id === lastAssistant}
                    onGo={go}
                  />
                </li>
              ),
            )}
            {contextQuestions.length > 0 && (
              <li className="help-empty help-context-ask">
                <div className="help-suggestions">
                  {contextQuestions.map((s) => (
                    <button key={s} type="button" className="help-chip" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </li>
            )}
            {waiting && (
              <li className="help-msg help-msg--bot help-msg--waiting">
                <Loading variant="inline" label="Letar i hjälpen" />
              </li>
            )}
          </ol>

          <form className="help-compose" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor={`${panelId}-q`}>
              Din fråga
            </label>
            <textarea
              id={`${panelId}-q`}
              ref={inputRef}
              className="help-input"
              rows={1}
              maxLength={500}
              placeholder="Till exempel: Hur lägger jag till en rätt?"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKey}
            />
            <button type="submit" className="help-send" disabled={!draft.trim() || waiting} aria-label="Skicka frågan">
              <Icon name="send" size={18} />
            </button>
          </form>
        </section>
      )}
    </>
  )
}

function Actions({ actions, primary, onGo }: { actions: HelpAction[]; primary: boolean; onGo: (a: HelpAction) => void }) {
  if (actions.length === 0) return null
  return (
    <div className="help-actions">
      {actions.map((a, i) => (
        <button
          key={a.id}
          type="button"
          className={`btn ${primary && i === 0 ? 'primary' : 'outline'} square help-go`}
          onClick={() => onGo(a)}
        >
          {a.label}
          <Icon name="arrow-right" size={16} />
        </button>
      ))}
    </div>
  )
}
