import { useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { ApiError } from './api'
import { errorInfo, type ErrorInfo } from './errors'
import { Icon } from './Icon'
import { refreshNow } from './live'
import { sendReport } from './supportReport'
import './errorNote.css'

type ReportState = { for: string; state: 'sending' | 'sent' | 'duplicate' | 'failed' | 'limited' }

/**
 * Felrutan: texten från errorText plus det användaren kan göra.
 *
 * - Fel användaren åtgärdar själv med en plats att gå till: en knapp dit
 *   ("Öppna Avtal" -> /avtal).
 * - Fel som ligger hos Booqy: Försök igen (sidans egen `onRetry`, annars
 *   hämtas allt som syns om) och Rapportera till Booqy (ett klick, se
 *   supportReport.ts för vad som skickas).
 * - Text som inte kom från errorText (en sidas egen regel, "Fyll i namn.")
 *   visas som förut, utan knappar.
 */
export function ErrorNote({
  text,
  className = 'form-error',
  onRetry,
  info: given,
  id,
}: {
  text: string | null | undefined
  className?: string
  onRetry?: () => void
  /** Vem som gör något, när sidan vet det själv (annars slås texten upp). */
  info?: ErrorInfo
  id?: string
}) {
  if (!text) return null
  const info = given ?? errorInfo(text)
  if (!hasActions(info)) {
    return <p id={id} className={className} role="alert">{text}</p>
  }
  return (
    <div id={id} className={`${className} error-note`} role="alert">
      <p className="error-note-text">{text}</p>
      <ErrorActions text={text} info={info} onRetry={onRetry} />
    </div>
  )
}

function hasActions(info: ErrorInfo | undefined): info is ErrorInfo {
  return Boolean(info && (info.actor === 'booqy' || info.link))
}

/**
 * Bara knapparna (och kvittot efter en rapport), för fel som visas i en
 * annan ruta, t.ex. <Bar variant="banner" action={<ErrorActions text={error} />}>.
 */
export function ErrorActions({
  text,
  info: given,
  onRetry,
}: {
  text: string | null | undefined
  info?: ErrorInfo
  onRetry?: () => void
}) {
  const [report, setReport] = useState<ReportState | null>(null)
  const info = given ?? errorInfo(text)
  if (!text || !hasActions(info)) return null
  const mine = report?.for === text ? report.state : null

  async function onReport() {
    if (!info || !text) return
    setReport({ for: text, state: 'sending' })
    try {
      const result = await sendReport(info)
      setReport({ for: text, state: result })
    } catch (err) {
      setReport({ for: text, state: err instanceof ApiError && err.status === 429 ? 'limited' : 'failed' })
    }
  }

  return (
    <div className="error-note-body">
      <div className="error-note-actions">
        {info.actor === 'user' && info.link && <GoTo link={info.link} />}
        {info.actor === 'booqy' && (
          <>
            <button type="button" className="btn outline square" onClick={() => (onRetry ? onRetry() : refreshNow())}>
              <Icon name="rotate" size={16} />
              Försök igen
            </button>
            {mine === 'sent' || mine === 'duplicate' ? null : (
              <button type="button" className="btn outline square" onClick={() => void onReport()} disabled={mine === 'sending'}>
                <Icon name="send" size={16} />
                {mine === 'sending' ? 'Skickar…' : 'Rapportera till Booqy'}
              </button>
            )}
          </>
        )}
      </div>
      {mine && mine !== 'sending' && (
        <p className="error-note-status" role="status">
          {mine === 'sent' && 'Tack. Booqy har fått rapporten och tittar på felet.'}
          {mine === 'duplicate' && 'Booqy har redan fått en rapport om det här felet. Tack.'}
          {mine === 'limited' && 'Du har skickat många rapporter den senaste timmen. Vänta en stund och försök igen.'}
          {mine === 'failed' && 'Rapporten kom inte fram. Kontrollera internetanslutningen och tryck Rapportera till Booqy igen.'}
        </p>
      )}
    </div>
  )
}

function GoTo({ link }: { link: { to: string; label: string } }) {
  const inRouter = useInRouterContext()
  const content = (
    <>
      {link.label}
      <Icon name="arrow-right" size={16} />
    </>
  )
  return inRouter ? (
    <Link to={link.to} className="btn outline square">{content}</Link>
  ) : (
    <a href={link.to} className="btn outline square">{content}</a>
  )
}
