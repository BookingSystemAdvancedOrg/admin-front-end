import './connection-notice.css'

/**
 * Liten, lugn rad längst ner när servern inte går att nå. Man är fortfarande
 * inloggad: appen försöker igen av sig själv och raden försvinner när
 * kontakten är tillbaka.
 */
export function ConnectionNotice() {
  return (
    <div className="connection-notice" role="status" aria-live="polite">
      <span className="connection-notice__dot" aria-hidden="true" />
      Ingen kontakt med servern, försöker igen...
    </div>
  )
}
