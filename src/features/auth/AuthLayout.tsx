import type { ReactNode } from 'react'
import { BrandMark, BrandWordmark } from '../../shared/BrandMark'
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
              platsens riktiga namn går inte att hämta - produktens ikon. */}
          <span className="auth-logo-badge" aria-hidden="true">
            <BrandMark size={44} />
          </span>
          <span className="auth-logo-text">
            <BrandWordmark height={26} />
            <span>Admin</span>
          </span>
        </div>
        <section className="auth-card">{children}</section>
      </div>
    </div>
  )
}
