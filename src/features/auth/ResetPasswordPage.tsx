import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { PasswordResetError, confirmPasswordReset } from './cognito'
import { meetsAllRules, passwordProblem } from './passwordRules'
import { PasswordRulesList } from './PasswordRulesList'
import { CODE_PATTERN, EMAIL_PATTERN, parseResetLink } from './resetLink'
import { useAuth } from './useAuth'

/**
 * Välj ett nytt lösenord (backend /auth/reset-password).
 *
 * Från länken i mejlet (#code=…&email=…) behövs bara det nya lösenordet;
 * koden och adressen tas bort ur adressfältet direkt. Utan länk (mejlet
 * visade en kod) fyller man i e-post och kod själv. Efter bytet loggas man
 * in direkt.
 */
export default function ResetPasswordPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { login } = useAuth()
  // Läses en gång, innan fragmentet tas bort nedan.
  const [link] = useState(() => parseResetLink(location.hash))
  const [email, setEmail] = useState(
    () => link?.email ?? (location.state as { email?: string } | null)?.email ?? '',
  )
  const [code, setCode] = useState(() => link?.code ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<{ text: string; newLink: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)

  // Koden ska inte ligga kvar i adressfältet eller historiken.
  useEffect(() => {
    if (location.hash) {
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: location.state },
      )
    }
  }, [location, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const address = email.trim()
    const digits = code.replace(/\s+/g, '')
    const problem = !EMAIL_PATTERN.test(address)
      ? 'Fyll i en giltig e-postadress.'
      : !CODE_PATTERN.test(digits)
        ? 'Koden är de sex siffrorna i mejlet.'
        : passwordProblem(password, confirm)
    if (problem) {
      setError({ text: problem, newLink: false })
      return
    }
    setBusy(true)
    try {
      await confirmPasswordReset(address, digits, password)
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : 'Det gick inte att byta lösenord.',
        newLink: err instanceof PasswordResetError && err.needsNewLink,
      })
      setBusy(false)
      return
    }
    // Lösenordet är bytt - logga in direkt med det.
    try {
      const result = await login(address, password)
      navigate(result === 'new-password' ? '/nytt-losenord' : '/', { replace: true })
    } catch {
      setChanged(true)
      setBusy(false)
    }
  }

  if (changed) {
    return (
      <AuthLayout>
        <div className="auth-heading">
          <h1>Lösenordet är bytt</h1>
          <p>Logga in med ditt nya lösenord.</p>
        </div>
        <Link className="auth-submit" to="/logga-in" state={{ email: email.trim() }}>
          Till inloggningen
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="auth-heading">
        <h1>Välj ett nytt lösenord</h1>
        {link ? (
          <p>
            För <strong>{link.email}</strong>.
          </p>
        ) : (
          <p>Fyll i din e-postadress och koden från mejlet, och välj ett nytt lösenord.</p>
        )}
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-fields">
          {!link && (
            <>
              <div className="auth-field">
                <label htmlFor="reset-email">E-post</label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  placeholder="namn@domän.se"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="auth-field">
                <label htmlFor="reset-code">Kod från mejlet</label>
                <input
                  id="reset-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={12}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          <div className="auth-field">
            <label htmlFor="reset-password">Nytt lösenord</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={Boolean(link)}
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="reset-confirm">Bekräfta lösenord</label>
            <input
              id="reset-confirm"
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
            {error.text}
            {error.newLink && (
              <>
                {' '}
                <Link className="auth-link" to="/glomt-losenord" state={{ email: email.trim() }}>
                  Begär en ny länk
                </Link>
              </>
            )}
          </p>
        )}

        <button
          className="auth-submit"
          type="submit"
          disabled={busy || !meetsAllRules(password) || confirm.length === 0}
        >
          {busy ? 'Sparar…' : 'Spara nytt lösenord'}
        </button>
      </form>

      <Link className="auth-link" to="/logga-in" state={{ email: email.trim() }}>
        Tillbaka till inloggningen
      </Link>
    </AuthLayout>
  )
}
