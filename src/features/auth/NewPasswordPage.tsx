import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { AuthLayout } from './AuthLayout'
import { meetsAllRules, passwordProblem } from './passwordRules'
import { PasswordRulesList } from './PasswordRulesList'

/** Figma: nytt-losenord-page (41:26). */
export default function NewPasswordPage() {
  const { hasPendingNewPassword, finishNewPassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Sidan kräver en pågående inloggning med tillfälligt lösenord.
  if (!hasPendingNewPassword) {
    return <Navigate to="/logga-in" replace />
  }

  const allRulesMet = meetsAllRules(password)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const problem = passwordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await finishNewPassword(password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Det gick inte att byta lösenord.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-heading">
        <h1>Välj ett nytt lösenord</h1>
        <p>
          Det här är första gången du loggar in. Ange ett nytt lösenord för att
          aktivera ditt konto.
        </p>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-fields">
          <div className="auth-field">
            <label htmlFor="new-password">Nytt lösenord</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="confirm-password">Bekräfta lösenord</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
        </div>

        <PasswordRulesList password={password} />

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="auth-submit"
          type="submit"
          disabled={busy || !allRulesMet || confirm.length === 0}
        >
          {busy ? 'Aktiverar…' : 'Aktivera konto'}
        </button>
      </form>
    </AuthLayout>
  )
}
