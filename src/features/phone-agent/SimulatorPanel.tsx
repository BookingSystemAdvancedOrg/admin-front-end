import { useState } from 'react'
import { Bar, Button, Field, Input } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { ERRORS, langLabel, newId, simulate, type Lang } from './api'
import { ErrorActions } from '../../shared/ErrorNote'

interface Line { who: 'du' | 'assistenten'; text: string; lang?: Lang }

/** "Prova att skriva" (under Fler inställningar): skriv som om du ringde och läs assistentens svar. Ingenting bokas på riktigt. */
export default function SimulatorPanel({ locationId }: { locationId: string }) {
  const [session, setSession] = useState(newId)
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const said = text.trim()
    if (!said) return
    setBusy(true)
    setError(null)
    try {
      const out = await simulate(locationId, session, said)
      setLines((prev) => [...prev, { who: 'du', text: said }, { who: 'assistenten', text: out.reply, lang: out.language }])
      setText('')
    } catch (err) {
      setError(errorText(err, 'Assistenten svarade inte.', ERRORS))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="telefon-sim">
      {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
      <ol className="telefon-transcript" aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className={`telefon-turn telefon-turn--${l.who === 'du' ? 'caller' : 'agent'}`}>
            <span className="telefon-turn__who">
              {l.who === 'du' ? 'Du' : 'Assistenten'}
              {l.lang && l.lang !== 'sv' ? <span className="telefon-turn__lang"> på {langLabel(l.lang)}</span> : null}
            </span>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={send} aria-label="Prova assistenten">
        <Field label="Du säger">
          <Input value={text} maxLength={500} placeholder="Hej, jag vill boka ett bord för fyra imorgon klockan 19" onChange={(e) => setText(e.target.value)} />
        </Field>
        <Bar variant="action" label="Skicka">
          <Button variant="ghost" type="button" onClick={() => { setSession(newId()); setLines([]) }}>Börja om</Button>
          <Button type="submit" busy={busy} busyLabel="Väntar på svar…" disabled={!text.trim()}>Skicka</Button>
        </Bar>
      </form>
    </div>
  )
}
