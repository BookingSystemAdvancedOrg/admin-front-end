import type { ReactNode } from 'react'
import { Bar, Button, Card } from '@booqy/brand'
import { Icon } from '../../shared/Icon'
import { formatPhone } from '../../shared/phone'
import { MODE_LABEL, OPERATORS, SETUP, type Config, type LocationConfig } from './api'
import { STEPS, firstOpen, progress, type Step } from './setup'

/**
 * Vy A: "Kom igång med telefonassistenten". En rad per steg med bock eller
 * ring; en rad öppnar guiden på det steget. Under listan: Fler inställningar.
 */
export default function SetupChecklist({ config, loc, onOpen, children }: {
  config: Config
  loc: LocationConfig
  onOpen: (step: Step) => void
  /** Fler inställningar (hopfällt). */
  children?: ReactNode
}) {
  const done = progress(config, loc)
  const next = firstOpen(done)
  const offCodes = (loc.forwarding?.codes ?? []).map((c) => c.off).join(' och ')
  const values: Record<Step, ReactNode> = {
    namn: config.agentName,
    tider: MODE_LABEL[loc.mode],
    nummer: loc.number ? <span className="telefon-mono">{formatPhone(loc.number)}</span> : null,
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
          <span className="telefon-done"><Icon name="check" size={20} /> Klart! Assistenten svarar på {loc.number ? formatPhone(loc.number) : 'ert Booqy-nummer'}.</span>
        </Bar>
      )}
      {children}
    </Card>
  )
}
