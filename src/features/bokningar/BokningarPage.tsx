import { useCallback, useEffect, useRef, useState } from 'react'
import { sameData, useLiveRefresh } from '../../shared/live'
import { StatTile } from '../../shared/motion/StatTile'
import { onPageAction, takePageAction } from '../../shared/nav'
import { CtaButton } from '../../shared/CtaButton'
import { Num } from '../../shared/motion/Num'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { isApiConfigured } from '../../shared/api'
import { currentLocation, useTenant } from '../../shared/tenant'
import { Slot } from '../../shared/slots'
import { NewReservationModal } from './NewReservationModal'
import { ReservationModal } from './ReservationModal'
import {
  ACTIVE_STATUSES,
  SOURCE_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  addDays,
  cardDeadline,
  clockLabel,
  dayLabel,
  errorMessage,
  LOCATION_NOT_BOOKABLE,
  feeSummary,
  isCancelled,
  listReservations,
  MOCK_LOCATION_ID,
  todayIn,
} from './bookingsApi'
import type { Reservation } from './bookingsApi'
import { tableNames } from '../../shared/tables'
import { useBookingLabels } from '../../shared/bookingTables'
import { TableLinks } from '../../shared/TableLinks'
import './bokningar.css'
import { DateInput } from '../../shared/DateInput'
import { Icon } from '../../shared/Icon'
import { SkelCard, SkelPage, SkelTableRows, SkelTiles } from '../../shared/Skeleton'
import { NoLocation } from '../../shared/NoLocation'
import { ErrorNote } from '../../shared/ErrorNote'
import { PeakSuccess } from '../../shared/motion/PeakSuccess'

/** Rubriken efter en ny bokning: väntar den på kort har kortlänken gått iväg. */
function landedText(r: Reservation): string {
  if (r.status === 'pending') return 'Kortlänk skickad'
  if (r.guaranteeSkipped === 'too_soon') return 'Bokad utan kort (för nära starttiden)'
  return 'Bokningen är sparad'
}

/**
 * Bokningar för vald plats och dag (GET /locations/{id}/reservations).
 * Klick på en rad öppnar bokningen: anlänt/ångra, ändra/flytta, uteblev
 * (med eller utan no-show-avgift), avboka, debitera igen och återbetala.
 * Listan är levande (shared/live.ts): nya onlinebokningar och ändringar från
 * kollegor eller andra platser dyker upp av sig själva.
 */
