import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * En meny i kassans huvudrad ("Rapporter", "Kassan"): en knapp som öppnar en
 * lista under sig, där varje val har ett namn och en rad om vad det gör.
 * Stängs vid ett val, Escape eller ett klick utanför; piltangenterna flyttar
 * mellan valen. Listan placeras så att den alltid får plats på skärmen.
 */
export interface KassaMenuItem {
  label: string
  hint: string
  onSelect?: () => void
  to?: string
  /** Ett läge som är på eller av, t.ex. Övningsläge; visas som "På". */
  on?: boolean
  disabled?: boolean
  quiet?: boolean
}

export function KassaMenu({ label, items, icon }: { label: string; items: KassaMenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false)
  // listans vänsterkant i förhållande till knappen; null = mot knappens högerkant
  const [offset, setOffset] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('.kassa-menu-button')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    // Listan ligger mot knappens högerkant, men flyttas så att den alltid
    // håller 16 px från skärmens kanter.
    const r = root.current?.getBoundingClientRect()
    if (r) {
      const width = Math.min(340, window.innerWidth - 32)
      const left = Math.min(Math.max(r.right - width, 16), window.innerWidth - 16 - width)
      setOffset(left - r.left)
    }
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  function move(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const i = all.indexOf(document.activeElement as HTMLElement)
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
  }

  const body = (item: KassaMenuItem) => (
    <>
      <span className="kassa-menu-text">
        <span className="kassa-menu-label">{item.label}</span>
        <span className="kassa-menu-hint">{item.hint}</span>
      </span>
      {item.on !== undefined && <span className={item.on ? 'kassa-menu-state on' : 'kassa-menu-state'}>{item.on ? 'På' : 'Av'}</span>}
    </>
  )

  return (
    <div className="kassa-menu-wrap" ref={root}>
      <button
        type="button"
        className={open ? 'btn outline kassa-menu-button open' : 'btn outline kassa-menu-button'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {label}
        <span className="kassa-menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="kassa-menu-panel"
          role="menu"
          aria-label={label}
          ref={panel}
          onKeyDown={move}
          style={offset === null ? undefined : { left: offset, right: 'auto' }}
        >
          {items.map((item) =>
            item.to ? (
              <Link key={item.label} role="menuitem" className="kassa-menu-item" to={item.to} onClick={() => setOpen(false)}>
                {body(item)}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.quiet ? 'kassa-menu-item quiet' : 'kassa-menu-item'}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect?.()
                }}
              >
                {body(item)}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
