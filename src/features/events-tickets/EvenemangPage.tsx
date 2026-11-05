import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, Button, Card, Field, Input, Modal, Printing, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { useTenant } from '../../shared/tenant'
import {
  ERRORS, STATUS_LABEL, TICKET_LABEL, cancelOccurrence, getEvent, getJob, kr, listEvents, listOrders, newId,
  publishEvent, refundTicket, when, type EventDetail, type EventSummary, type Occurrence, type Order, type Ticket,
} from './api'
import EventEditor from './EventEditor'
import InslappPage from './InslappPage'
import { eventUrl, printPoster } from './posterPrint'
import './evenemang.css'

/**
 * Evenemang (planfunktionen "events", ägare och personal). /evenemang listar,
 * /evenemang/:eventId visar ett evenemang och /evenemang/:eventId/inslapp/:occurrenceId
 * är insläppet vid dörren. Ägaren skapar, publicerar, ställer in och återbetalar;
 * personalen ser evenemangen och sköter insläppet.
 */
export default function EvenemangPage() {
  const { tenant, locationId } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.events)
  const { eventId, occurrenceId } = useParams()
  const isOwner = tenant?.role === 'owner_user'

  return (
    <>
      <AdminTopbar title="Evenemang" />
      <main className="admin-main">
        {!enabled ? (
          <section className="admin-card table-card">
            <h2 className="card-title">Ingår inte i er plan</h2>
            <p className="cell-muted">Evenemang och biljetter ingår inte i er plan. Kontakta oss för att uppgradera.</p>
          </section>
        ) : !locationId ? (
          <Printing label="Hämtar restaurangen" />
        ) : eventId && occurrenceId ? (
          <InslappPage locationId={locationId} eventId={eventId} occurrenceId={occurrenceId} />
        ) : eventId ? (
          <EventView locationId={locationId} eventId={eventId} isOwner={isOwner} primaryDomain={tenant?.primaryDomain} />
        ) : (
          <EventList locationId={locationId} isOwner={isOwner} />
        )}
      </main>
    </>
  )
}

