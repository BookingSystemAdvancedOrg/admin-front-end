import { useState } from 'react'
import { Bar, Button, Field, Input, Modal, Select, toast } from '@booqy/brand'
import { errorCode, errorText } from '../../shared/errors'
import { ChangedNote } from '../../shared/ChangedNote'
import { isConflict, mergeEdits } from '../../shared/merge'
import {
  ERRORS, VAT_OPTIONS, kr, updateOccurrence, updateTicketType, when,
  type Occurrence, type TicketType, type TicketTypeEdit, type VatRate,
} from './api'
import {
  MAX_PLACES, priceOre, takenOf, takenText, toUtc, typeForm, validateCapacity, validateType, type TypeForm,
} from './edit'
import { ErrorActions } from '../../shared/ErrorNote'

const TYPE_FIELDS: (keyof TypeForm)[] = ['name', 'includes', 'priceKr', 'vatRate', 'perOrderMax', 'capacity', 'from', 'until']
const SERVER_FIELD: Record<string, keyof TypeForm> = {
  name: 'name', priceOre: 'priceKr', vatRate: 'vatRate', perOrderMax: 'perOrderMax', capacity: 'capacity', tier: 'until',
}

/**
 * Ändra en biljettyp efter att den skapats (ägaren). Sålda och reserverade
 * biljetter behåller sitt pris och sin moms: ändringen gäller nya köp. En
 * ändrad momssats markeras för revisorn. Antalet kan inte bli lägre än det
 * som redan är sålt eller reserverat; servern kontrollerar det i samma
 * skrivning som ändrar antalet, så en försäljning under tiden aldrig översäljs.
 */
