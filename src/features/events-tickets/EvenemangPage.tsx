import { sameData, useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, Button, Card, Field, Input, Modal, Printing, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { ApiError } from '../../shared/api'
import { errorCode, errorText } from '../../shared/errors'
import { ErrorNote } from '../../shared/ErrorNote'
import { NoLocation } from '../../shared/NoLocation'
import { PlanLocked } from '../../shared/PlanLocked'
import { isRowOpenKey, shouldOpenRow } from '../meny/rowClick'
import { useTenant } from '../../shared/tenant'
import {
  ERRORS, STATUS_LABEL, cancelOccurrence, eventEditable, getEvent, getJob, kr, listEvents, listOrders,
  newId, occurrenceOpen, publishEvent, refundTicket, ticketLabel, when,
  type EventDetail, type EventSummary, type Occurrence, type Order, type Ticket, type TicketType,
} from './api'
import { CapacityModal, TypeEditModal } from './EditModals'
import EventEditor from './EventEditor'
import InslappPage from './InslappPage'
import { eventUrl, printPoster } from './posterPrint'
import './evenemang.css'
import { BackButton } from '../../shared/BackButton'

/**
 * Evenemang (planfunktionen "events", ägare och personal). /evenemang listar,
 * /evenemang/:eventId visar ett evenemang och /evenemang/:eventId/inslapp/:occurrenceId
 * är insläppet vid dörren. Ägaren skapar, publicerar, ställer in och återbetalar;
 * personalen ser evenemangen och sköter insläppet.
 */
export default function EvenemangPage() {
  const { tenant, locationId, status } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.events)
  const { eventId, occurrenceId } = useParams()
  const isOwner = tenant?.role === 'owner_user'

  return (
    <>
      <AdminTopbar title="Evenemang" />
      <main className="admin-main">
        {!enabled ? (
          <PlanLocked />
        ) : !locationId ? (
          status === 'loading' || status === 'idle' ? <Printing label="Hämtar restaurangen" /> : <NoLocation />
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let live = true
    setLoadError(null)
    listEvents(locationId).then((r) => { if (live) setEvents(r.events) })
      .catch((err) => { if (live) setLoadError(errorText(err, 'Evenemangen kunde inte visas.', ERRORS)) })
    return () => { live = false }
  }, [locationId, attempt])
  // Levande: försäljning och ändringar från en annan plats syns av sig själva.
  useLiveRefresh(async () => setEvents((await listEvents(locationId)).events), { enabled: events !== null && !creating })

  if (creating) {
    return <EventEditor locationId={locationId} onCancel={() => setCreating(false)}
      onSaved={(e) => navigate(`/evenemang/${encodeURIComponent(e.eventId)}`)} />
  }
  return (
    <Card title="Evenemang" actions={isOwner ? <Button variant="primary" onClick={() => setCreating(true)}>Nytt evenemang</Button> : undefined}>
      {!events ? (loadError
        ? <ErrorNote text={loadError} onRetry={() => setAttempt((n) => n + 1)} />
        : <Printing label="Hämtar evenemangen" />) : null}
      {events && events.length === 0 ? (
        <p className="admin-empty">Inga evenemang än.</p>
      ) : null}
      {events?.length ? (
        <div className="table-scroll" tabIndex={0}>
          <table className="data-table evenemang-table">
            <thead><tr><th scope="col">Evenemang</th><th scope="col">Nästa tillfälle</th><th scope="col">Sålda</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.eventId}
                  className="person-row"
                  tabIndex={0}
                  aria-label={`${e.title}, öppna`}
                  onClick={(ev) => { if (shouldOpenRow(ev.target, ev.currentTarget)) navigate(`/evenemang/${encodeURIComponent(e.eventId)}`) }}
                  onKeyDown={(ev) => { if (isRowOpenKey(ev)) { ev.preventDefault(); navigate(`/evenemang/${encodeURIComponent(e.eventId)}`) } }}
                >
                  <td className="cell-strong">{e.title}</td>
                  <td data-label="Nästa tillfälle">{e.nextOccurrence ? when(e.nextOccurrence) : '-'}</td>
                  <td data-label="Sålda">{e.sold} av {e.capacity}</td>
                  <td data-label="Status"><span className="status-badge">{STATUS_LABEL[e.status]}</span></td>
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
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Evenemanget som det såg ut när ändringen började (formuläret utgår från det). */
  const [editing, setEditing] = useState<EventDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState<Occurrence | null>(null)
  const [editingType, setEditingType] = useState<TicketType | null>(null)
  const [editingOcc, setEditingOcc] = useState<Occurrence | null>(null)
  // Knappen som öppnade en ändringsdialog: fokus går tillbaka dit när den stängs (tangentbord, skärmläsare).
  const opener = useRef<HTMLElement | null>(null)
  const refocus = () => { window.setTimeout(() => opener.current?.focus(), 0) }

  const load = useCallback(async () => {
    try {
      setEvent(await getEvent(locationId, eventId))
      setLoadError(null)
    } catch (err) {
      if ((err instanceof ApiError && err.status === 404) || errorCode(err) === 'not_found') setMissing(true)
      else setLoadError(errorText(err, 'Evenemanget kunde inte visas.', ERRORS))
    }
  }, [eventId, locationId])

  useEffect(() => { void load() }, [load])
  // Levande: sålda biljetter och ändringar från en kollega syns av sig själva.
  useLiveRefresh(async () => {
    const next = await getEvent(locationId, eventId)
    setEvent((cur) => (sameData(cur, next) ? cur : next))
  }, { enabled: event !== null && !busy })

  if (missing && !event) {
    return (
      <section className="admin-card table-card">
        <div className="back-row"><BackButton to="/evenemang">Tillbaka till evenemangen</BackButton></div>
        <h2 className="card-title">Evenemanget finns inte</h2>
      </section>
    )
  }
  if (!event && loadError) {
    return (
      <>
        <div className="back-row"><BackButton to="/evenemang">Tillbaka till evenemangen</BackButton></div>
        <ErrorNote text={loadError} onRetry={() => { setLoadError(null); void load() }} />
      </>
    )
  }
  if (!event) return <Printing label="Hämtar evenemanget" />
  if (editing) {
    return <EventEditor locationId={locationId} existing={editing} fetchLatest={() => getEvent(locationId, eventId)}
      onCancel={() => setEditing(null)}
      onSaved={(e) => { setEvent(e); setEditing(null) }} />
  }

  async function publish() {
    if (!event) return
    setBusy(true)
    try {
      setEvent(await publishEvent(locationId, event.eventId, event.version))
      toast('Evenemanget är publicerat och syns på er webbplats.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Evenemanget publicerades inte.', ERRORS), { tone: 'danger' })
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
    if (!await printPoster(event.title, url)) toast('Webbläsaren stoppade affischen. Tillåt popup-fönster för Booqy och tryck igen.', { tone: 'warning' })
  }

  const actions = isOwner ? (
    <div className="evenemang-actions">
      {event.status === 'draft' ? <Button variant="primary" busy={busy} onClick={() => { void publish() }}>Publicera</Button> : null}
      {event.status !== 'cancelled' ? <Button variant="secondary" onClick={() => setEditing(event)}>Ändra</Button> : null}
      {event.status === 'published' ? <Button variant="ghost" onClick={() => { void poster() }}>Skriv ut affisch</Button> : null}
    </div>
  ) : undefined

  return (
    <>
      <div className="back-row"><BackButton to="/evenemang">Tillbaka till evenemangen</BackButton></div>
      <Card title={event.title} actions={actions}>
        <p className="cell-muted"><span className="status-badge">{STATUS_LABEL[event.status]}</span></p>
        {event.description ? <p className="evenemang-description">{event.description}</p> : null}
        <p className="cell-muted">
          {event.settings.transferAllowed ? 'Gästen får ge bort sin biljett. ' : 'Biljetter kan inte ges bort. '}
          {event.settings.resaleAllowed
            ? 'Vidareförsäljning till samma pris är på: biljetter som gäster lägger ut syns på er webbplats.'
            : 'Vidareförsäljning är av.'}
        </p>
        <h3 className="evenemang-sub">Biljettyper</h3>
        <ul className="evenemang-list">
          {event.ticketTypes.map((t) => (
            <li key={t.typeId}>
              <span>
                {t.name}{t.includes ? ` (${t.includes})` : ''}
                {t.vatReview ? <> <span className="status-badge">Momsen ändrad: revisorn ska granska</span></> : null}
              </span>
              <span className="evenemang-actions">
                <span>
                  {kr(t.priceOre)}, {t.vatRate} % moms, {t.sold} sålda{t.capacity ? ` av ${t.capacity}` : ''}
                  {t.held ? `, ${t.held} reserverade` : ''}
                </span>
                {isOwner && eventEditable(event) ? (
                  <Button size="sm" variant="ghost" aria-label={`Ändra ${t.name}`} onClick={(e) => { opener.current = e.currentTarget; setEditingType(t) }}>Ändra</Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Tillfällen">
        <div className="evenemang-occs">
        <ul className="evenemang-list">
          {event.occurrences.map((o) => (
            <li key={o.occurrenceId} className="evenemang-occ">
              <div>
                <strong>{when(o.startAt)}</strong>
                {o.status === 'cancelled' ? <span className="status-badge">Inställt</span> : null}
                <Bar variant="meter" value={o.sold} max={o.capacity} label={`Sålda ${when(o.startAt)}`}
                  valueText={`${o.sold} sålda av ${o.capacity}, ${o.checkedIn} insläppta`} />
                {isOwner && o.revenueOre !== undefined ? <span className="cell-muted">Intäkt {kr(o.revenueOre)}</span> : null}
                {o.resaleListed ? (
                  <span className="cell-muted">{o.resaleListed === 1 ? '1 biljett till salu i andra hand' : `${o.resaleListed} biljetter till salu i andra hand`}</span>
                ) : null}
              </div>
              <div className="evenemang-actions">
                {o.status === 'scheduled' && event.status === 'published' ? (
                  <Link className="card-link" to={`/evenemang/${encodeURIComponent(event.eventId)}/inslapp/${encodeURIComponent(o.occurrenceId)}`}>Insläpp</Link>
                ) : null}
                {isOwner && event.status !== 'cancelled' && occurrenceOpen(o) ? (
                  <Button size="sm" variant="secondary" aria-label={`Ändra platser ${when(o.startAt)}`}
                    onClick={(e) => { opener.current = e.currentTarget; setEditingOcc(o) }}>Ändra platser</Button>
                ) : null}
                {isOwner && o.status === 'scheduled' && event.status === 'published' ? (
                  <Button size="sm" variant="danger" onClick={() => setCancelling(o)}>Ställ in</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        </div>
      </Card>
      {isOwner && event.status !== 'draft' ? <Orders locationId={locationId} eventId={event.eventId} onChanged={() => void load()} /> : null}
      {editingType ? (
        <TypeEditModal locationId={locationId} eventId={event.eventId} type={editingType}
          latest={event.ticketTypes.find((t) => t.typeId === editingType.typeId) ?? null}
          fetchLatest={async () => (await getEvent(locationId, eventId)).ticketTypes.find((t) => t.typeId === editingType.typeId) ?? null}
          onClose={() => { setEditingType(null); refocus(); void load() }}
          onSaved={(t) => {
            setEditingType(null)
            refocus()
            setEvent((e) => e && { ...e, ticketTypes: e.ticketTypes.map((x) => (x.typeId === t.typeId ? t : x)) })
          }} />
      ) : null}
      {editingOcc ? (
        <CapacityModal locationId={locationId} eventId={event.eventId} occurrence={editingOcc}
          latest={event.occurrences.find((o) => o.occurrenceId === editingOcc.occurrenceId) ?? null}
          fetchLatest={async () => (await getEvent(locationId, eventId)).occurrences.find((o) => o.occurrenceId === editingOcc.occurrenceId) ?? null}
          onClose={() => { setEditingOcc(null); refocus(); void load() }}
          onSaved={(o) => {
            setEditingOcc(null)
            refocus()
            setEvent((e) => e && { ...e, occurrences: e.occurrences.map((x) => (x.occurrenceId === o.occurrenceId ? o : x)) })
          }} />
      ) : null}
      {cancelling ? (
        <CancelModal locationId={locationId} event={event} occurrence={cancelling}
          onClose={() => { setCancelling(null); void load() }} />
      ) : null}
    </>
  )
}

const JOB_POLL_MS = 3000
const JOB_POLLS = 100

/**
 * Ställ in = en återbetalningskörning (K9 svarar 202, resten gör servern i
 * bakgrunden). Samma jobId hela vägen: om svaret aldrig kom (timeout, tappad
 * anslutning) frågar vi K14 om jobbet finns innan vi visar ett fel, så ett
 * jobb som faktiskt startade visas som pågående i stället för som misslyckat.
 */
function CancelModal({ locationId, event, occurrence, onClose }: { locationId: string; event: EventDetail; occurrence: Occurrence; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [jobId] = useState(newId)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: boolean; refunded: number; toRefund: number; failed: number } | null>(null)

  async function confirm() {
    setBusy(true)
    try {
      let toRefund = occurrence.sold
      try {
        toRefund = (await cancelOccurrence(locationId, event.eventId, occurrence.occurrenceId,
          { jobId, version: occurrence.version, ...(message.trim() ? { message: message.trim() } : {}) })).toRefund
      } catch (err) {
        const started = await getJob(locationId, jobId).catch(() => null)
        if (!started) throw err
        toRefund = started.toRefund
      }
      let job = await getJob(locationId, jobId)
      setProgress({ done: job.done, refunded: job.counts.refunded, toRefund, failed: job.counts.failed })
      for (let i = 0; i < JOB_POLLS && !job.done; i++) {
        await new Promise((r) => window.setTimeout(r, JOB_POLL_MS))
        job = await getJob(locationId, jobId)
        setProgress({ done: job.done, refunded: job.counts.refunded, toRefund, failed: job.counts.failed })
      }
    } catch (err) {
      toast(errorText(err, 'Tillfället ställdes inte in.', ERRORS), { tone: 'danger' })
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
              : progress.failed > 0
                ? `${progress.failed} återbetalningar väntar på Stripe och görs om automatiskt inom några minuter. Du kan stänga fönstret.`
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const shown = useRef(false)
  shown.current = orders !== null

  const load = useCallback(async () => {
    try {
      setOrders((await listOrders(locationId, eventId)).orders)
      setLoadError(null)
    } catch (err) {
      const text = errorText(err, 'Köpen kunde inte visas.', ERRORS)
      // Redan visade köp står kvar; bara en första hämtning som misslyckas visas i kortet.
      if (shown.current) toast(text, { tone: 'danger' })
      else setLoadError(text)
    }
  }, [eventId, locationId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => setOrders((await listOrders(locationId, eventId)).orders), { enabled: orders !== null && !busy })

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
      toast(errorText(err, 'Pengarna betalades inte tillbaka.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Köp">
      {!orders ? (loadError
        ? <ErrorNote text={loadError} onRetry={() => { setLoadError(null); void load() }} />
        : <Printing label="Hämtar köpen" />) : null}
      {orders && orders.length === 0 ? <p className="admin-empty">Inga köp än.</p> : null}
      {orders?.length ? (
        <div className="table-scroll" tabIndex={0}>
          <table className="data-table evenemang-table">
            <thead><tr><th scope="col">Köpare</th><th scope="col">Belopp</th><th scope="col">Biljetter</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId}>
                  <td>
                    {o.buyerName ?? 'Raderad'}<br /><span className="cell-muted">{o.buyerEmail ? <>{o.buyerEmail.split('@')[0]}<wbr />{o.buyerEmail.slice(o.buyerEmail.split('@')[0].length)}</> : ''}</span>
                    {o.resale ? <><br /><span className="status-badge">Andrahandsköp</span></> : null}
                  </td>
                  <td data-label="Belopp"><span className="evenemang-amount">{kr(o.amountOre)}</span>{o.refundedOre ? <><br /><span className="cell-muted"><span className="evenemang-amount">{kr(o.refundedOre)}</span> återbetalt</span></> : null}</td>
                  <td data-label="Biljetter">
                    <ul className="evenemang-list">
                      {o.tickets.map((t) => (
                        <li key={t.ticketId}>
                          <span>{t.typeName}, {t.holderName || 'namn saknas'}: {ticketLabel(t)}</span>
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