export default function BokningarPage() {
  const tenantState = useTenant()
  const { tenant } = tenantState
  // Utan API (lokal utveckling): exempeldatan på en påhittad plats.
  const locationId = tenantState.locationId ?? (isApiConfigured() ? null : MOCK_LOCATION_ID)
  const resolving = isApiConfigured() && (tenantState.status === 'idle' || tenantState.status === 'loading')
  const location = currentLocation(tenantState)
  const isOwner = tenant?.role === 'owner_user'
  const today = todayIn(location?.timezone)

  const [date, setDate] = useState(today)
  // Bokningen man just sparade: bocken ritas in en gång och raden blinkar där den hamnade.
  const [landed, setLanded] = useState<Reservation | null>(null)
  // Raden går bort vid nästa tryck eller tangent, inte på en timer: då flyttar
  // sig listan bara när personalen själv gör något (ingen layoutförskjutning).
  useEffect(() => {
    if (!landed) return
    const clear = () => setLanded(null)
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', clear, { once: true })
      document.addEventListener('keydown', clear, { once: true })
    }, 600)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', clear)
      document.removeEventListener('keydown', clear)
    }
  }, [landed])
  // Listan hör alltid ihop med den plats/dag den hämtades för - en annan
  // dags bokningar visas aldrig under fel rubrik, inte ens en stund.
  const [loaded, setLoaded] = useState<{ key: string; items: Reservation[]; error: string | null } | null>(
    null,
  )
  const [showCancelled, setShowCancelled] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(() => takePageAction('new-booking'))
  // Kommandopaletten (⌘K) kan öppna formuläret direkt.
  useEffect(() => onPageAction('new-booking', () => setCreating(true)), [])
  // Räknas upp vid varje ändring härifrån: ett svar som hämtades före
  // ändringen skriver inte över den.
  const edits = useRef(0)
  const [reload, setReload] = useState(0)

  const key = locationId ? `${locationId}|${date}` : null
  const loading = key !== null && loaded?.key !== key
  const items = !loading && loaded ? loaded.items : []
  const { labelsFor } = useBookingLabels(locationId === MOCK_LOCATION_ID ? null : locationId, items)
  const error = !loading && loaded ? loaded.error : null

  // Hämtar dagens lista. `quiet`: en levande omhämtning, som inte visar ett
  // fel när listan redan syns (nästa puls försöker igen).
  const seq = useRef(0)
  const current = useRef(key)
  useEffect(() => {
    current.current = key
  }, [key])
  const fetchList = useCallback(async (quiet: boolean): Promise<boolean> => {
    if (!key || !locationId) return true
    const at = edits.current
    // Bara det senast startade svaret gäller: ett äldre som kommer sist skriver inte över.
    const id = ++seq.current
    try {
      const list = await listReservations(locationId, date)
      if (current.current !== key || edits.current !== at || id !== seq.current) return true
      setLoaded((prev) => (prev?.key === key && !prev.error && sameData(prev.items, list) ? prev : { key, items: list, error: null }))
      return true
    } catch (err) {
      if (current.current !== key || id !== seq.current) return false
      setLoaded((prev) => {
        if (quiet && prev?.key === key) return prev
        return {
          key,
          items: prev?.key === key ? prev.items : [],
          error: errorMessage(err, 'Bokningarna kunde inte visas.', LOCATION_NOT_BOOKABLE),
        }
      })
      return false
    }
  }, [key, locationId, date])

  useEffect(() => {
    void fetchList(false)
  }, [fetchList, reload])
  // Levande: bokningar från gäster, kollegor och andra platser syns av sig själva.
  useLiveRefresh(() => fetchList(true), { enabled: Boolean(key) && isApiConfigured() })

  function replace(updated: Reservation) {
    const moved = updated.date !== date || updated.locationId !== locationId
    if (moved) setOpenId(null)
    if (loaded?.key !== key) {
      // Dagens lista har inte kommit än: hämta den igen (den har ändringen).
      setReload((n) => n + 1)
      return
    }
    edits.current += 1
    setLoaded((prev) => {
      if (!prev || prev.key !== key) return prev
      const rest = prev.items.filter((r) => r.reservationId !== updated.reservationId)
      // Flyttad till en annan dag: försvinner härifrån.
      if (moved) return { ...prev, items: rest }
      return { ...prev, items: [...rest, updated].sort((a, b) => a.startTime.localeCompare(b.startTime)) }
    })
  }

  const visible = items.filter((r) => showCancelled || !isCancelled(r.status))
  const active = items.filter((r) => ACTIVE_STATUSES.includes(r.status))
  const guests = active.reduce((sum, r) => sum + r.partySize, 0)
  const cancelledCount = items.length - items.filter((r) => !isCancelled(r.status)).length
  const arrived = items.filter((r) => r.status === 'arrived').length
  const open = items.find((r) => r.reservationId === openId) ?? null
  const tiles = [
    { label: 'Bokningar', value: String(active.length) },
    { label: 'Gäster', value: String(guests) },
    { label: 'Anlända', value: String(arrived) },
    { label: 'Avbokade', value: String(cancelledCount) },
  ]

  return (
    <>
      <AdminTopbar
        title="Bokningar"
        actions={
          <CtaButton
            label="Ny bokning"
            win="Kör!"
            data-tour="booking-new"
            disabled={!locationId || !isApiConfigured()}
            onClick={() => setCreating(true)}
          />
        }
      />
      <div className="admin-main">
        {!locationId ? (
          resolving ? (
            <SkelPage label="Hämtar platsen">
              <SkelTiles />
              <SkelCard />
            </SkelPage>
          ) : (
            <NoLocation />
          )
        ) : (
          <>
            <section className="stats-row" aria-label="Dagens siffror">
              {tiles.map((t, i) => (
                <StatTile key={t.label} {...t} loading={loading} index={i} />
              ))}
            </section>
            <section className="admin-card table-card">
              <div className="card-head bookings-head">
                <div className="day-nav" data-tour="booking-day">
                  <button
                    type="button"
                    className="btn outline square day-step"
                    aria-label="Föregående dag"
                    onClick={() => setDate(addDays(date, -1))}
                  >
                    <Icon name="chevron-left" />
                  </button>
                  <div className="day-nav-label">
                    <h2 className="card-title">{date === today ? `Idag · ${dayLabel(date)}` : dayLabel(date)}</h2>
                  </div>
                  <button
                    type="button"
                    className="btn outline square day-step"
                    aria-label="Nästa dag"
                    onClick={() => setDate(addDays(date, 1))}
                  >
                    <Icon name="chevron-right" />
                  </button>
                </div>
                <div className="day-tools">
                  {date !== today && (
                    <button type="button" className="btn outline square" onClick={() => setDate(today)}>
                      Idag
                    </button>
                  )}
                  <DateInput
                    aria-label="Välj datum"
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <ErrorNote text={error} />
              )}
              {landed && (
                <p className="bk-landed">
                  <PeakSuccess
                    key={landed.reservationId}
                    text={landedText(landed)}
                    sub={`${dayLabel(landed.date)} ${landed.startTime} · ${landed.partySize} pers${
                      landed.status === 'pending' && landed.pendingExpiresAt
                        ? ` · hålls till ${clockLabel(cardDeadline(landed), landed.timezone ?? location?.timezone)}`
                        : ''
                    }`}
                  />
                </p>
              )}

              <div className="table-scroll" tabIndex={0} data-tour="booking-list">
                <table className="data-table bookings-table">
                  <thead>
                    <tr>
                      <th>Tid</th>
                      <th>Gäst</th>
                      <th>Pers</th>
                      <th>Bord</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && <SkelTableRows n={5} cols={5} />}
                    {!loading && visible.length === 0 && (
                      <tr>
                        <td colSpan={5} className="cell-muted">
                          Inga bokningar.
                        </td>
                      </tr>
                    )}
                    {visible.map((r) => (
                      <tr
                        key={r.reservationId}
                        className={`booking-row${isCancelled(r.status) ? ' muted' : ''}${landed?.reservationId === r.reservationId ? ' m-landed' : ''}`}
                        tabIndex={0}
                        onClick={() => setOpenId(r.reservationId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setOpenId(r.reservationId)
                          }
                        }}
                      >
                        <td className="cell-strong bk-time">{r.startTime}</td>
                        <td className="bk-guest">
                          <span className="guest-line">
                          <span className="cell-strong">{r.customerName || 'Gäst'}</span>
                          {locationId && (
                            <Slot
                              id="bokningar.reservation.badge"
                              props={{ locationId, reservationId: r.reservationId, email: r.customerEmail, phone: r.customerPhone }}
                            />
                          )}
                          {locationId && (
                            <Slot id="bokningar.reservation.call" props={{ locationId, reservationId: r.reservationId }} />
                          )}
                          {r.notes && <span className="note-dot" title={r.notes}><Icon name="note" size={14} /></span>}
                          </span>
                          {r.customerPhone && <div className="cell-muted">{r.customerPhone}</div>}
                          {r.source && r.source !== 'online' && (
                            <div className="cell-muted">{SOURCE_LABEL[r.source]}</div>
                          )}
                        </td>
                        <td className="bk-pers" data-label="Pers"><Num>{r.partySize}</Num></td>
                        <td className="bk-tables">{locationId === MOCK_LOCATION_ID ? tableNames(r.tableIds, labelsFor(r)) : <TableLinks ids={r.tableIds} labels={labelsFor(r)} date={r.date} />}</td>
                        <td className="bk-status">
                          <span className={`status-badge ${STATUS_CLASS[r.status]}`}>
                            {STATUS_LABEL[r.status]}
                          </span>
                          {r.cardOnFile && r.status === 'reserved' && (
                            <span className="cell-muted" title="Kort sparat (kortgaranti)"> <Icon name="card" size={15} /></span>
                          )}
                          {r.cardNeeded && r.status === 'reserved' && <div className="cell-muted">Kort saknas</div>}
                          {r.status === 'pending' && r.pendingExpiresAt && (
                            <div className="cell-muted">hålls till {clockLabel(cardDeadline(r), r.timezone ?? location?.timezone)}</div>
                          )}
                          {feeSummary(r) && <div className="cell-muted">{feeSummary(r)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cancelledCount > 0 && (
                <button type="button" className="link-btn" onClick={() => setShowCancelled((v) => !v)}>
                  {showCancelled ? 'Dölj avbokade' : `Visa avbokade (${cancelledCount})`}
                </button>
              )}
            </section>
            {locationId && <Slot id="bokningar.panel.waitlist" props={{ locationId, date }} />}
            {locationId && <Slot id="bokningar.panel.callbacks" props={{ locationId, date }} />}
          </>
        )}
      </div>

      {open && (
        <ReservationModal
          key={open.reservationId}
          reservation={open}
          isOwner={isOwner}
          today={today}
          onChanged={replace}
          onClose={() => setOpenId(null)}
        />
      )}
      {creating && locationId && (
        <NewReservationModal
          locationId={locationId}
          initialDate={date}
          today={today}
          onCreated={(created) => {
            setCreating(false)
            setLanded(created)
            if (created.date === date) replace(created)
            else setDate(created.date)
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  )
}
