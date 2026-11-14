import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { requestPageAction } from '../../shared/nav'
import { useTenant } from '../../shared/tenant'
import { HelpLimited, askHelp, getHelpStatus } from './helpApi'
import { METRICS, resolveLive } from './live'
import { spotlight } from './spotlight'
import { useDodge } from './dodge'
import type { HelpTurn } from './helpApi'
import { OPEN_EVENT, helpChatEnabled, setHelpChatEnabled } from './chatState'
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
 */

type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; answer: HelpAnswer }
  | { id: number; role: 'notice'; text: string }

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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  useDodge(launcherRef, enabled && status === 'ready' && !open)
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

  const show = useCallback(() => {
    if (!helpChatEnabled()) return
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
    // Tillbaka dit man var; knappen nere till höger ritas om när panelen stängs.
    requestAnimationFrame(() => {
      const back = returnTo.current?.isConnected ? returnTo.current : launcherRef.current
      back?.focus?.()
    })
  }, [])

  useEffect(() => {
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [show])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, waiting])

  const ask = async (question: string) => {
    const text = question.trim()
    if (!text || waiting) return
    const history: HelpTurn[] = messages.flatMap((m): HelpTurn[] =>
      m.role === 'user' ? [{ role: 'user', text: m.text }] : m.role === 'assistant' ? [{ role: 'assistant', text: m.answer.text }] : [],
    )
    setMessages((ms) => [...ms, { id: nextId++, role: 'user', text }])
    setDraft('')
    setWaiting(true)
    try {
      let answer = await askHelp(text, history, viewOf(tenant))
      if (answer.live) answer = await withLive(answer)
      setMessages((ms) => [...ms, { id: nextId++, role: 'assistant', answer }])
      // En levande siffra visas också där den står (Statistik), upplyst.
      if (answer.live && answer.actions[0] && actionAllowed(answer.actions[0], tenant)) go(answer.actions[0], { keepOpen: true })
    } catch (err) {
      const notice =
        err instanceof HelpLimited
          ? 'Du har ställt många frågor på kort tid. Vänta en stund och fråga igen.'
          : 'Det gick inte att få ett svar just nu. Felet ligger hos Booqy, inte hos dig: fråga igen, eller öppna hjälptexterna under Hjälp.'
      setMessages((ms) => [...ms, { id: nextId++, role: 'notice', text: notice }])
    } finally {
      setWaiting(false)
      inputRef.current?.focus()
    }
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
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className="help-launcher"
          aria-expanded={false}
          aria-controls={panelId}
          onClick={show}
        >
          <Icon name="help" size={18} />
          <span className="help-launcher-text">Fråga Booqy</span>
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
                <button type="button" className="help-icon-btn" onClick={() => setMessages([])} aria-label="Börja om">
                  <Icon name="undo" size={16} />
                </button>
              )}
              <button type="button" className="help-icon-btn" onClick={close} aria-label="Stäng hjälpassistenten">
                <Icon name="close" size={16} />
              </button>
            </div>
          </header>

          <ol className="help-log" ref={logRef} role="log" aria-live="polite" aria-label="Samtal">
            {messages.length === 0 && (
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
                <li key={m.id} className="help-msg help-msg--notice" role="status">
                  {m.text}
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
