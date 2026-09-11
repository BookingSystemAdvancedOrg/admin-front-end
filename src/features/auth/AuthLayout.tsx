import type { ReactNode } from 'react'
import './auth.css'

/**
 * Delad layout för personal-inloggning och nytt-lösenord
 * (Figma: personal-inloggning-page / nytt-losenord-page).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-inner">
        <div className="auth-logo">
          {/* Ingen restaurang namnges: inloggningsskärmen visas utloggad, så
              platsens riktiga namn går inte att hämta. Byt gärna till
              produktens eget varumärke när det är bestämt. */}
          <span className="auth-logo-badge" aria-hidden="true">
            A
          </span>
          <span className="auth-logo-text">
            <strong>Admin</strong>
            <span>Bokningssystem</span>
          </span>
        </div>
        <section className="auth-card">{children}</section>
      </div>
    </div>
  )
}
