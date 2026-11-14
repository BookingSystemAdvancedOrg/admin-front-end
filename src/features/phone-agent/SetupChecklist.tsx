import type { ReactNode } from 'react'
import { Bar, Button, Card } from '@booqy/brand'
import { Icon } from '../../shared/Icon'
import { formatPhone } from '../../shared/phone'
import { MODE_LABEL, OPERATORS, SETUP, type Config, type LocationConfig } from './api'
import { STEPS, firstOpen, forwardTarget, progress, type Step } from './setup'

/**
 * Vy A: "Kom igång med telefonassistenten". En rad per steg med bock eller
 * ring; en rad öppnar guiden på det steget. Under listan: Fler inställningar.
 */
export default function SetupChecklist({ config, loc, restaurantPhone, onOpen, children }: {
  config: Config
  loc: LocationConfig
  /** Restaurangens eget nummer, det gästerna ringer. */
  restaurantPhone: string | null
  onOpen: (step: Step) => void
  /** Fler inställningar (hopfällt). */
  children?: ReactNode
}) {
  const done = progress(config, loc)
  const next = firstOpen(done)
  const offCodes = (loc.forwarding?.codes ?? []).map((c) => c.off).join(' och ')
  const target = forwardTarget(loc)
  const when = MODE_LABEL[loc.mode].toLowerCase()
  const values: Record<Step, ReactNode> = {
    namn: config.agentName,
    tider: MODE_LABEL[loc.mode],
    nummer: target ? <span className="telefon-mono">{formatPhone(target)}</span> : null,
    koppla: (
      <>
        {OPERATORS[loc.setup?.operator ?? 'other']}
        {offCodes ? <>, stäng av: <span className="telefon-mono">{offCodes}</span></> : null}
      </>
    ),
    prova: 'Fungerar',
  }
  const started = STEPS.some((s) => done[s])

  return (
    <Card title="Kom igång med telefonassistenten">
      <ol className="telefon-checklist">
        {STEPS.map((step, i) => (
          <li key={step}>
            <button type="button" className={`telefon-checklist__row${done[step] ? ' is-done' : ''}`} onClick={() => onOpen(step)}>
              <Icon name={done[step] ? 'check' : 'circle'} size={20} className="telefon-checklist__icon" />
              <span className="telefon-checklist__label">{SETUP.STEP_LABEL[i]}</span>
              {done[step] ? <span className="telefon-checklist__value">{values[step]}</span> : null}
              <span className="bq-sr-only">{done[step] ? ', klart' : ', inte klart'}</span>
            </button>
          </li>
        ))}
      </ol>
      {next ? (
        <Button variant="primary" wide className="telefon-big" onClick={() => onOpen(next)}>
          {started ? SETUP.buttons.cont(SETUP.STEP_LABEL[STEPS.indexOf(next)]) : SETUP.buttons.start}
        </Button>
      ) : (
        <Bar variant="banner" tone="success">
          <span className="telefon-done"><Icon name="check" size={20} /> <span>Klart! {restaurantPhone ? <>Samtal till <span className="telefon-mono telefon-nowrap">{formatPhone(restaurantPhone)}</span></> : 'Era samtal'} går till assistenten {when}.</span></span>
        </Bar>
      )}
      {children}
    </Card>
  )
}
