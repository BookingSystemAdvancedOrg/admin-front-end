import { useLiveRefresh } from '../../shared/live'
import { useEffect, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { StatTile } from '../../shared/motion/StatTile'
import { Num } from '../../shared/motion/Num'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import { useAuth } from '../auth/useAuth'
import { NEEDS_OWNER, formatDate, kronor, listRequests, statusClass, statusLabel } from './cateringApi'
import type { CateringStatus, RequestSummary } from './cateringApi'
import './catering.css'
import { SkelCard, SkelPage, SkelRows, SkelTiles } from '../../shared/Skeleton'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'
import { Select } from '../../shared/Select'
import { NoLocation } from '../../shared/NoLocation'
import { currentLocation, useTenant } from '../../shared/tenant'
import { addDays, todayIn } from '../bokningar/bookingsApi'

type Filter = 'aktiva' | 'alla'
const ACTIVE: CateringStatus[] = ['requested', 'offer_sent', 'change_requested', 'signed', 'confirmed', 'delivered']

/**
 * Cateringförfrågningar för platsen. Förfrågningar som väntar på
 * restaurangen (nya och "ändring önskas") ligger först. Länken i ägarens
 * sms/mejl leder direkt till en förfrågan (/catering/<plats>/<id>).
 */
export default function CateringPage() {
  const { sub } = useAuth()
  const { locationId, resolving } = useLocationId(sub)
  const [rows, setRows] = useState<RequestSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<Filter>('aktiva')
  const timezone = currentLocation(useTenant())?.timezone
  const navigate = useNavigate()

  // Hela raden öppnar förfrågan. Länken "Öppna" är radens enda tabbstopp
  // och sköter sig själv (Enter, cmd-klick); ett tryck på resten av raden
  // gör samma sak, utom när någon markerar text för att kopiera den.
  function openRow(e: MouseEvent<HTMLTableRowElement>, href: string) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if ((e.target as Element).closest('a, button')) return
    if (window.getSelection()?.toString()) return
    navigate(href)
  }
  // Mellanslag öppnar också, som på en knapp (en länk gör det inte själv).
  function spaceOpens(e: KeyboardEvent<HTMLAnchorElement>, href: string) {
    if (e.key !== ' ') return
    e.preventDefault()
    navigate(href)
  }

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listRequests(locationId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [locationId])
  // Levande: nya förfrågningar och ändringar från kollegor syns av sig själva.
  useLiveRefresh(async () => {
    if (!locationId) return
    setRows(await listRequests(locationId))
    setError(false)
  }, { enabled: Boolean(locationId) })

  const visible = (rows ?? [])
    .filter((r) => filter === 'alla' || ACTIVE.includes(r.status))
    .sort((a, b) => {
      const wa = NEEDS_OWNER.includes(a.status) ? 0 : 1
      const wb = NEEDS_OWNER.includes(b.status) ? 0 : 1
      return wa - wb || a.deliveryDate.localeCompare(b.deliveryDate)
    })
  const waiting = (rows ?? []).filter((r) => NEEDS_OWNER.includes(r.status)).length
  const ongoing = (rows ?? []).filter((r) => ACTIVE.includes(r.status))
  // Platsens datum (Stockholm), inte UTC: strax efter midnatt är det redan i dag.
  const today = todayIn(timezone)
  const weekAhead = addDays(today, 7)
  const upcoming = ongoing.filter((r) => r.deliveryDate >= today && r.deliveryDate <= weekAhead).length
  const value = ongoing.reduce((sum, r) => sum + (r.total ?? 0), 0)
  const tiles = [
    { label: 'Väntar på dig', value: String(waiting), tone: waiting ? ('attention' as const) : undefined },
    { label: 'Pågående', value: String(ongoing.length) },
    { label: 'Kommande 7 dagar', value: String(upcoming) },
    { label: 'Värde pågående', value: kronor(value) },
  ]

  return (
    <>
      <AdminTopbar
        title="Catering"
        subtitle={waiting ? `${waiting} väntar på dig` : undefined}
        actions={
          <Link className="btn outline square" to="/cateringkalkyl" data-tour="catering-settings">
            Inställningar och rabatter
          </Link>
        }
      />
      <main className="admin-main">
        {!locationId ? (
          resolving ? (
            <SkelPage label="Hämtar platsen">
              <SkelTiles />
              <SkelCard rows={5} cols={4} />
            </SkelPage>
          ) : <NoLocation />
        ) : (
          <>
          <section className="stats-row catering-stats" aria-label="Cateringens siffror">
            {tiles.map((t, i) => (
              <StatTile key={t.label} {...t} loading={rows === null && !error} index={i} />
            ))}
          </section>
          <section className="admin-card table-card catering-list" data-tour="catering-list">
            <div className="card-head">
              <h2 className="card-title">Förfrågningar och beställningar</h2>
              <Select className="compact-select" aria-label="Visa" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="aktiva">Pågående</option>
                <option value="alla">Alla</option>
              </Select>
            </div>
            {error && <ErrorNote text={booqyFaultText('Förfrågningarna kunde inte visas.')} />}
            {rows === null && !error && <SkelRows n={5} cols={4} />}
            {rows !== null && visible.length === 0 && (
              <p className="cell-muted">
                Inga {filter === 'aktiva' ? 'pågående ' : ''}förfrågningar.
              </p>
            )}
            {visible.length > 0 && (
              <div className="table-scroll" tabIndex={0}>
                <table className="data-table catering-list-table">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Kund</th>
                      <th>Gäster</th>
                      <th>Belopp</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const href = `/catering/${locationId}/${r.requestId}`
                      const who = r.companyName ? `${r.companyName}, ${r.customerName}` : r.customerName
                      return (
                        <tr key={r.requestId} className="catering-row" onClick={(e) => openRow(e, href)}>
                          <td className="cell-strong catering-when">
                            {formatDate(r.deliveryDate)} {r.deliveryTime}
                            <div className="cell-muted">
                              {r.fulfilment === 'delivery' ? 'Leverans' : 'Avhämtning'}
                              {r.equipmentReturn === 'not_cleaned' && <> · <span className="catering-return-flag">ej rengjord retur</span></>}
                            </div>
                          </td>
                          <td className="catering-who">
                            {r.companyName ? `${r.companyName} · ` : ''}
                            {r.customerName}
                          </td>
                          <td className="catering-guests" data-label="Gäster">{r.guests != null ? <Num>{r.guests}</Num> : r.portions != null ? <><Num>{r.portions}</Num> port</> : '-'}</td>
                          <td className="catering-amount" data-label="Belopp"><Num>{kronor(r.total)}</Num></td>
                          <td className="catering-state">
                            <span className={`status-badge ${statusClass(r.status)}`}>{statusLabel(r)}</span>
                            {r.paid && <span className="cell-muted"> · betald</span>}
                            {(r.refundedAmount ?? 0) > 0 && (
                              <span className="cell-muted"> · återbetalt <Num>{kronor(r.refundedAmount)}</Num></span>
                            )}
                          </td>
                          <td className="catering-open">
                            <Link
                              className="catering-open-link"
                              to={href}
                              aria-label={`Öppna ${who}, ${formatDate(r.deliveryDate)} ${r.deliveryTime}`}
                              onKeyDown={(e) => spaceOpens(e, href)}
                            >
                              Öppna
                              <Icon name="arrow-right" size={16} className="catering-open-arrow" />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          </>
        )}
      </main>
    </>
  )
}
