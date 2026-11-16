import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { MyAvatarButton } from './ProfilePicture'
import { Select } from './Select'
import { SoundToggle } from './SoundToggle'
import { ThemeToggle } from './ThemeToggle'
import type { SheetGroup } from './dock'
import type { TenantLocation } from './tenant'

export const MORE_SHEET_ID = 'admin-more-sheet'

/** Hur långt (px) eller hur fort (px/ms) arket dras ned innan det stängs. */
const CLOSE_DISTANCE = 80
const CLOSE_SPEED = 0.5

export type QuickAction = { id: string; label: string; icon: IconName; run: () => void }

/**
 * Arket bakom Mer (telefon): allt som sidomenyns låda hade. Restaurangen och
 * profilbilden, platsväljaren, snabbval (Fråga Booqy, Sök, Guiden), resten av
 * sidorna i menyns grupper, Inställningar och Hjälp, utseende och ljud, och
 * sist Logga ut. Stängs med ett drag nedåt, ett tryck utanför, Esc, ett
 * sidbyte, ett platsbyte eller ett nytt tryck på Mer.
 */
export function MoreSheet({
  groups,
  isActive,
  quick,
  restaurant,
  person,
  email,
  locations,
  locationId,
  onLocation,
  onLogout,
  onClose,
  closing,
  guided,
  returnFocus,
}: {
  groups: SheetGroup[]
  isActive: (to: string) => boolean
  quick: QuickAction[]
  restaurant: string
  person: { name: string; role: string }
  email: string | null
  locations: TenantLocation[]
  locationId: string | null
  onLocation: (id: string) => void
  onLogout: () => void
  onClose: () => void
  /** Stängs just nu (glider ned). */
  closing: boolean
  /** Öppnat av guiden: inget fångat fokus, guidens knappar ska gå att nå. */
  guided: boolean
  returnFocus: RefObject<HTMLElement | null>
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Fokus in i arket när det öppnas, tillbaka till Mer när det stängs. Bara om
  // fokus fortfarande ligger i arket (eller ingenstans): det man valde i arket
  // (Fråga Booqy, Sök) har redan tagit fokus innan arket hunnit glida undan, och
  // då får arket inte ta tillbaka det mitt i en fråga.
  useEffect(() => {
    if (guided) return
    const sheet = sheetRef.current
    const first = sheet?.querySelector<HTMLElement>('.bq-more__list a, .bq-more__list button')
    first?.focus({ preventScroll: true })
    const back = returnFocus.current
    return () => {
      const active = document.activeElement
      const free = !active || active === document.body || !!sheet?.contains(active)
      if (free && back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [guided, returnFocus])

  // Esc stänger (inte medan en rullista eller dialog ovanpå har fokus).
  useEffect(() => {
    if (guided) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const active = document.activeElement
      if (active && !sheetRef.current?.contains(active) && active !== returnFocus.current && active !== document.body) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guided, onClose, returnFocus])

  // Sidan bakom står still medan arket är öppet.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('drawer-lock')
    return () => root.classList.remove('drawer-lock')
  }, [])

  // Dra nedåt för att stänga: från handtaget och huvudet, eller från listan
  // när den står överst. Arket följer fingret; släpps det kort glider det tillbaka.
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || guided) return
    let drag: { y: number; t: number; lastY: number; lastT: number; moved: boolean } | null = null
    const canStart = (target: EventTarget | null) => {
      const el = target as Element | null
      if (!el?.closest) return false
      if (el.closest('.bq-more__grab, .bq-more__head')) return true
      const list = listRef.current
      return !!list && list.contains(el) && list.scrollTop <= 0 && !el.closest('.b-select, input, textarea')
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !canStart(e.target)) return
      const y = e.touches[0].clientY
      drag = { y, t: e.timeStamp, lastY: y, lastT: e.timeStamp, moved: false }
    }
    const onMove = (e: TouchEvent) => {
      if (!drag) return
      const dy = e.touches[0].clientY - drag.y
      if (!drag.moved && dy < 0) {
        drag = null // uppåt: listan rullar som vanligt
        return
      }
      if (dy > 4) drag.moved = true
      if (!drag.moved) return
      e.preventDefault()
      drag.lastY = e.touches[0].clientY
      drag.lastT = e.timeStamp
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`
    }
    const onEnd = (e: TouchEvent) => {
      if (!drag) return
      const d = drag
      drag = null
      if (!d.moved) return
      const dy = d.lastY - d.y
      const speed = dy / Math.max(1, e.timeStamp - d.t)
      sheet.style.transition = ''
      if (dy > CLOSE_DISTANCE || speed > CLOSE_SPEED) {
        sheet.style.transform = `translateY(${Math.max(0, dy)}px)`
        onClose()
      } else {
        sheet.style.transform = ''
      }
    }
    sheet.addEventListener('touchstart', onStart, { passive: true })
    sheet.addEventListener('touchmove', onMove, { passive: false })
    sheet.addEventListener('touchend', onEnd)
    sheet.addEventListener('touchcancel', onEnd)
    return () => {
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', onEnd)
      sheet.removeEventListener('touchcancel', onEnd)
    }
  }, [guided, onClose])

  // Tab stannar i arket.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || guided) return
    const all = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((el) => el.getClientRects().length > 0 || import.meta.env.MODE === 'test')
    if (all.length === 0) return
    const first = all[0]
    const last = all[all.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div className={`bq-more-scrim${closing ? ' is-closing' : ''}`} aria-hidden="true" onClick={onClose} />
      <div
        id={MORE_SHEET_ID}
        ref={sheetRef}
        className={`bq-more${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal={guided ? undefined : 'true'}
        aria-label="Mer"
        onKeyDown={onKeyDown}
      >
        <button type="button" className="bq-more__grab" aria-label="Stäng" onClick={onClose}>
          <span className="bq-more__handle" aria-hidden="true" />
        </button>
        <div className="bq-more__head">
          <span className="bq-more__mark" aria-hidden="true">
            <BrandMark tone="mono" size={30} />
          </span>
          <span className="bq-more__who">
            <span className="bq-more__name">{restaurant}</span>
            <span className="bq-more__role">
              {person.name} · {person.role}
            </span>
          </span>
          <MyAvatarButton name={person.name} email={email} />
        </div>

        <div className="bq-more__list" ref={listRef}>
          {locations.length > 1 && (
            <div className="bq-more__place" data-tour="location-picker">
              <label htmlFor="admin-more-location">Plats</label>
              <Select id="admin-more-location" value={locationId ?? ''} onChange={(e) => onLocation(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.locationId} value={l.locationId}>
                    {l.name || 'Namnlös plats'}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {quick.length > 0 && (
            <div className="bq-more__quick" role="group" aria-label="Snabbval">
              {quick.map((q) => (
                <button key={q.id} type="button" className="bq-more__tile" onClick={q.run}>
                  <span className="bq-more__tile-disc" aria-hidden="true">
                    <Icon name={q.icon} size={24} />
                  </span>
                  <span className="bq-more__tile-label">{q.label}</span>
                </button>
              ))}
            </div>
          )}

          <nav className="bq-more__nav" aria-label="Fler sidor">
            {groups.map((g) => (
              <div key={g.id} className="bq-more__group" role={g.label ? 'group' : undefined} aria-labelledby={g.label ? `more-group-${g.id}` : undefined}>
                {g.label && (
                  <p className="bq-more__group-label" id={`more-group-${g.id}`}>
                    {g.label}
                  </p>
                )}
                {g.items.map((item) => {
                  const active = isActive(item.to)
                  return (
                    <Link
                      key={item.tour}
                      to={item.to}
                      data-tour={item.tour}
                      data-help={`nav:${item.to}`}
                      className={active ? 'bq-more__row is-active' : 'bq-more__row'}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon name={item.icon} size={24} className="bq-more__row-icon" />
                      <span className="bq-more__row-label">{item.label}</span>
                      <Icon name="chevron-down" size={18} className="bq-more__chev" />
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="bq-more__look">
            <span className="bq-more__look-label">Utseende</span>
            <span className="bq-more__look-tools">
              <SoundToggle className="bq-more__tool" />
              <ThemeToggle className="bq-more__tool" />
            </span>
          </div>

          <button type="button" className="bq-more__row bq-more__logout" aria-haspopup="dialog" onClick={onLogout}>
            <Icon name="logout" size={24} className="bq-more__row-icon" />
            <span className="bq-more__row-label">Logga ut</span>
          </button>
        </div>
      </div>
    </>
  )
}
