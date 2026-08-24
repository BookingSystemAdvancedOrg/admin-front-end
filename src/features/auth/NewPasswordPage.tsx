import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { AuthLayout } from './AuthLayout'

/**
 * Lösenordskraven som visas i checklistan. Håll dem i synk med
 * User Poolens password policy i AWS (se docs/API-OCH-NYCKLAR.md).
 */
const RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  { id: 'length', label: 'Minst 8 tecken', test: (pw) => pw.length >= 8 },
  {
    id: 'upper',
    label: 'Minst en stor bokstav',
    // Cognito räknar A–Z (inte Å/Ä/Ö) som versaler i sin policy, så vi
    // kräver detsamma här för att aldrig godkänna något Cognito nekar.
    test: (pw) => /[A-Z]/.test(pw),
  },
  { id: 'digit', label: 'Minst en siffra', test: (pw) => /\d/.test(pw) },
]

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

  const allRulesMet = RULES.every((rule) => rule.test(password))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (!allRulesMet) {
      setError('Lösenordet uppfyller inte alla krav ännu.')
      return
    }
    if (password !== confirm) {
      setError('Lösenorden matchar inte.')
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

        <ul className="auth-rules" aria-label="Lösenordskrav">
          {RULES.map((rule) => {
            const met = rule.test(password)
            return (
              <li
                key={rule.id}
                className={met ? 'auth-rule met' : 'auth-rule'}
              >
                <span aria-hidden="true">{met ? '✓' : '○'}</span>
                {rule.label}
              </li>
            )
          })}
        </ul>

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
