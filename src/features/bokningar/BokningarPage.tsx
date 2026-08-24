import { useEffect, useRef, useState } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import {
  MOCK_RESERVATIONS,
  STATUS_CLASS,
  STATUS_LABEL,
} from './data'
import type { Reservation } from './data'
import './bokningar.css'

/**
 * Figma: admin-bokningar-page (45:2). Kör på mockdata tills API:t kopplas.
 *
 * Bokningar som är Reserverad/Väntar har en "Anlänt?"-knapp. Ett klick
 * visar "Bekräfta" (skydd mot feltryck), och klicket därpå låser raden
 * till Anlänt — permanent: en anländ kund kan inte ändras tillbaka.
 * Mot backend blir det: PATCH /reservations/:id { status: 'arrived' }.
 */
export default function BokningarPage() {
  const [reservations, setReservations] =
    useState<Reservation[]>(MOCK_RESERVATIONS)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Bekräfta-läget återgår av sig självt efter några sekunder.
  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  function requestArrive(id: string) {
    if (confirmId === id) {
      // Andra klicket: lås som anländ.
      setReservations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: 'arrived' } : r)),
      )
      setConfirmId(null)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      return
    }
    setConfirmId(id)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmId(null), 4000)
  }

  return (
    <>
      <AdminTopbar title="Bokningar" />
      <div className="admin-main">
        <section className="admin-card table-card">
          <div className="card-head">
            <h2 className="card-title">Kommande bokningar</h2>
            <span className="cell-muted">
              {reservations.length} bokningar denna vecka
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kund</th>
                  <th>Datum &amp; tid</th>
                  <th>Bord</th>
                  <th>Gäster</th>
                  <th>Belopp</th>
                  <th>Status</th>
                  <th>Telefon</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const canArrive =
                    r.status === 'reserved' || r.status === 'waiting'
                  const locked = r.status === 'arrived'
                  return (
                    <tr key={r.id}>
                      <td className="cell-strong">{r.customer}</td>
                      <td>{r.dateLabel}</td>
                      <td>{r.table}</td>
                      <td>{r.guests}</td>
                      <td className="cell-strong">
                        {r.amount === null ? '—' : `${r.amount} kr`}
                      </td>
                      <td>
                        <span className="status-cell">
                          <span
                            className={`status-badge ${STATUS_CLASS[r.status]}${locked ? ' locked' : ''}`}
                            title={
                              locked
                                ? 'Låst — kunden har anlänt och status kan inte ändras'
                                : undefined
                            }
                          >
                            {STATUS_LABEL[r.status]}
                            {locked && ' ✓'}
                          </span>
                          {canArrive && (
                            <button
                              type="button"
                              className={
                                confirmId === r.id
                                  ? 'arrive-btn confirm'
                                  : 'arrive-btn'
                              }
                              title={
                                confirmId === r.id
                                  ? 'Klicka igen för att låsa som anländ'
                                  : 'Markera att kunden har anlänt (låses)'
                              }
                              onClick={() => requestArrive(r.id)}
                            >
                              {confirmId === r.id ? 'Bekräfta' : 'Anlänt?'}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="cell-muted">{r.phone}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
