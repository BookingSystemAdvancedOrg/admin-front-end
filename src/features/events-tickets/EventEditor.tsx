import { useState } from 'react'
import { Bar, Button, Card, Field, Input, toast } from '@booqy/brand'
import { BrandSelect as Select } from '../../shared/Select'
import { errorText } from '../../shared/errors'
import { ChangedNote } from '../../shared/ChangedNote'
import { isConflict, mergeEdits, type FieldConflict } from '../../shared/merge'
import { ERRORS, VAT_OPTIONS, createEvent, newId, updateEvent, type EventDetail, type NewEvent, type VatRate } from './api'
import EventImageField from './EventImageField'
import { imageAltError, imageFields, initialImage, type EventImage } from './eventImage'
import { ErrorActions } from '../../shared/ErrorNote'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { DateInput, TimeInput } from '../../shared/DateInput'
import { useDirtyForm } from '../../shared/dirtyForm'
import { useUnsavedGuard } from '../../shared/unsaved'

interface TypeRow { typeId: string; name: string; priceKr: string; vatRate: VatRate; perOrderMax: string; capacity: string; includes: string }


/** Bilden i formuläret (redigeraren) från fusionens bildfält. */
function formImage(v: { key: string; alt: string }): EventImage {
  return { key: v.key || null, file: null, alt: v.alt }
}

function sameImage(cur: EventImage, v: { key: string; alt: string }): boolean {
  return !cur.file && (cur.key ?? '') === v.key && cur.alt.trim() === v.alt
}

/** Det andra bildvalet i klartext för raden under bilden. */
function imageLabel(v: { key: string; alt: string }): string {
  return v.key ? `en annan bild (${v.alt})` : 'ingen bild'
}

function newType(): TypeRow {
  return { typeId: newId(), name: '', priceKr: '', vatRate: 12, perOrderMax: '10', capacity: '', includes: '' }
}

/**
 * Start och slut i lokal tid som ISO. Ett slut som inte ligger efter starten
 * (01:00 efter 21:00) är nästa dag: ett evenemang får sluta efter midnatt.
 */
export function occurrenceWindow(date: string, start: string, end: string): { startAt: string; endAt: string } {
  const startAt = new Date(`${date}T${start}:00`)
  const endAt = new Date(`${date}T${end}:00`)
  if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1)
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() }
}

/**
 * Nytt evenemang (ägaren) eller ändring av titel, text och villkor. Biljettyper
 * och tillfällen skapas här; efter publicering ändras tillfällena ett och ett.
 * Momssatsen per biljettyp väljs ur en lista som revisorn ska godkänna.
 */
/** Fälten som ändras på ett befintligt evenemang (för att lägga ihop med en ändring på annat håll). */
interface EventForm {
  title: string; description: string; perOrderMax: string; transferAllowed: boolean; resaleAllowed: boolean; refundPolicy: string
  /** Bilden som ett fält: nyckel och alt-text hör ihop (tom nyckel = ingen bild). */
  image: { key: string; alt: string }
}

function imageOf(e: { imageKey?: string; imageAlt?: string }): EventForm['image'] {
  return e.imageKey ? { key: e.imageKey, alt: (e.imageAlt ?? '').trim() } : { key: '', alt: '' }
}

function eventForm(e: EventDetail): EventForm {
  return {
    title: e.title, description: e.description ?? '', perOrderMax: String(e.settings.perOrderMax ?? 10),
    transferAllowed: e.settings.transferAllowed ?? true, resaleAllowed: e.settings.resaleAllowed ?? false, refundPolicy: e.settings.refundPolicy ?? '',
    image: imageOf(e),
  }
}

