import { useEffect, useRef, useState } from 'react'
import { StatTile } from '../../shared/motion/StatTile'
import { Num } from '../../shared/motion/Num'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { isApiConfigured } from '../../shared/api'
import { currentLocation, useTenant } from '../../shared/tenant'
import { NewReservationModal } from './NewReservationModal'
import { ReservationModal } from './ReservationModal'
import {
  ACTIVE_STATUSES,
  SOURCE_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  addDays,
  dayLabel,
  errorMessage,
  feeSummary,
  isCancelled,
  listReservations,
  todayIn,
} from './bookingsApi'
import type { Reservation } from './bookingsApi'
import { tableNames, useTables } from '../../shared/tables'
import './bokningar.css'
import { Loading } from '../../shared/Loading'

const REFRESH_MS = 60_000

/**
 * Bokningar för vald plats och dag (GET /locations/{id}/reservations).
 * Klick på en rad öppnar bokningen: anlänt/ångra, ändra/flytta, uteblev
 * (med eller utan no-show-avgift), avboka, debitera igen och återbetala.
 * Listan hämtas om varje minut så nya onlinebokningar dyker upp av sig själva.
 */
export default function BokningarPage() {
  const tenantState = useTenant()
  const { tenant, locationId } = tenantState
  const location = currentLocation(tenantState)
  const isOwner = tenant?.role === 'owner_user'
  const today = todayIn(location?.timezone)
  const { labels } = useTables(locationId)

  const [date, setDate] = useState(today)
  // Listan hör alltid ihop med den plats/dag den hämtades för - en annan
  // dags bokningar visas aldrig under fel rubrik, inte ens en stund.
  const [loaded, setLoaded] = useState<{ key: string; items: Reservation[]; error: string | null } | null>(
    null,
  )
  const [showCancelled, setShowCancelled] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Räknas upp vid varje ändring härifrån: ett svar som hämtades före
  // ändringen skriver inte över den.
  const edits = useRef(0)
  const [reload, setReload] = useState(0)

  const key = locationId ? `${locationId}|${date}` : null
  const loading = key !== null && loaded?.key !== key
  const items = !loading && loaded ? loaded.items : []
  const error = !loading && loaded ? loaded.error : null

  useEffect(() => {
    if (!key || !locationId || !isApiConfigured()) return
    let cancelled = false
    const fetchList = () => {
      const at = edits.current
      listReservations(locationId, date).then(
        (list) => {
          if (cancelled || edits.current !== at) return
          setLoaded({ key, items: list, error: null })
        },
        (err) => {
          if (cancelled) return
          setLoaded((prev) => ({
            key,
            items: prev?.key === key ? prev.items : [],
            error: errorMessage(err),
          }))
        },
      )
    }
    fetchList()
    const timer = window.setInterval(fetchList, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [key, locationId, date, reload])

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
  const dayWord = date === today ? 'idag' : 'den dagen'
  const tiles = [
    { label: 'Bokningar', value: String(active.length), note: `Aktiva ${dayWord}` },
    { label: 'Gäster', value: String(guests), note: active.length ? `${(guests / active.length).toFixed(1).replace('.', ',')} per bokning` : 'Inga bokningar' },
    { label: 'Anlända', value: String(arrived), note: active.length ? `${Math.round((arrived / active.length) * 100)} % av bokningarna` : 'Ingen än' },
    { label: 'Avbokade', value: String(cancelledCount), note: cancelledCount ? 'Visa dem under listan' : 'Inga avbokningar' },
  ]

  if (!isApiConfigured()) {
    return (
      <>
        <AdminTopbar title="Bokningar" />
        <div className="admin-main">
          <section className="admin-card table-card">
            <p className="cell-muted">Bokningar kräver API:t (VITE_API_BASE_URL).</p>
          </section>
        </div>
      </>
    )
  }

  return (
    <>
      <AdminTopbar
        title="Bokningar"
        actions={
          <button
            type="button"
            className="btn primary square"
            data-tour="booking-new"
            disabled={!locationId}
            onClick={() => setCreating(true)}
          >
            + Ny bokning
          </button>
        }
      />
      <div className="admin-main">
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
                ‹
              </button>
              <div className="day-nav-label">
                <h2 className="card-title">{date === today ? `Idag · ${dayLabel(date)}` : dayLabel(date)}</h2>
                {loading ? (
                  <Loading variant="inline" />
                ) : (
                  <span className="cell-muted">
                    <Num>{active.length}</Num> {active.length === 1 ? 'bokning' : 'bokningar'} · <Num>{guests}</Num> gäster
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn outline square day-step"
                aria-label="Nästa dag"
                onClick={() => setDate(addDays(date, 1))}
              >
                ›
              </button>
            </div>
            <div className="day-tools">
              {date !== today && (
                <button type="button" className="btn outline square" onClick={() => setDate(today)}>
                  Idag
                </button>
              )}
              <input
                type="date"
                aria-label="Välj datum"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="table-scroll" data-tour="booking-list">
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
                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="cell-muted">
                      Inga bokningar den här dagen.
                    </td>
                  </tr>
                )}
                {visible.map((r) => (
                  <tr
                    key={r.reservationId}
                    className={`booking-row${isCancelled(r.status) ? ' muted' : ''}`}
                    tabIndex={0}
                    onClick={() => setOpenId(r.reservationId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenId(r.reservationId)
                      }
                    }}
                  >
                    <td className="cell-strong">{r.startTime}</td>
                    <td>
                      <span className="cell-strong">{r.customerName || 'Gäst'}</span>
                      {r.notes && <span className="note-dot" title={r.notes}> ✎</span>}
                      {r.customerPhone && <div className="cell-muted">{r.customerPhone}</div>}
                      {r.source && r.source !== 'online' && (
                        <div className="cell-muted">{SOURCE_LABEL[r.source]}</div>
                      )}
                    </td>
                    <td><Num>{r.partySize}</Num></td>
                    <td>{tableNames(r.tableIds, labels)}</td>
                    <td>
                      <span className={`status-badge ${STATUS_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.cardOnFile && r.status === 'reserved' && (
                        <span className="cell-muted" title="Kort sparat (kortgaranti)"> 💳</span>
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
            if (created.date === date) replace(created)
            else setDate(created.date)
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  )
}