export function TypeEditModal({ locationId, eventId, type: opened, latest = null, fetchLatest, onClose, onSaved }: {
  locationId: string; eventId: string
  /** Biljettypen när dialogen öppnades. */
  type: TicketType
  /** Biljettypen som den ser ut nu (sidan hämtas levande); skiljer den sig visas det andra värdet under fältet. */
  latest?: TicketType | null
  /** Den senaste sparade (efter 409 changed_retry). */
  fetchLatest?: () => Promise<TicketType | null>
  onClose: () => void; onSaved: (t: TicketType) => void
}) {
  // Biljettypen dina ändringar utgår från (byts mot den senaste efter en krock).
  const [type, setType] = useState(opened)
  const [form, setForm] = useState<TypeForm>(() => typeForm(opened))
  // Ändrat på annat håll: deras värde per fält, när det skiljer sig från både utgångsläget och ditt.
  const there = latest ? typeForm(latest) : null
  const baseForm = typeForm(type)
  // Fält som ändrats på båda håll vid sparningen: deras värde (står kvar tills du valt).
  const [clashes, setClashes] = useState<Partial<Record<keyof TypeForm, string>>>({})
  const changedThere = (f: keyof TypeForm): string | null => {
    const clash = clashes[f]
    if (clash !== undefined) return clash !== String(form[f]) ? clash : null
    return there && there[f] !== baseForm[f] && there[f] !== form[f] ? String(there[f]) : null
  }
  const note = (f: keyof TypeForm, show: (v: string) => string = (v) => v) => {
    const v = changedThere(f)
    return v === null ? null : <ChangedNote as="span" value={show(v)} onUse={() => set({ [f]: f === 'vatRate' ? Number(v) : v } as Partial<TypeForm>)} />
  }
  const [errors, setErrors] = useState<Partial<Record<keyof TypeForm, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sold = takenOf(type) > 0
  const price = priceOre(form.priceKr)
  const priceChanged = price !== null && price !== type.priceOre
  const vatChanged = form.vatRate !== type.vatRate
  const id = (f: keyof TypeForm) => `type-${type.typeId}-${f}`
  const formId = `type-${type.typeId}-form`

  function set(patch: Partial<TypeForm>) {
    setForm((f) => ({ ...f, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch) as (keyof TypeForm)[]) delete next[k]
      return next
    })
  }

  function focusFirst(found: Partial<Record<keyof TypeForm, string>>) {
    const first = TYPE_FIELDS.find((f) => found[f])
    if (first) window.setTimeout(() => document.getElementById(id(first))?.focus(), 0)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const found = validateType(form, type)
    setErrors(found)
    if (Object.keys(found).length) {
      focusFirst(found)
      return
    }
    const bodyOf = (f: TypeForm, on: TicketType): TicketTypeEdit => {
      const tier = {
        ...(f.from ? { availableFrom: toUtc(f.from) } : {}),
        ...(f.until ? { availableUntil: toUtc(f.until) } : {}),
        ...(on.tier?.untilSold ? { untilSold: on.tier.untilSold } : {}),
      }
      return {
        name: f.name.trim(), priceOre: priceOre(f.priceKr) ?? on.priceOre, vatRate: f.vatRate, perOrderMax: Number(f.perOrderMax),
        sortOrder: on.sortOrder, version: on.version,
        ...(f.capacity.trim() ? { capacity: Number(f.capacity) } : {}),
        ...(f.includes.trim() ? { includes: f.includes.trim() } : {}),
        ...(Object.keys(tier).length ? { tier } : {}),
      }
    }
    setBusy(true)
    try {
      let saved: TicketType
      try {
        saved = await updateTicketType(locationId, eventId, type.typeId, bodyOf(form, type))
      } catch (err) {
        const fresh = isConflict(err) && fetchLatest ? await fetchLatest() : null
        if (!fresh) throw err
        // Någon annan sparade biljettypen emellan: dina ändrade fält ovanpå den senaste, en gång till.
        const { merged, conflicts } = mergeEdits(typeForm(type), form, typeForm(fresh))
        if (conflicts.length) {
          setType(fresh)
          setForm(merged)
          setClashes(Object.fromEntries(conflicts.map((c) => [c.field, String(c.theirs)])))
          setError('Samma fält ändrades nyss på en annan plats. Välj vilket värde som ska gälla och spara igen.')
          return
        }
        saved = await updateTicketType(locationId, eventId, type.typeId, bodyOf(merged, fresh))
      }
      onSaved(saved)
      toast(vatChanged ? 'Biljettypen är sparad. Momsändringen är markerad för revisorn.' : 'Biljettypen är sparad.', { tone: 'success' })
    } catch (err) {
      const field = (err as { field?: string }).field
      // invalid_capacity på tier är taket (untilSold) och hör till antalet; andra tier-fel gäller säljfönstret.
      const local = errorCode(err) === 'invalid_capacity' ? 'capacity' : field ? SERVER_FIELD[field.split('.')[0]] : undefined
      const text = errorText(err, 'Kunde inte spara biljettypen.', {
        ...ERRORS,
        invalid_capacity: 'Fler biljetter hann säljas medan du ändrade. Välj ett större antal.',
        invalid_state: 'Evenemanget är inställt eller har redan passerat, så biljettypen kan inte ändras.',
      })
      if (local && errorCode(err) !== 'changed_retry') {
        setErrors({ [local]: text })
        focusFirst({ [local]: text })
      } else {
        setError(text)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="wide" title={`Ändra biljettyp: ${type.name}`} onClose={onClose} closeLabel="Stäng"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button type="submit" form={formId} variant="primary" busy={busy}>Spara</Button>
        </>
      )}>
      <form id={formId} className="evenemang-form" noValidate onSubmit={(e) => { void save(e) }}>
        {sold ? (
          <p className="cell-muted">
            {takenText(type.sold, type.held)}. Sålda och reserverade biljetter behåller sitt pris och sin moms.
          </p>
        ) : null}
        <div className="evenemang-row">
          <Field label="Namn" required error={errors.name} hint={note('name')}>
            <Input id={id('name')} value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} required />
          </Field>
          <Field label="Pris (kr inkl. moms)" required error={errors.priceKr}
            hint={note('priceKr', (v) => `${v} kr`) ?? (priceChanged && sold ? `Nya priset gäller bara nya köp. Sålda biljetter kostade ${kr(type.priceOre)}.` : undefined)}>
            <Input id={id('priceKr')} inputMode="decimal" value={form.priceKr} onChange={(e) => set({ priceKr: e.target.value })} required />
          </Field>
          <Field label="Moms" error={errors.vatRate} hint={note('vatRate', (v) => `${v} %`) ?? 'Revisorn ska godkänna momssatsen.'}>
            <Select id={id('vatRate')} value={String(form.vatRate)} onChange={(e) => set({ vatRate: Number(e.target.value) as VatRate })}>
              {VAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        </div>
        {vatChanged ? (
          <Bar variant="banner" tone="warning">
            {`Momssatsen ändras från ${type.vatRate} % till ${form.vatRate} % för nya köp.`
              + (sold ? ' Redan sålda biljetter behåller sin moms.' : '')
              + ' Ändringen sparas och markeras för granskning av revisorn.'}
          </Bar>
        ) : null}
        <Field label="Beskrivning" error={errors.includes} hint={note('includes') ?? 'Visas för gästen, till exempel vad som ingår.'}>
          <Input id={id('includes')} value={form.includes} maxLength={300} onChange={(e) => set({ includes: e.target.value })} />
        </Field>
        <div className="evenemang-row">
          <Field label="Antal av typen" error={errors.capacity}
            hint={note('capacity', (v) => v || 'så många som platserna räcker till') ?? (sold ? `Minst ${Math.max(1, takenOf(type))}. Tomt = så många som platserna räcker till.` : 'Tomt = så många som platserna räcker till.')}>
            <Input id={id('capacity')} type="number" inputMode="numeric" min={Math.max(1, takenOf(type))} max={MAX_PLACES}
              value={form.capacity} onChange={(e) => set({ capacity: e.target.value })} />
          </Field>
          <Field label="Max per köp" error={errors.perOrderMax} hint={note('perOrderMax')}>
            <Input id={id('perOrderMax')} type="number" inputMode="numeric" min={1} max={20} value={form.perOrderMax}
              onChange={(e) => set({ perOrderMax: e.target.value })} />
          </Field>
        </div>
        <div className="evenemang-row">
          <Field label="Säljs från" error={errors.from} hint="Tomt = när försäljningen öppnar.">
            <Input id={id('from')} type="datetime-local" value={form.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label="Säljs till" error={errors.until} hint="Tomt = tills försäljningen stänger.">
            <Input id={id('until')} type="datetime-local" value={form.until} onChange={(e) => set({ until: e.target.value })} />
          </Field>
        </div>
        {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
      </form>
    </Modal>
  )
}

/**
 * Ändra antalet platser för ett tillfälle (ägaren). Lägsta antal är sålda +
 * reserverade; sänks det till exakt det blir tillfället slutsålt, höjs det
 * öppnar försäljningen igen.
 */
export function CapacityModal({ locationId, eventId, occurrence: opened, latest = null, fetchLatest, onClose, onSaved }: {
  locationId: string; eventId: string
  /** Tillfället när dialogen öppnades. */
  occurrence: Occurrence
  /** Tillfället som det ser ut nu (sidan hämtas levande). */
  latest?: Occurrence | null
  /** Det senaste sparade (efter 409 changed_retry eller fler sålda). */
  fetchLatest?: () => Promise<Occurrence | null>
  onClose: () => void; onSaved: (o: Occurrence) => void
}) {
  // Tillfället ändringen utgår från: sålda och reserverade följer med när sidan hämtas om.
  const [base, setBase] = useState(opened)
  const occurrence = latest ? { ...latest, capacity: base.capacity, version: base.version } : base
  const [capacity, setCapacity] = useState(String(opened.capacity))
  const [clash, setClash] = useState<number | null>(null)
  const there = clash ?? (latest && latest.capacity !== base.capacity ? latest.capacity : null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = `occ-${occurrence.occurrenceId}-capacity`
  const min = Math.max(1, takenOf(occurrence))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const found = validateCapacity(capacity, occurrence)
    setFieldError(found)
    if (found) {
      document.getElementById(inputId)?.focus()
      return
    }
    setBusy(true)
    try {
      let saved: Occurrence
      try {
        saved = await updateOccurrence(locationId, eventId, occurrence.occurrenceId, { capacity: Number(capacity), version: base.version })
      } catch (err) {
        const fresh = isConflict(err) && fetchLatest ? await fetchLatest() : null
        if (!fresh) throw err
        setBase(fresh)
        // Antalet ändrades också på annat håll, till något annat: visa deras och låt dig välja.
        if (fresh.capacity !== base.capacity && fresh.capacity !== Number(capacity)) {
          setClash(fresh.capacity)
          setError('Antalet platser ändrades nyss på en annan plats. Välj vilket antal som ska gälla och spara igen.')
          return
        }
        saved = await updateOccurrence(locationId, eventId, occurrence.occurrenceId, { capacity: Number(capacity), version: fresh.version })
      }
      onSaved(saved)
      toast('Antalet platser är ändrat.', { tone: 'success' })
    } catch (err) {
      const text = errorText(err, 'Kunde inte ändra antalet platser.', {
        ...ERRORS,
        invalid_capacity: 'Fler platser hann säljas medan du ändrade. Välj ett större antal.',
        invalid_state: 'Tillfället är inställt eller har redan passerat och kan inte ändras.',
      })
      if (errorCode(err) === 'invalid_capacity') {
        setFieldError(text)
        document.getElementById(inputId)?.focus()
      } else {
        setError(text)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Ändra antal platser" onClose={onClose} closeLabel="Stäng"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button type="submit" form={`${inputId}-form`} variant="primary" busy={busy}>Spara</Button>
        </>
      )}>
      <form id={`${inputId}-form`} className="evenemang-form" noValidate onSubmit={(e) => { void save(e) }}>
        <p>{when(occurrence.startAt)}: {takenText(occurrence.sold, occurrence.held)} av {occurrence.capacity} platser.</p>
        <Field label="Antal platser" required error={fieldError ?? undefined}
          hint={there !== null && String(there) !== capacity
            ? <ChangedNote as="span" value={`${there} platser`} onUse={() => { setCapacity(String(there)); setFieldError(null) }} />
            : `Minst ${min}. Sätter du exakt ${min} blir tillfället slutsålt.`}>
          <Input id={inputId} type="number" inputMode="numeric" min={min} max={MAX_PLACES} value={capacity}
            onChange={(e) => { setCapacity(e.target.value); setFieldError(null) }} required />
        </Field>
        {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
      </form>
    </Modal>
  )
}