export default function EventEditor({ locationId, existing, fetchLatest, onSaved, onCancel }: {
  locationId: string
  /** Evenemanget som det såg ut när ändringen började. */
  existing?: EventDetail
  /** Det senaste sparade (efter 409 changed_retry): dina fält läggs ovanpå och sparas igen. */
  fetchLatest?: () => Promise<EventDetail>
  onSaved: (e: EventDetail) => void
  onCancel: () => void
}) {
  // Evenemanget som dina ändringar utgår från (byts mot det senaste efter en krock).
  const [base, setBase] = useState(existing)
  const [clashes, setClashes] = useState<FieldConflict[]>([])
  const clash = (field: keyof EventForm) => clashes.find((c) => c.field === field)
  const imageClash = clash('image')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [date, setDate] = useState('')
  const [start, setStart] = useState('19:00')
  const [end, setEnd] = useState('22:00')
  const [capacity, setCapacity] = useState('40')
  const [repeat, setRepeat] = useState<'' | 'weekly' | 'monthly'>(existing?.series?.freq ?? '')
  const [until, setUntil] = useState(existing?.series?.until ?? '')
  const [types, setTypes] = useState<TypeRow[]>([newType()])
  const [perOrderMax, setPerOrderMax] = useState(String(existing?.settings.perOrderMax ?? 10))
  const [transferAllowed, setTransferAllowed] = useState(existing?.settings.transferAllowed ?? true)
  const [resaleAllowed, setResaleAllowed] = useState(existing?.settings.resaleAllowed ?? false)
  const [refundPolicy, setRefundPolicy] = useState(existing?.settings.refundPolicy ?? '')
  const [image, setImage] = useState(() => initialImage(existing))
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eventId] = useState(() => existing?.eventId ?? newId())
  // Spara följer ändringarna: avstängd tills något skiljer sig från det som öppnades.
  const form = {
    title, description, date, start, end, capacity, repeat, until, types, perOrderMax, transferAllowed, resaleAllowed, refundPolicy,
    image: { key: image.key, alt: image.alt, file: image.file ? [image.file.name, image.file.size] : null },
  }
  const [opened] = useState(form)
  const dirty = useDirtyForm(form, opened)
  useUnsavedGuard(dirty)

  function setType(i: number, patch: Partial<TypeRow>) {
    setTypes((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  // Uppladdad bild behålls vid fel i själva sparandet: ett nytt försök laddar inte upp den igen.
  function keepUploaded(key: string) { setImage((cur) => ({ ...cur, key, file: null })) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const settings = { perOrderMax: Number(perOrderMax), transferAllowed, resaleAllowed, refundPolicy: refundPolicy.trim() || undefined }
    const altProblem = imageAltError(image)
    if (altProblem) {
      setShowErrors(true)
      setError(altProblem)
      return
    }
    setBusy(true)
    try {
      if (existing && base) {
        const pictured = await imageFields(locationId, image, keepUploaded)
        const mine: EventForm = { title, description, perOrderMax, transferAllowed, resaleAllowed, refundPolicy, image: imageOf(pictured) }
        // Ingen bild = inga fält (servern tar bort bilden), så bilden följer fusionen som de andra fälten.
        const send = (v: EventForm, on: EventDetail) => updateEvent(locationId, existing.eventId, {
          title: v.title.trim(), description: v.description, version: on.version,
          settings: { perOrderMax: Number(v.perOrderMax), transferAllowed: v.transferAllowed, resaleAllowed: v.resaleAllowed, refundPolicy: v.refundPolicy.trim() || undefined },
          ...(v.image.key ? { imageKey: v.image.key, imageAlt: v.image.alt } : {}),
          ...(on.status === 'draft' && repeat && until ? { series: { freq: repeat, until } } : {}),
        })
        setClashes([])
        try {
          onSaved(await send(mine, base))
        } catch (err) {
          if (!isConflict(err) || !fetchLatest) throw err
          // Någon annan sparade emellan: dina ändrade fält ovanpå det senaste, en gång till.
          const latest = await fetchLatest()
          const { merged, conflicts } = mergeEdits(eventForm(base), mine, eventForm(latest))
          if (conflicts.length) {
            // Fält du inte rört tar det senaste; dina står kvar och nästa sparning går mot den nya versionen.
            setTitle(merged.title)
            setDescription(merged.description)
            setPerOrderMax(merged.perOrderMax)
            setTransferAllowed(merged.transferAllowed)
            setResaleAllowed(merged.resaleAllowed)
            setRefundPolicy(merged.refundPolicy)
            setImage(formImage(merged.image))
            setBase(latest)
            setClashes(conflicts)
            setError('Någon annan ändrade samma fält nyss. Välj vilket värde som ska gälla och spara igen.')
            return
          }
          onSaved(await send(merged, latest))
        }
      } else {
        if (!date) {
          setError('Välj ett datum.')
          return
        }
        const pictured = await imageFields(locationId, image, keepUploaded)
        const body: NewEvent = {
          eventId, title: title.trim(), description, ...pictured,
          occurrences: [{ ...occurrenceWindow(date, start, end), capacity: Number(capacity) }],
          ticketTypes: types.map((t, i) => ({
            typeId: t.typeId, name: t.name.trim(), priceOre: Math.round(Number(t.priceKr.replace(',', '.')) * 100),
            vatRate: t.vatRate, perOrderMax: Number(t.perOrderMax), sortOrder: i,
            ...(t.capacity ? { capacity: Number(t.capacity) } : {}), ...(t.includes.trim() ? { includes: t.includes.trim() } : {}),
          })),
          settings,
          ...(repeat && until ? { series: { freq: repeat, until } } : {}),
        }
        onSaved(await createEvent(locationId, body))
      }
      toast('Evenemanget är sparat.', { tone: 'success' })
    } catch (err) {
      setError(errorText(err, 'Evenemanget sparades inte.', ERRORS))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={existing ? 'Ändra evenemanget' : 'Nytt evenemang'}>
      <form className="evenemang-form" onSubmit={(e) => { void save(e) }}>
        <Field label="Namn" required hint={clash('title') && title !== clash('title')?.theirs
          ? <ChangedNote as="span" value={String(clash('title')?.theirs)} onUse={() => setTitle(String(clash('title')?.theirs))} />
          : undefined}>
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
        </Field>

        <Field label="Beskrivning" hint={clash('description') && description !== clash('description')?.theirs
          ? <ChangedNote as="span" value={String(clash('description')?.theirs)} onUse={() => setDescription(String(clash('description')?.theirs))} />
          : 'Visas på er webbplats. Gör ni reklam för alkohol är det ert ansvar att följa alkohollagen.'}>
          <textarea className="evenemang-text" value={description} maxLength={4000} rows={4}
            onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <EventImageField value={image} onChange={(next) => { setImage(next); if (error) setError(null) }} showErrors={showErrors}
          note={imageClash && !sameImage(image, imageClash.theirs as EventForm['image'])
            ? <ChangedNote value={imageLabel(imageClash.theirs as EventForm['image'])} onUse={() => setImage(formImage(imageClash.theirs as EventForm['image']))} />
            : undefined} />
        {!existing ? (
          <>
            <div className="evenemang-row">
              <Field label="Datum" required><DateInput inputClassName="bq-input" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
              <Field label="Börjar"><TimeInput inputClassName="bq-input" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
              <Field label="Slutar" hint="Före starten = nästa dag">
                <TimeInput inputClassName="bq-input" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </Field>
              <Field label="Platser"><Input type="number" min={1} max={10000} value={capacity} onChange={(e) => setCapacity(e.target.value)} required /></Field>
            </div>
            <fieldset className="evenemang-fieldset">
              <legend>Biljettyper</legend>
              {types.map((t, i) => (
                <div className="evenemang-row evenemang-type-row" key={t.typeId}>
                  <Field label="Namn"><Input value={t.name} maxLength={80} onChange={(e) => setType(i, { name: e.target.value })} required /></Field>
                  <Field label="Pris (kr inkl. moms)"><Input inputMode="decimal" value={t.priceKr} onChange={(e) => setType(i, { priceKr: e.target.value })} required /></Field>
                  <Field label="Moms" hint="Revisorn ska godkänna momssatsen.">
                    <Select value={String(t.vatRate)} onChange={(e) => setType(i, { vatRate: Number(e.target.value) as VatRate })}>
                      {VAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Max per köp"><Input type="number" min={1} max={20} value={t.perOrderMax} onChange={(e) => setType(i, { perOrderMax: e.target.value })} /></Field>
                  <Field label="Antal av typen" hint="Tomt = så många som platserna räcker till.">
                    <Input type="number" min={1} value={t.capacity} onChange={(e) => setType(i, { capacity: e.target.value })} />
                  </Field>
                  <Field label="Ingår"><Input value={t.includes} maxLength={300} onChange={(e) => setType(i, { includes: e.target.value })} /></Field>
                  {types.length > 1 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setTypes((rows) => rows.filter((_, j) => j !== i))}>Ta bort</Button>
                  ) : null}
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setTypes((rows) => [...rows, newType()])}>Lägg till biljettyp</Button>
            </fieldset>
          </>
        ) : null}
        {!existing || existing.status === 'draft' ? (
          <div className="evenemang-row">
            <Field label="Upprepa">
              <Select value={repeat} onChange={(e) => setRepeat(e.target.value as '' | 'weekly' | 'monthly')}>
                <option value="">Ingen upprepning</option>
                <option value="weekly">Varje vecka</option>
                <option value="monthly">Varje månad (samma veckodag)</option>
              </Select>
            </Field>
            {repeat ? <Field label="Till och med" hint="Högst ett år framåt."><DateInput inputClassName="bq-input" value={until} onChange={(e) => setUntil(e.target.value)} required /></Field> : null}
          </div>
        ) : null}
        <div className="evenemang-row">
          <Field label="Max biljetter per köp"><Input type="number" min={1} max={20} value={perOrderMax} onChange={(e) => setPerOrderMax(e.target.value)} /></Field>
          <label className="evenemang-check">
            <input type="checkbox" checked={transferAllowed} onChange={(e) => setTransferAllowed(e.target.checked)} />
            Gästen får ge bort sin biljett (stänger 2 timmar före start)
          </label>
        </div>
        <div className="evenemang-check-block">
          <label className="evenemang-check">
            <input type="checkbox" checked={resaleAllowed} onChange={(e) => setResaleAllowed(e.target.checked)} />
            Gästen får sälja sin biljett vidare
          </label>
          <InfoTooltip label="Vidareförsäljning">
            Via er webbplats, stänger 2 timmar före start. Alltid till samma pris som gästen betalade, aldrig mer. Köparen betalar till ert Stripe-konto och säljaren får
            pengarna tillbaka automatiskt; ni behåller intäkten och bokföringen går jämnt ut. Stripes avgifter för båda
            betalningarna står ni för.
          </InfoTooltip>
        </div>
        <Field label="Villkor för återbetalning" hint="Visas vid köpet">
          <textarea className="evenemang-text" value={refundPolicy} maxLength={1000} rows={2} onChange={(e) => setRefundPolicy(e.target.value)} />
        </Field>
        {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
        <Bar variant="action" label="Spara evenemanget" sticky={dirty} status={dirty && !busy ? 'Osparade ändringar' : undefined}>
          <Button type="button" variant="secondary" onClick={onCancel}>Avbryt</Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Sparar…" disabled={!dirty}>{error ? 'Spara igen' : 'Spara'}</Button>
        </Bar>
      </form>
    </Card>
  )
}
