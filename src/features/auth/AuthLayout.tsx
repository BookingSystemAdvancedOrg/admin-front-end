import type { ReactNode } from 'react'
import { BrandMark, BrandWordmark } from '../../shared/BrandMark'
import { ThemeToggle } from '../../shared/ThemeToggle'
import { SoundToggle } from '../../shared/SoundToggle'
import './auth.css'
import './auth-brand.css'

/**
 * Delad layout för personal-inloggning och nytt-lösenord
 * (Figma: personal-inloggning-page / nytt-losenord-page).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      {/* Ljust/mörkt läge går att välja redan innan inloggning. */}
      <div className="auth-theme-toggle auth-toggles">
        <SoundToggle />
        <ThemeToggle />
      </div>
      <div className="auth-inner">
        <div className="auth-logo">
          {/* Ingen restaurang namnges: inloggningsskärmen visas utloggad, så
              platsens riktiga namn går inte att hämta - produktens ikon. */}
          <span className="auth-logo-badge" aria-hidden="true">
            <BrandMark size={44} />
          </span>
          <span className="auth-logo-text">
            <BrandWordmark height={40} />
            <span>Admin</span>
          </span>
        </div>
        {/* Lappen hänger under en brun skena, som kvittona på booqy.se. */}
        <div className="auth-hang">
          <div className="auth-rail" aria-hidden="true" />
          <section className="auth-card">{children}</section>
        </div>
      </div>
    </div>
  )
}
