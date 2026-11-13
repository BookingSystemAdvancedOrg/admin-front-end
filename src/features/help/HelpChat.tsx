import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { requestPageAction } from '../../shared/nav'
import { useTenant } from '../../shared/tenant'
import { HelpLimited, askHelp, getHelpStatus } from './helpApi'
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
  const { tenant, status } = useTenant()
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [waiting, setWaiting] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const panelId = useId()

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
      const answer = await askHelp(text, history, viewOf(tenant))
      setMessages((ms) => [...ms, { id: nextId++, role: 'assistant', answer }])
    } catch (err) {
      const notice =
        err instanceof HelpLimited
          ? 'Du har ställt många frågor på kort tid. Vänta en stund och fråga igen.'
          : 'Det gick inte att få ett svar just nu. Försök igen om en stund.'
      setMessages((ms) => [...ms, { id: nextId++, role: 'notice', text: notice }])
    } finally {
      setWaiting(false)
      inputRef.current?.focus()
    }
  }

  const go = (action: HelpAction) => {
    if (!actionAllowed(action, tenant)) return
    if (action.pageAction) requestPageAction(action.pageAction)
    navigate(actionHref(action))
    // På mobil täcker panelen sidan: stäng så att man ser dit man kom.
    if (window.matchMedia?.('(max-width: 600px)').matches) close()
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
                <p>Fråga hur något fungerar i Booqy, så visar jag stegen och tar dig dit.</p>
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
