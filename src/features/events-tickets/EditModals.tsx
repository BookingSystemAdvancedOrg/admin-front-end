import { useState } from 'react'
import { Bar, Button, Field, Input, Modal, Select, toast } from '@booqy/brand'
import { errorCode, errorText } from '../../shared/errors'
import {
  ERRORS, VAT_OPTIONS, kr, updateOccurrence, updateTicketType, when,
  type Occurrence, type TicketType, type TicketTypeEdit, type VatRate,
} from './api'
import {
  MAX_PLACES, priceOre, takenOf, takenText, toUtc, typeForm, validateCapacity, validateType, type TypeForm,
} from './edit'

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
export function TypeEditModal({ locationId, eventId, type, onClose, onSaved }: {
  locationId: string; eventId: string; type: TicketType; onClose: () => void; onSaved: (t: TicketType) => void
}) {
  const [form, setForm] = useState<TypeForm>(() => typeForm(type))
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
    const tier = {
      ...(form.from ? { availableFrom: toUtc(form.from) } : {}),
      ...(form.until ? { availableUntil: toUtc(form.until) } : {}),
      ...(type.tier?.untilSold ? { untilSold: type.tier.untilSold } : {}),
    }
    const body: TicketTypeEdit = {
      name: form.name.trim(), priceOre: price ?? type.priceOre, vatRate: form.vatRate, perOrderMax: Number(form.perOrderMax),
      sortOrder: type.sortOrder, version: type.version,
      ...(form.capacity.trim() ? { capacity: Number(form.capacity) } : {}),
      ...(form.includes.trim() ? { includes: form.includes.trim() } : {}),
      ...(Object.keys(tier).length ? { tier } : {}),
    }
    setBusy(true)
    try {
      onSaved(await updateTicketType(locationId, eventId, type.typeId, body))
      toast(vatChanged ? 'Biljettypen är sparad. Momsändringen är markerad för revisorn.' : 'Biljettypen är sparad.', { tone: 'success' })
    } catch (err) {
      const field = (err as { field?: string }).field
      // invalid_capacity på tier är taket (untilSold) och hör till antalet; andra tier-fel gäller säljfönstret.
      const local = errorCode(err) === 'invalid_capacity' ? 'capacity' : field ? SERVER_FIELD[field.split('.')[0]] : undefined
      const text = errorText(err, 'Kunde inte spara biljettypen.', {
        ...ERRORS,
        invalid_capacity: 'Fler biljetter såldes medan du ändrade. Stäng, ladda om och välj ett större antal.',
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
          <Field label="Namn" required error={errors.name}>
            <Input id={id('name')} value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} required />
          </Field>
          <Field label="Pris (kr inkl. moms)" required error={errors.priceKr}
            hint={priceChanged && sold ? `Nya priset gäller bara nya köp. Sålda biljetter kostade ${kr(type.priceOre)}.` : undefined}>
            <Input id={id('priceKr')} inputMode="decimal" value={form.priceKr} onChange={(e) => set({ priceKr: e.target.value })} required />
          </Field>
          <Field label="Moms" error={errors.vatRate} hint="Revisorn ska godkänna momssatsen.">
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
        <Field label="Beskrivning" error={errors.includes} hint="Visas för gästen, till exempel vad som ingår.">
          <Input id={id('includes')} value={form.includes} maxLength={300} onChange={(e) => set({ includes: e.target.value })} />
        </Field>
        <div className="evenemang-row">
          <Field label="Antal av typen" error={errors.capacity}
            hint={sold ? `Minst ${Math.max(1, takenOf(type))}. Tomt = så många som platserna räcker till.` : 'Tomt = så många som platserna räcker till.'}>
            <Input id={id('capacity')} type="number" inputMode="numeric" min={Math.max(1, takenOf(type))} max={MAX_PLACES}
              value={form.capacity} onChange={(e) => set({ capacity: e.target.value })} />
          </Field>
          <Field label="Max per köp" error={errors.perOrderMax}>
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
        {error ? <Bar variant="banner" tone="danger">{error}</Bar> : null}
      </form>
    </Modal>
  )
}

/**
 * Ändra antalet platser för ett tillfälle (ägaren). Lägsta antal är sålda +
 * reserverade; sänks det till exakt det blir tillfället slutsålt, höjs det
 * öppnar försäljningen igen.
 */
export function CapacityModal({ locationId, eventId, occurrence, onClose, onSaved }: {
  locationId: string; eventId: string; occurrence: Occurrence; onClose: () => void; onSaved: (o: Occurrence) => void
}) {
  const [capacity, setCapacity] = useState(String(occurrence.capacity))
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
      onSaved(await updateOccurrence(locationId, eventId, occurrence.occurrenceId, { capacity: Number(capacity), version: occurrence.version }))
      toast('Antalet platser är ändrat.', { tone: 'success' })
    } catch (err) {
      const text = errorText(err, 'Kunde inte ändra antalet platser.', {
        ...ERRORS,
        invalid_capacity: 'Fler platser såldes medan du ändrade. Stäng, ladda om och välj ett större antal.',
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
          hint={`Minst ${min}. Sätter du exakt ${min} blir tillfället slutsålt.`}>
          <Input id={inputId} type="number" inputMode="numeric" min={min} max={MAX_PLACES} value={capacity}
            onChange={(e) => { setCapacity(e.target.value); setFieldError(null) }} required />
        </Field>
        {error ? <Bar variant="banner" tone="danger">{error}</Bar> : null}
      </form>
    </Modal>
  )
}
