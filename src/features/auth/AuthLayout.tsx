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
          <span className="auth-logo-badge" aria-hidden="true">
            K
          </span>
          <span className="auth-logo-text">
            <strong>KÄLLA</strong>
            <span>Admin</span>
          </span>
        </div>
        <section className="auth-card">{children}</section>
      </div>
    </div>
  )
}
