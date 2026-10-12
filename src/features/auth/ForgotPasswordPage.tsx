import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { requestPasswordReset } from './cognito'
import { EMAIL_PATTERN } from './resetLink'

/**
 * "Glömt lösenordet?": skickar ett mejl med en länk till /aterstall-losenord
 * där man väljer ett nytt lösenord (backend /auth/forgot-password). Svaret är
 * detsamma oavsett om adressen har ett konto, så sidan säger "finns det ett
 * konto …" - den avslöjar aldrig vilka adresser som har konton.
 */
export default function ForgotPasswordPage() {
  const location = useLocation()
  const [email, setEmail] = useState(
    () => (location.state as { email?: string } | null)?.email ?? '',
  )
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const address = email.trim()
    if (!EMAIL_PATTERN.test(address)) {
      setError('Fyll i en giltig e-postadress.')
      return
    }
    setBusy(true)
    try {
      await requestPasswordReset(address)
      setSentTo(address)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Det gick inte att skicka mejlet.')
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <div className="auth-heading">
          <h1>Kolla din e-post</h1>
          <p>
            Finns det ett konto för <strong>{sentTo}</strong> har vi skickat ett mejl med en
            länk där du väljer ett nytt lösenord. Länken gäller i en timme.
          </p>
        </div>

        <div className="auth-notes">
          <p>
            Inget mejl efter några minuter? Titta i skräpposten, eller{' '}
            <button type="button" className="auth-link" onClick={() => setSentTo(null)}>
              skicka igen
            </button>
            .
          </p>
          <p>
            Står det en kod i mejlet i stället för en länk?{' '}
            <Link className="auth-link" to="/aterstall-losenord" state={{ email: sentTo }}>
              Ange koden här
            </Link>
            .
          </p>
          <p>Har du aldrig loggat in? Använd det tillfälliga lösenordet i inbjudan.</p>
        </div>

        <Link className="auth-link" to="/logga-in" state={{ email: sentTo }}>
          Tillbaka till inloggningen
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="auth-heading">
        <h1>Glömt lösenordet?</h1>
        <p>Fyll i din e-postadress så skickar vi en länk där du väljer ett nytt lösenord.</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-fields">
          <div className="auth-field">
            <label htmlFor="forgot-email">E-post</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="namn@domän.se"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>
        </div>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Skickar…' : 'Skicka länk'}
        </button>
      </form>

      <Link className="auth-link" to="/logga-in" state={{ email: email.trim() }}>
        Tillbaka till inloggningen
      </Link>
    </AuthLayout>
  )
}
