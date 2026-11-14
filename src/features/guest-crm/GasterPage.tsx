import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveRefresh } from '../../shared/live'
import { ConflictError, isConflict, mergeEdits } from '../../shared/merge'
import { ChangedNote } from '../../shared/ChangedNote'
import { Bar, Button, Card, Field, Input, Modal, Select, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { useTenant } from '../../shared/tenant'
import {
  formatDay,
  getGuest,
  listGuests,
  newId,
  rebuildGuests,
  searchGuests,
  updateGuest,
  type GuestDetail,
  type GuestSummary,
} from './api'
import './gaster.css'
import { ErrorActions } from '../../shared/ErrorNote'

const KIND_LABEL = { booking: 'Bokning', order: 'Beställning', catering: 'Catering' } as const
const CONSENT_LABEL = { granted: 'Ja', withdrawn: 'Nej, återkallat', none: 'Inget svar' } as const
type SearchKind = 'name' | 'email' | 'phone'

/** Gäster (planfunktionen "guestCrm"): vem kommer tillbaka och vad har de bokat och beställt. */
export default function GasterPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.guestCrm)
  const owner = tenant?.role === 'owner_user'

  return (
    <>
      <AdminTopbar title="Gäster" />
      <main className="admin-main">
        {enabled ? (
          <GuestList owner={owner} locations={tenant?.locations ?? []} />
        ) : (
          <section className="admin-card table-card">
            <h2 className="card-title">Ingår inte i er plan</h2>
            <p className="cell-muted">Gästregistret ingår inte i er plan. Kontakta oss för att uppgradera.</p>
          </section>
        )}
      </main>
    </>
  )
}

