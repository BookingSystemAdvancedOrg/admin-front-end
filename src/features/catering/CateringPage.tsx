import { useEffect, useState } from 'react'
import { StatTile } from '../../shared/motion/StatTile'
import { Num } from '../../shared/motion/Num'
import { Link } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import { useAuth } from '../auth/useAuth'
import { NEEDS_OWNER, STATUS_LABEL, formatDate, kronor, listRequests, statusClass } from './cateringApi'
import type { CateringStatus, RequestSummary } from './cateringApi'
import './catering.css'
import { Loading } from '../../shared/Loading'

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

  const visible = (rows ?? [])
    .filter((r) => filter === 'alla' || ACTIVE.includes(r.status))
    .sort((a, b) => {
      const wa = NEEDS_OWNER.includes(a.status) ? 0 : 1
      const wb = NEEDS_OWNER.includes(b.status) ? 0 : 1
      return wa - wb || a.deliveryDate.localeCompare(b.deliveryDate)
    })
  const waiting = (rows ?? []).filter((r) => NEEDS_OWNER.includes(r.status)).length
  const ongoing = (rows ?? []).filter((r) => ACTIVE.includes(r.status))
  const [{ today, weekAhead }] = useState(() => ({
    today: new Date().toISOString().slice(0, 10),
    weekAhead: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  }))
  const upcoming = ongoing.filter((r) => r.deliveryDate >= today && r.deliveryDate <= weekAhead).length
  const value = ongoing.reduce((sum, r) => sum + (r.total ?? 0), 0)
  const tiles = [
    { label: 'Väntar på dig', value: String(waiting), note: waiting ? 'Nya eller ändring önskas' : 'Inget att svara på', tone: waiting ? ('attention' as const) : undefined },
    { label: 'Pågående', value: String(ongoing.length), note: 'Offert, signerad eller bekräftad' },
    { label: 'Kommande 7 dagar', value: String(upcoming), note: upcoming ? 'Leveranser att förbereda' : 'Inga leveranser' },
    { label: 'Värde pågående', value: kronor(value), note: `${ongoing.length} ${ongoing.length === 1 ? 'beställning' : 'beställningar'}` },
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
          resolving ? <Loading label="Hämtar platsen" /> : <p className="cell-muted">Ingen plats är vald.</p>
        ) : (
          <>
          <section className="stats-row" aria-label="Cateringens siffror">
            {tiles.map((t, i) => (
              <StatTile key={t.label} {...t} loading={rows === null && !error} index={i} />
            ))}
          </section>
          <section className="admin-card table-card" data-tour="catering-list">
            <div className="card-head">
              <h2 className="card-title">Förfrågningar och beställningar</h2>
              <select className="compact-select" aria-label="Visa" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="aktiva">Pågående</option>
                <option value="alla">Alla</option>
              </select>
            </div>
            {error && <p className="form-error" role="alert">Kunde inte hämta förfrågningarna.</p>}
            {rows === null && !error && <Loading />}
            {rows !== null && visible.length === 0 && (
              <p className="cell-muted">
                Inga {filter === 'aktiva' ? 'pågående ' : ''}cateringförfrågningar. Gäster skickar dem från
                cateringkalkylen på er webbplats.
              </p>
            )}
            {visible.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Kund</th>
                      <th>Portioner</th>
                      <th>Belopp</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.requestId}>
                        <td className="cell-strong">
                          {formatDate(r.deliveryDate)} {r.deliveryTime}
                          <div className="cell-muted">{r.fulfilment === 'delivery' ? 'Leverans' : 'Avhämtning'}</div>
                        </td>
                        <td>
                          {r.companyName ? `${r.companyName} · ` : ''}
                          {r.customerName}
                        </td>
                        <td>{r.portions != null ? <Num>{r.portions}</Num> : '-'}</td>
                        <td><Num>{kronor(r.total)}</Num></td>
                        <td>
                          <span className={`status-badge ${statusClass(r.status)}`}>{STATUS_LABEL[r.status]}</span>
                          {r.paid && <span className="cell-muted"> · betald</span>}
                        </td>
                        <td>
                          <Link className="link-action" to={`/catering/${locationId}/${r.requestId}`}>
                            Öppna
                          </Link>
                        </td>
                      </tr>
                    ))}
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
