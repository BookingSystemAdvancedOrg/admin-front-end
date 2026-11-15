import type { ReactNode } from 'react'
import { useLocationSummary } from './location'
import { PaletteTrigger } from './CommandPalette'
import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { SoundToggle } from './SoundToggle'
import { ThemeToggle } from './ThemeToggle'

/** Formaterar dagens datum som "Idag, mån 17 augusti 2026". */
function todayLabel(): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
  return `Idag, ${s}`
}

/** Sidhuvud i högerkolumnen (Figma: admin-topbar, 36:189). */
export function AdminTopbar({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  // Underrubriken var tidigare en hårdkodad påhittad restaurang. Den visar nu
  // den riktiga platsen från API:t, och ingenting alls innan någon plats
  // skapats - hellre tomt än fel restaurang.
  const location = useLocationSummary()
  const text =
    subtitle ??
    (location ? `${location.name} · ${location.address}` : '')

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-titles">
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
      <div className="admin-topbar-actions">
        {!actions && <span className="admin-topbar-date">{todayLabel()}</span>}
        <PaletteTrigger />
        <TopbarTools />
        {actions}
      </div>
    </header>
  )
}

/**
 * Hjälp, klickljud och ljust/mörkt läge: alltid uppe till höger, på varje
 * sida och i telefonen. Samma lagring som i Inställningar (booqy-theme och
 * ljudvalet i press.ts); varje knapp har ett verktygstips som säger vad den gör.
 */
function TopbarTools() {
  return (
    <span className="topbar-tools" role="group" aria-label="Hjälp, ljud och utseende">
      <NavLink to="/hjalp" className="topbar-tool topbar-help" title="Hjälp och guider">
        <Icon name="help" size={18} />
        <span className="topbar-tool-text">Hjälp</span>
      </NavLink>
      <SoundToggle className="topbar-tool" />
      <ThemeToggle className="topbar-tool" />
    </span>
  )
}
