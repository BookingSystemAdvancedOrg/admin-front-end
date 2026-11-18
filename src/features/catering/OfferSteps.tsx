import { Icon } from '../../shared/Icon'
import { TitleInfo } from '../../shared/TitleInfo'
import { ErrorNote } from '../../shared/ErrorNote'
import { RestaurantSigning } from './RestaurantSigning'
import { offerStep } from './cateringApi'
import type { CateringRequest, OfferStep } from './cateringApi'

export const OFFER_STEPS = ['Granska offerten', 'Signera med BankID', 'Skicka till kunden'] as const

/** De tre stegen med det aktuella markerat och de klara bockade. */
export function OfferStepList({ step }: { step: OfferStep }) {
  return (
    <ol className="offer-steps" aria-label="Steg">
      {OFFER_STEPS.map((label, i) => {
        const n = i + 1
        const done = step > n
        const current = step === n
        return (
          <li key={label} className={done ? 'is-done' : current ? 'is-current' : undefined}
            aria-current={current ? 'step' : undefined}>
            <span className="offer-step-dot" aria-hidden="true">{done ? <Icon name="check" size={16} /> : n}</span>
            <span className="offer-step-label">
              {label}
              {done && <span className="sr-only"> (klart)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Offertens ordning, så enkel att ett barn förstår den: 1 granska, 2 signera
 * med BankID, 3 skicka till kunden. Skicka är låst tills restaurangen har
 * signerat den aktuella versionen (servern nekar också, 409
 * restaurant_signature_required). Varje ny version börjar om på steg 2.
 */
export function OfferSteps({ request, canAct, returned, onSigned, onSend, sending, sendError }: {
  request: CateringRequest
  /** Ägaren: signerar och skickar. Personal ser bara stegen. */
  canAct: boolean
  /** Tillbaka från signeringstjänstens sida (?signering=klar). */
  returned: boolean
  onSigned: (r?: CateringRequest) => void
  onSend: () => void
  sending: boolean
  /** Senaste Skicka misslyckades: vad som hände och vem som gör något. */
  sendError?: string | null
}) {
  const step = offerStep(request)
  const version = request.currentOfferVersion
  return (
    <section className="admin-card table-card offer-steps-card" aria-label="Offertens steg">
      <div className="card-head">
        <TitleInfo
          title={step === 1 ? 'Offert' : `Offert v${version}`}
          info="Alltid i den här ordningen. Kunden får offerten först när ni har signerat den med BankID och skickat den. En ny version måste signeras igen. Sedan signerar kunden med BankID."
        />
      </div>
      <OfferStepList step={step} />
      {canAct && step < 4 && (
        <div className="offer-steps-actions">
          {step === 2 && <RestaurantSigning request={request} onSigned={onSigned} returned={returned} />}
          {step === 3 ? (
            <button type="button" className="btn primary square" disabled={sending} onClick={onSend}>
              <Icon name="send" size={16} />
              {sending ? 'Skickar…' : 'Skicka till kunden'}
            </button>
          ) : (
            <span className="offer-send-locked">
              <button type="button" className="btn outline square" disabled aria-describedby="offer-send-lock">
                <Icon name="lock" size={16} />
                Skicka till kunden
              </button>
              <span id="offer-send-lock" className="offer-lock-reason">Signera med BankID först</span>
            </span>
          )}
        </div>
      )}
      {canAct && step === 3 && <ErrorNote text={sendError ?? null} />}
      {step === 4 && (
        <p className="offer-steps-done" role="status">
          <Icon name="check" size={16} />
          Skickad. Kunden signerar med BankID.
        </p>
      )}
    </section>
  )
}
