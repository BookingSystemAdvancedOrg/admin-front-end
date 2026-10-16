import type { ReactNode } from 'react'
import { useLocationSummary } from './location'

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
  // skapats — hellre tomt än fel restaurang.
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
        {actions ?? <span className="admin-topbar-date">{todayLabel()}</span>}
      </div>
    </header>
  )
}