function EventList({ locationId, isOwner }: { locationId: string; isOwner: boolean }) {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let live = true
    listEvents(locationId).then((r) => { if (live) setEvents(r.events) })
      .catch((err) => toast(errorText(err, 'Kunde inte hämta evenemangen.', ERRORS), { tone: 'danger' }))
    return () => { live = false }
  }, [locationId])

  if (creating) {
    return <EventEditor locationId={locationId} onCancel={() => setCreating(false)}
      onSaved={(e) => navigate(`/evenemang/${encodeURIComponent(e.eventId)}`)} />
  }
  return (
    <Card title="Evenemang" actions={isOwner ? <Button variant="primary" onClick={() => setCreating(true)}>Nytt evenemang</Button> : undefined}>
      {!events ? <Printing label="Hämtar evenemangen" /> : null}
      {events && events.length === 0 ? (
        <p className="admin-empty">{isOwner ? 'Inga evenemang än. Skapa ett, till exempel en vinmiddag eller ett quiz, och sälj biljetter på er webbplats.' : 'Inga evenemang än.'}</p>
      ) : null}
      {events?.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Evenemang</th><th scope="col">Nästa tillfälle</th><th scope="col">Sålda</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.eventId}>
                  <td><Link to={`/evenemang/${encodeURIComponent(e.eventId)}`}>{e.title}</Link></td>
                  <td>{e.nextOccurrence ? when(e.nextOccurrence) : '-'}</td>
                  <td>{e.sold} av {e.capacity}</td>
                  <td><span className="status-badge">{STATUS_LABEL[e.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  )
}

function EventView({ locationId, eventId, isOwner, primaryDomain }: { locationId: string; eventId: string; isOwner: boolean; primaryDomain?: string | null }) {
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState<Occurrence | null>(null)

  const load = useCallback(async () => {
    try {
      setEvent(await getEvent(locationId, eventId))
    } catch (err) {
      setMissing(true)
      toast(errorText(err, 'Kunde inte hämta evenemanget.', ERRORS), { tone: 'danger' })
    }
  }, [eventId, locationId])

  useEffect(() => { void load() }, [load])

  if (missing && !event) return <p className="admin-empty"><Link to="/evenemang">Tillbaka till evenemangen</Link></p>
  if (!event) return <Printing label="Hämtar evenemanget" />
  if (editing) {
    return <EventEditor locationId={locationId} existing={event} onCancel={() => setEditing(false)}
      onSaved={(e) => { setEvent(e); setEditing(false) }} />
  }

  async function publish() {
    if (!event) return
    setBusy(true)
    try {
      setEvent(await publishEvent(locationId, event.eventId, event.version))
      toast('Evenemanget är publicerat och syns på er webbplats.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte publicera.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function poster() {
    const url = eventUrl(primaryDomain, eventId)
    if (!url || !event) {
      toast('Restaurangen har ingen egen webbadress än, så affischen kan inte skapas.', { tone: 'warning' })
      return
    }
    if (!await printPoster(event.title, url)) toast('Tillåt popup-fönster för att skriva ut affischen.', { tone: 'warning' })
  }

  const actions = isOwner ? (
    <div className="evenemang-actions">
      {event.status === 'draft' ? <Button variant="primary" busy={busy} onClick={() => { void publish() }}>Publicera</Button> : null}
      {event.status !== 'cancelled' ? <Button variant="secondary" onClick={() => setEditing(true)}>Ändra</Button> : null}
      {event.status === 'published' ? <Button variant="ghost" onClick={() => { void poster() }}>Skriv ut affisch</Button> : null}
    </div>
  ) : undefined

  return (
    <>
      <p className="evenemang-back"><Link to="/evenemang">Alla evenemang</Link></p>
      <Card title={event.title} actions={actions}>
        <p className="cell-muted"><span className="status-badge">{STATUS_LABEL[event.status]}</span></p>
        {event.description ? <p className="evenemang-description">{event.description}</p> : null}
        <h3 className="evenemang-sub">Biljettyper</h3>
        <ul className="evenemang-list">
          {event.ticketTypes.map((t) => (
            <li key={t.typeId}>
              <span>{t.name}{t.includes ? ` (${t.includes})` : ''}</span>
              <span>{kr(t.priceOre)}, {t.vatRate} % moms, {t.sold} sålda{t.capacity ? ` av ${t.capacity}` : ''}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Tillfällen">
        <ul className="evenemang-list">
          {event.occurrences.map((o) => (
            <li key={o.occurrenceId} className="evenemang-occ">
              <div>
                <strong>{when(o.startAt)}</strong>
                {o.status === 'cancelled' ? <span className="status-badge">Inställt</span> : null}
                <Bar variant="meter" value={o.sold} max={o.capacity} label={`Sålda ${when(o.startAt)}`}
                  valueText={`${o.sold} sålda av ${o.capacity}, ${o.checkedIn} insläppta`} />
                {isOwner && o.revenueOre !== undefined ? <span className="cell-muted">Intäkt {kr(o.revenueOre)}</span> : null}
              </div>
              <div className="evenemang-actions">
                {o.status === 'scheduled' && event.status === 'published' ? (
                  <Link className="card-link" to={`/evenemang/${encodeURIComponent(event.eventId)}/inslapp/${encodeURIComponent(o.occurrenceId)}`}>Insläpp</Link>
                ) : null}
                {isOwner && o.status === 'scheduled' && event.status === 'published' ? (
                  <Button size="sm" variant="danger" onClick={() => setCancelling(o)}>Ställ in</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {isOwner && event.status !== 'draft' ? <Orders locationId={locationId} eventId={event.eventId} onChanged={() => void load()} /> : null}
      {cancelling ? (
        <CancelModal locationId={locationId} event={event} occurrence={cancelling}
          onClose={() => { setCancelling(null); void load() }} />
      ) : null}
    </>
  )
}

function CancelModal({ locationId, event, occurrence, onClose }: { locationId: string; event: EventDetail; occurrence: Occurrence; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [jobId] = useState(newId)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: boolean; refunded: number; toRefund: number; failed: number } | null>(null)

  async function confirm() {
    setBusy(true)
    try {
      const started = await cancelOccurrence(locationId, event.eventId, occurrence.occurrenceId,
        { jobId, version: occurrence.version, ...(message.trim() ? { message: message.trim() } : {}) })
      let job = await getJob(locationId, started.jobId)
      setProgress({ done: job.done, refunded: job.counts.refunded, toRefund: started.toRefund, failed: job.counts.failed })
      for (let i = 0; i < 10 && !job.done; i++) {
        await new Promise((r) => window.setTimeout(r, 3000))
        job = await getJob(locationId, started.jobId)
        setProgress({ done: job.done, refunded: job.counts.refunded, toRefund: started.toRefund, failed: job.counts.failed })
      }
    } catch (err) {
      toast(errorText(err, 'Kunde inte ställa in tillfället.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Ställ in tillfället" onClose={onClose} closeLabel="Stäng"
      footer={progress ? <Button onClick={onClose}>Stäng</Button> : (
        <>
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button variant="danger" busy={busy} onClick={() => { void confirm() }}>Ställ in och återbetala</Button>
        </>
      )}>
      {progress ? (
        <>
          <Bar variant="progress" value={progress.toRefund ? progress.refunded / progress.toRefund : 1} label="Återbetalningar"
            valueText={`${progress.refunded} av ${progress.toRefund} återbetalda`} />
          <p className="cell-muted">
            {progress.done ? 'Klart. Alla köpare har fått pengarna tillbaka och ett mejl.'
              : 'Återbetalningarna fortsätter i bakgrunden även om du stänger fönstret.'}
          </p>
        </>
      ) : (
        <>
          <p>{when(occurrence.startAt)}: {occurrence.sold} sålda biljetter återbetalas och köparna får ett mejl. Det går inte att ångra.</p>
          <Field label="Meddelande till gästerna (valfritt)">
            <Input value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  )
}

function Orders({ locationId, eventId, onChanged }: { locationId: string; eventId: string; onChanged: () => void }) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [refunding, setRefunding] = useState<Ticket | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setOrders((await listOrders(locationId, eventId)).orders)
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta köpen.', ERRORS), { tone: 'danger' })
    }
  }, [eventId, locationId])

  useEffect(() => { void load() }, [load])

  async function refund() {
    if (!refunding) return
    setBusy(true)
    try {
      await refundTicket(locationId, refunding.ticketId, reason.trim())
      toast('Biljetten är återbetald.', { tone: 'success' })
      setRefunding(null)
      setReason('')
      await load()
      onChanged()
    } catch (err) {
      toast(errorText(err, 'Kunde inte återbetala.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Köp">
      {!orders ? <Printing label="Hämtar köpen" /> : null}
      {orders && orders.length === 0 ? <p className="admin-empty">Inga köp än.</p> : null}
      {orders?.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Köpare</th><th scope="col">Belopp</th><th scope="col">Biljetter</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId}>
                  <td>{o.buyerName ?? 'Raderad'}<br /><span className="cell-muted">{o.buyerEmail ?? ''}</span></td>
                  <td>{kr(o.amountOre)}{o.refundedOre ? <><br /><span className="cell-muted">{kr(o.refundedOre)} återbetalt</span></> : null}</td>
                  <td>
                    <ul className="evenemang-list">
                      {o.tickets.map((t) => (
                        <li key={t.ticketId}>
                          <span>{t.typeName}, {t.holderName || 'namn saknas'}: {TICKET_LABEL[t.status]}</span>
                          {t.status === 'valid' || t.status === 'checked_in' ? (
                            <Button size="sm" variant="ghost" onClick={() => setRefunding(t)}>Återbetala</Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {refunding ? (
        <Modal open title="Återbetala biljetten" onClose={() => setRefunding(null)} closeLabel="Stäng"
          footer={<>
            <Button variant="ghost" onClick={() => setRefunding(null)}>Avbryt</Button>
            <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => { void refund() }}>Återbetala</Button>
          </>}>
          <p>{refunding.typeName} till {refunding.holderName || 'gästen'}. Pengarna går tillbaka till kortet och biljetten slutar gälla.</p>
          <Field label="Anledning" required>
            <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </Card>
  )
}
