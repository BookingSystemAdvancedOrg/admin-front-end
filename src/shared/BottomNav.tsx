import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useGuardedNavigate } from './LeaveGuard'
import { Icon } from './Icon'
import { MORE_SHEET_ID, MoreSheet } from './MoreSheet'
import type { QuickAction } from './MoreSheet'
import { openPalette } from './CommandPalette'
import { requestPageAction } from './nav'
import { dockPaths, dockSlots, isActiveItem, sheetGroups, useDockHidden, useDockHiding } from './dock'
import { selectLocation } from './tenant'
import type { Tenant } from './tenant'
import { useGuide } from '../features/guide/Guide'
import { helpChatEnabled, openHelpChat } from '../features/help/chatState'
import './bottomNav.css'

/** Hur länge arket glider ned innan det tas bort (som i CSS:en). */
// Arket går ut på 140 ms (bottomNav.css); lite marginal så att sista bildrutan hinner ritas.
const CLOSE_MS = 180

/**
 * Telefonens meny längst ner, där tummen är (ersätter menyknappen uppe till
 * vänster och lådan). Bara ikoner i raden; namnen står i aria-label. Mer
 * öppnar arket med resten. Ritas direkt i <body>: sidans glas
 * (backdrop-filter) skulle annars flytta position: fixed.
 */
export function BottomNav({
  tenant,
  locationId,
  person,
  email,
  intro,
  onLogout,
}: {
  tenant: Tenant | null
  locationId: string | null
  person: { name: string; role: string }
  email: string | null
  /** Första sidan efter inloggningen: raden tonar in en gång. */
  intro: boolean
  onLogout: () => void
}) {
  const { pathname } = useLocation()
  const navigate = useGuardedNavigate()
  const guide = useGuide()
  const moreRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  useDockHiding(true)
  const hidden = useDockHidden()

  // Restaurangen ändras live (plan, roll): raden och arket räknas om här.
  const slots = useMemo(() => dockSlots(tenant), [tenant])
  const groups = useMemo(() => sheetGroups(tenant, dockPaths(slots)), [tenant, slots])
  const sheetTours = useMemo(() => {
    const tours = new Set(groups.flatMap((g) => g.items.map((i) => i.tour)))
    if ((tenant?.locations.length ?? 0) > 1) tours.add('location-picker')
    return tours
  }, [groups, tenant])
  // Guiden pekar på något i arket: arket står öppet så länge (utan fångat fokus).
  const guided = guide.active && !!guide.target && sheetTours.has(guide.target)

  const openRef = useRef(false)
  openRef.current = open
  const close = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    setClosing(true)
  }, [])
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(() => setClosing(false), CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [closing])

  // Sidbyte (en rad i arket) och platsbyte stänger arket.
  useEffect(() => {
    setOpen(false)
    setClosing(false)
  }, [pathname, locationId])

  const showSheet = open || guided || closing
  const activeSlot = slots.findIndex((s) => s.kind === 'page' && isActiveItem(pathname, s.item))
  const sheetPage = groups.flatMap((g) => g.items).find((i) => isActiveItem(pathname, i))
  const moreIndex = slots.findIndex((s) => s.kind === 'more')
  const pillIndex = activeSlot >= 0 ? activeSlot : sheetPage || open ? moreIndex : -1

  const quick: QuickAction[] = [
    ...(helpChatEnabled()
      ? [{ id: 'ask', label: 'Fråga Booqy', icon: 'help' as const, run: () => after(() => openHelpChat()) }]
      : []),
    { id: 'search', label: 'Sök', icon: 'search', run: () => after(openPalette) },
    { id: 'guide', label: 'Guiden', icon: 'book', run: () => after(guide.start) },
  ]
  /** Stäng arket först, sedan det man valde (det tar fokus själv). */
  function after(run: () => void) {
    close()
    window.setTimeout(run, 0)
  }

  const style = { '--n': slots.length, '--i': Math.max(0, pillIndex) } as CSSProperties
  const dock = (
    <nav
      className={`bq-dock${intro ? ' bq-dock--intro' : ''}${showSheet ? ' is-sheet-open' : ''}`}
      aria-label="Snabbmeny"
      style={style}
      inert={hidden && !showSheet}
      data-cols={slots.length}
    >
      <span className={`bq-dock__pill${pillIndex < 0 ? ' is-off' : ''}`} aria-hidden="true" />
      {slots.map((slot) => {
        if (slot.kind === 'page') {
          const active = isActiveItem(pathname, slot.item)
          return (
            <Link
              key={slot.item.to}
              to={slot.item.to}
              className={active ? 'bq-dock__item is-active' : 'bq-dock__item'}
              aria-label={slot.item.label}
              aria-current={active ? 'page' : undefined}
              data-tour={slot.item.tour}
              data-help={`nav:${slot.item.to}`}
            >
              <Icon name={slot.item.icon} size={24} />
            </Link>
          )
        }
        if (slot.kind === 'new-booking') {
          return (
            <button
              key="new-booking"
              type="button"
              className="bq-dock__item bq-dock__new"
              aria-label="Ny bokning"
              onClick={() => {
                close()
                requestPageAction('new-booking')
                navigate('/bokningar')
              }}
            >
              <span className="bq-dock__disc" aria-hidden="true">
                <Icon name="plus" size={24} />
              </span>
            </button>
          )
        }
        const label = sheetPage ? `Mer, du är på ${sheetPage.label}` : 'Mer'
        return (
          <button
            key="more"
            ref={moreRef}
            type="button"
            className={pillIndex === moreIndex ? 'bq-dock__item bq-dock__more is-active' : 'bq-dock__item bq-dock__more'}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={MORE_SHEET_ID}
            onClick={() => (open ? close() : setOpen(true))}
          >
            <Icon name="grid" size={24} />
          </button>
        )
      })}
    </nav>
  )

  return createPortal(
    <>
      {dock}
      {showSheet && (
        <MoreSheet
          groups={groups}
          isActive={(to) => {
            const item = groups.flatMap((g) => g.items).find((i) => i.to === to)
            return !!item && isActiveItem(pathname, item)
          }}
          quick={quick}
          restaurant={tenant?.name ?? ''}
          person={person}
          email={email}
          locations={tenant?.locations ?? []}
          locationId={locationId}
          onLocation={(id) => {
            close()
            selectLocation(id)
          }}
          onLogout={() => after(onLogout)}
          onClose={close}
          closing={closing && !open && !guided}
          guided={guided && !open}
          returnFocus={moreRef}
        />
      )}
    </>,
    document.body,
  )
}
