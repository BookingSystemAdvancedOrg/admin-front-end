import { Link } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { openHelpChat } from '../help/chatState'
import type { SetupStep } from './overview'
import { setupContext } from './setupHelp'

/**
 * En rad i Kom igång: raden länkar till steget, ? bredvid öppnar Fråga Booqy
 * med steget som sammanhang, och varje delsteg (telefonassistenten) frågar
 * om just det delsteget. askOn = assistenten är på för restaurangen.
 * onSkip: "Hoppa över" på ett steg som är kvar, "Ångra" på ett överhoppat.
 */
export function SetupStepItem({ step, askOn, onSkip, busy = false }: {
  step: SetupStep
  askOn: boolean
  onSkip?: (step: SetupStep, skipped: boolean) => void
  busy?: boolean
}) {
  // Kvar eller okänt (kunde inte kontrolleras): ägaren kan alltid hoppa över ett valbart steg.
  const canSkip = Boolean(onSkip) && step.skippable && step.done !== true
  const canUndo = Boolean(onSkip) && step.skippedHere && step.state === 'skipped'
  return (
    <div className="activity-item setup-step">
      <div className="setup-step__row">
        <Link to={step.to} className="setup-step__link">
          <span className="activity-text">
            <span className={`setup-check ${step.state === 'done' ? 'done' : step.later ? 'later' : ''}`} aria-hidden="true">
              {step.state === 'done' ? <Icon name="check" size={14} /> : step.done === null ? '?' : ''}
            </span>
            <span className="setup-step__label">{step.label}</span>
          </span>
          <span className={`activity-time${step.later ? ' setup-later' : ''}`}>
            {step.state === 'done' ? 'Klart' : step.later ?? (step.done === null ? 'Kunde inte kontrolleras' : 'Att göra')}
          </span>
        </Link>
        {canSkip || canUndo ? (
          <button
            type="button"
            className="link-action setup-skip"
            disabled={busy}
            aria-label={`${canSkip ? 'Hoppa över' : 'Ångra överhoppat'}: ${step.label}`}
            onClick={() => onSkip?.(step, canSkip)}
          >
            {canSkip ? 'Hoppa över' : 'Ångra'}
          </button>
        ) : null}
        {askOn ? (
          <button
            type="button"
            className="setup-ask"
            aria-label={`Fråga Booqy om ${step.label}`}
            title="Fråga Booqy"
            data-setup-ask={step.id}
            onClick={() => openHelpChat(setupContext(step.id, step.label))}
          >
            <Icon name="help" size={16} />
          </button>
        ) : null}
      </div>
      {step.sub ? (
        <span className="setup-sub" role="group" aria-label={`${step.sub.filter((x) => x.done).length} av ${step.sub.length} delsteg klara`}>
          {step.sub.map((x) =>
            askOn ? (
              <button
                key={x.id}
                type="button"
                className={`setup-sub__item setup-sub__ask${x.done ? ' done' : ''}`}
                aria-label={`Fråga Booqy om ${x.label}${x.done ? ', klart' : ''}`}
                title="Fråga Booqy"
                data-setup-ask={`phone:${x.id}`}
                onClick={() => openHelpChat(setupContext(`phone:${x.id}`, x.label))}
              >
                {x.done ? <Icon name="check" size={12} /> : null}
                {x.label}
                <Icon name="help" size={12} className="setup-sub__q" />
              </button>
            ) : (
              <span key={x.id} className={`setup-sub__item${x.done ? ' done' : ''}`}>
                {x.done ? <Icon name="check" size={12} /> : null}
                {x.label}
              </span>
            ),
          )}
        </span>
      ) : null}
    </div>
  )
}
