import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { isMockAuthEnabled, MOCK_EMAIL, MOCK_PASSWORD } from './mockAuth'
import { useAuth } from './useAuth'
import { AuthLayout } from './AuthLayout'

/** Figma: personal-inloggning-page (41:2). */
export default function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Sidan användaren försökte nå innan RequireAuth skickade hit dem.
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? '/'

  // Redan inloggad? Gå direkt till admin-panelen.
  if (status === 'signed-in') {
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const result = await login(email, password)
      if (result === 'new-password') {
        navigate('/nytt-losenord')
      } else {
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inloggningen misslyckades.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-heading">
        <h1>Logga in</h1>
        <p>Personal &amp; ägare — KÄLLA Sveavägen 42</p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-fields">
          <div className="auth-field">
            <label htmlFor="login-email">E-post</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="anna@kallarestaurang.se"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="login-password">Lösenord</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
          {busy ? 'Loggar in…' : 'Logga in'}
        </button>
      </form>

      {isMockAuthEnabled() ? (
        <p className="auth-hint">
          Utveckling: {MOCK_EMAIL} / {MOCK_PASSWORD}
        </p>
      ) : (
        <p className="auth-hint">
          Första gången? Du hittar ett tillfälligt lösenord i din
          inbjudningsmejl från Cognito.
        </p>
      )}
    </AuthLayout>
  )
}
