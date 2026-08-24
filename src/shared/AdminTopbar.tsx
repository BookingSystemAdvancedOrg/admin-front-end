import type { ReactNode } from 'react'

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
  subtitle = 'KÄLLA · Sveavägen 42, Stockholm',
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="admin-topbar">
      <div className="admin-topbar-titles">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="admin-topbar-actions">
        {actions ?? <span className="admin-topbar-date">{todayLabel()}</span>}
      </div>
    </header>
  )
}