function GuestList({ owner, locations }: { owner: boolean; locations: { locationId: string; name: string | null }[] }) {
  const [guests, setGuests] = useState<GuestSummary[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [locationId, setLocationId] = useState('')
  const [kind, setKind] = useState<SearchKind>('name')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState(false)

  // Levande bara för första sidan av listan (inte sökträffar eller "Visa fler").
  const [paging, setPaging] = useState<'first' | 'more' | 'search'>('first')
  useLiveRefresh(async () => {
    const page = await listGuests({ cursor: null, locationId: locationId || null })
    setGuests(page.guests)
    setCursor(page.cursor)
  }, { enabled: paging === 'first' && guests !== null })

  const load = useCallback(async (next: string | null, append: boolean) => {
    setError(null)
    setPaging(append ? 'more' : 'first')
    try {
      const page = await listGuests({ cursor: next, locationId: locationId || null })
      setGuests((prev) => (append && prev ? [...prev, ...page.guests] : page.guests))
      setCursor(page.cursor)
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta gästerna.'))
    }
  }, [locationId])

  useEffect(() => {
    void load(null, false)
  }, [load])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const value = query.trim()
    if (!value) return void load(null, false)
    setSearching(true)
    setError(null)
    try {
      const body = kind === 'email' ? { email: value } : kind === 'phone' ? { phone: value } : { name: value }
      const found = await searchGuests(body)
      setPaging('search')
      setGuests(found.guests)
      setCursor(null)
    } catch (err) {
      setError(errorText(err, 'Sökningen gick inte.', {}, { name: 'namnet' }))
    } finally {
      setSearching(false)
    }
  }

  async function rebuild() {
    setRebuilding(true)
    try {
      await rebuildGuests(newId())
      toast('Gästregistret byggs nu från era bokningar och beställningar. Det kan ta några minuter.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Det gick inte att bygga gästregistret.', {
        rebuild_running: 'Gästregistret byggs redan. Vänta tills det är klart.',
      }), { tone: 'danger' })
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <>
      <Card
        title="Gäster"
        actions={owner ? (
          <Button variant="secondary" size="sm" busy={rebuilding} busyLabel="Startar…" onClick={rebuild}>
            Bygg gästregistret
          </Button>
        ) : undefined}
      >
        <form className="form-grid" onSubmit={search} role="search" aria-label="Sök gäst">
          <Field label="Sök på">
            <Select value={kind} onChange={(e) => setKind(e.target.value as SearchKind)}>
              <option value="name">Namn</option>
              <option value="email">E-post</option>
              <option value="phone">Telefon</option>
            </Select>
          </Field>
          <Field label={kind === 'email' ? 'E-postadress' : kind === 'phone' ? 'Telefonnummer' : 'Namn'}>
            <Input
              type={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'search'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </Field>
          {owner && locations.length > 1 ? (
            <Field label="Restaurang">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Alla</option>
                {locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.name ?? l.locationId}</option>)}
              </Select>
            </Field>
          ) : null}
          <div className="row-actions">
            <Button type="submit" busy={searching} busyLabel="Söker…">Sök</Button>
            {query ? (
              <Button type="button" variant="ghost" onClick={() => { setQuery(''); void load(null, false) }}>
                Rensa
              </Button>
            ) : null}
          </div>
        </form>
        {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
        {guests === null && !error ? <p className="cell-muted">Hämtar gäster…</p> : null}
        {guests && guests.length === 0 ? (
          <p className="admin-empty">
            Inga gäster än. Gäster läggs till när de har varit här, beställt eller fått sin catering.
          </p>
        ) : null}
        {guests && guests.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="bq-sr-only">Gäster, senast här först</caption>
              <thead>
                <tr><th scope="col">Namn</th><th scope="col">Senast här</th><th scope="col">Besök</th><th scope="col">Gäst</th></tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr key={g.guestId}>
                    <td>
                      <button type="button" className="link-action" onClick={() => setOpen(g.guestId)}>
                        {g.name || 'Namn saknas'}
                      </button>
                    </td>
                    <td>{formatDay(g.lastSeenAt)}</td>
                    <td>{g.visits}</td>
                    <td><span className="status-badge">{g.returning ? 'Återkommande' : 'Ny'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {cursor ? (
          <div className="row-actions">
            <Button variant="secondary" onClick={() => void load(cursor, true)}>Visa fler</Button>
          </div>
        ) : null}
      </Card>
      {open ? (
        <GuestDrawer
          guestId={open}
          owner={owner}
          locationName={(id) => locations.find((l) => l.locationId === id)?.name ?? ''}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}

function GuestDrawer({ guestId, owner, locationName, onClose }: {
  guestId: string
  owner: boolean
  locationName: (id: string) => string
  onClose: () => void
}) {
  const [guest, setGuest] = useState<GuestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Formuläret och värdena det utgår från (för att se vad du ändrat och vad som
  // ändrats på annat håll medan du skrev).
  const [form, setForm] = useState<GuestForm>(EMPTY_GUEST_FORM)
  const [base, setBase] = useState<GuestForm>(EMPTY_GUEST_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const formRef = useRef(form)
  const baseRef = useRef(base)
  useEffect(() => {
    formRef.current = form
    baseRef.current = base
  })
  const set = (patch: Partial<GuestForm>) => setForm((f) => ({ ...f, ...patch }))

  /** Ny version från servern: fält du inte rört följer med, dina står kvar. */
  const take = useCallback((g: GuestDetail) => {
    const server = guestForm(g)
    const f = formRef.current
    const b = baseRef.current
    const nextForm = { ...f }
    const nextBase = { ...b }
    for (const k of Object.keys(server) as (keyof GuestForm)[]) {
      if (f[k] === b[k]) {
        ;(nextForm as Record<string, unknown>)[k] = server[k]
        ;(nextBase as Record<string, unknown>)[k] = server[k]
      }
    }
    setGuest(g)
    setForm(nextForm)
    setBase(nextBase)
  }, [])

  useEffect(() => {
    let cancelled = false
    getGuest(guestId).then((g) => {
      if (cancelled) return
      const f = guestForm(g)
      setGuest(g)
      setForm(f)
      setBase(f)
    }).catch((err) => { if (!cancelled) setError(errorText(err, 'Kunde inte hämta gästen.')) })
    return () => { cancelled = true }
  }, [guestId])
  useLiveRefresh(() => getGuest(guestId).then(take), { enabled: guest !== null && !saving })

  const there = guest ? guestForm(guest) : null
  /** Det andra värdet för ett fält du ändrat, när det ändrats på annat håll också. */
  const clash = <K extends keyof GuestForm>(k: K): GuestForm[K] | undefined =>
    there && there[k] !== base[k] && there[k] !== form[k] ? there[k] : undefined

  const textNote = (k: 'note' | 'tags' | 'birthday') => {
    const v = clash(k)
    return v === undefined ? null : <ChangedNote as="span" value={v} onUse={() => set({ [k]: v })} />
  }

  async function save() {
    if (!guest) return
    setSaving(true)
    setSaveError(null)
    const send = (f: GuestForm, version: number) => updateGuest(guestId, {
      note: f.note.trim() || null,
      tags: splitTags(f.tags),
      birthday: f.birthday.trim() || null,
      segmentsExcluded: f.excluded,
      version,
    })
    try {
      let saved
      try {
        saved = await send(form, guest.version)
      } catch (err) {
        if (!isConflict(err)) throw err
        // Någon annan sparade gästen emellan: dina fält ovanpå det senaste, en gång till.
        const latest = await getGuest(guestId)
        const { merged, conflicts } = mergeEdits(base, form, guestForm(latest))
        if (conflicts.length) {
          // Fält du inte rört tar det senaste; dina står kvar, nästa sparning går mot den nya versionen.
          take(latest)
          throw new ConflictError(conflicts, latest)
        }
        saved = await send(merged, latest.version)
      }
      const next = { ...guest, ...saved }
      setGuest(next)
      setBase(guestForm(next))
      setForm(guestForm(next))
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      setSaveError(errorText(err, 'Kunde inte spara.', {
        invalid_birthday: 'Skriv födelsedagen som MM-DD, till exempel 03-14.',
        note_too_long: 'Anteckningen får vara högst 300 tecken.',
      }, { tags: 'taggarna' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="wide"
      title={guest ? guest.name || 'Gäst' : 'Gäst'}
      onClose={onClose}
      closeLabel="Stäng"
      footer={owner && guest ? (
        <Button busy={saving} busyLabel="Sparar…" onClick={save}>Spara</Button>
      ) : undefined}
    >
      {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
      {!guest && !error ? <p className="cell-muted">Hämtar…</p> : null}
      {guest ? (
        <>
          <dl className="gaster-facts">
            <dt>Först här</dt><dd>{formatDay(guest.firstSeenAt)}</dd>
            <dt>Senast här</dt><dd>{formatDay(guest.lastSeenAt)}</dd>
            <dt>Besök</dt><dd>{guest.visits}{guest.noShows ? ` (uteblev ${guest.noShows})` : ''}</dd>
            <dt>Beställningar</dt><dd>{guest.orders}</dd>
            <dt>Catering</dt><dd>{guest.cateringRequests}</dd>
            {guest.spendSek ? (
              <><dt>Handlat för</dt><dd>{(guest.spendSek.orders + guest.spendSek.catering + guest.spendSek.bookingFees).toLocaleString('sv-SE')} kr</dd></>
            ) : null}
            {guest.contact.email ? <><dt>E-post</dt><dd>{guest.contact.email}</dd></> : null}
            {guest.contact.phone ? <><dt>Telefon</dt><dd>{guest.contact.phone}</dd></> : null}
            <dt>Vill ha erbjudanden via e-post</dt><dd>{CONSENT_LABEL[guest.consent.email]}</dd>
            <dt>Vill ha erbjudanden via SMS</dt><dd>{CONSENT_LABEL[guest.consent.sms]}</dd>
          </dl>
          <h3 className="form-section-label">Historik</h3>
          {guest.history.length === 0 ? <p className="cell-muted">Ingen historik.</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th scope="col">Datum</th><th scope="col">Vad</th><th scope="col">Restaurang</th>{guest.spendSek ? <th scope="col">Belopp</th> : null}</tr>
                </thead>
                <tbody>
                  {guest.history.map((h) => (
                    <tr key={`${h.kind}-${h.sourceId}`}>
                      <td>{h.date ?? formatDay(h.at)}</td>
                      <td>{KIND_LABEL[h.kind]}{h.partySize ? `, ${h.partySize} pers.` : ''}{h.sourceId.endsWith('.noshow') ? ' (uteblev)' : ''}</td>
                      <td>{h.locationId ? locationName(h.locationId) : ''}</td>
                      {guest.spendSek ? <td>{h.amountOre ? `${Math.round(h.amountOre / 100).toLocaleString('sv-SE')} kr` : ''}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {owner ? (
            <div className="form-grid">
              <Field label="Anteckning" hint={textNote('note') ?? 'Skriv aldrig allergier eller hälsouppgifter här.'}>
                <textarea className="bq-input" maxLength={300} value={form.note} onChange={(e) => set({ note: e.target.value })} />
              </Field>
              <Field label="Taggar" hint={textNote('tags') ?? 'Skilj med komma, högst 10.'}>
                <Input value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
              </Field>
              <Field label="Födelsedag" hint={textNote('birthday') ?? 'MM-DD. Bara om gästen själv vill.'}>
                <Input value={form.birthday} placeholder="03-14" inputMode="numeric" onChange={(e) => set({ birthday: e.target.value })} />
              </Field>
              <label className="toggle-row">
                <input type="checkbox" className="switch" checked={form.excluded} onChange={(e) => set({ excluded: e.target.checked })} />
                <span className="toggle-row-label">Gästen vill inte ingå i utskick</span>
              </label>
              {clash('excluded') !== undefined && (
                <ChangedNote value={clash('excluded') ? 'ingår inte i utskick' : 'ingår i utskick'} onUse={() => set({ excluded: Boolean(clash('excluded')) })} />
              )}
              {saveError ? <Bar variant="banner" tone="danger" action={<ErrorActions text={saveError} />}>{saveError}</Bar> : null}
            </div>
          ) : (
            guest.note ? <p><strong>Anteckning:</strong> {guest.note}</p> : null
          )}
        </>
      ) : null}
    </Modal>
  )
}

interface GuestForm {
  note: string
  tags: string
  birthday: string
  excluded: boolean
}

const EMPTY_GUEST_FORM: GuestForm = { note: '', tags: '', birthday: '', excluded: false }

function guestForm(g: GuestDetail): GuestForm {
  return { note: g.note ?? '', tags: g.tags.join(', '), birthday: g.birthday ?? '', excluded: g.segmentsExcluded }
}

function splitTags(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter(Boolean)
}
