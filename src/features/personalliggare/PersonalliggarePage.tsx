import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Modal, Select, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import { listUsers, type User } from '../installningar/usersApi'
import {
  ERRORS,
  KIND_LABEL,
  checkIn,
  checkOut,
  clock,
  correct,
  exportLedger,
  getDay,
  getInspection,
  listPersons,
  newId,
  savePerson,
  stockholmIso,
  today,
  type Day,
  type Inspection,
  type Kind,
  type Person,
  type Row,
} from './api'
import './personalliggare.css'
import { ErrorActions } from '../../shared/ErrorNote'

type Tab = 'idag' | 'personer' | 'rattelser' | 'exportera'

/**
 * Personalliggare (planfunktionen "personalliggare"), under juridisk granskning:
 * in- och utcheckning, vilka som är på plats, visning vid kontrollbesök och,
 * för ägaren, personer, rättelser och export. Inget ändras i efterhand: varje
 * registrering och rättelse är en ny rad.
 */
export default function PersonalliggarePage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.personalliggare)

  return (
    <>
      <AdminTopbar title="Personalliggare (under granskning)" />
      <main className="admin-main">
        {enabled ? <Ledger /> : (
          <section className="admin-card table-card">
            <h2 className="card-title">Ingår inte i er plan</h2>
            <p className="cell-muted">Kontakta oss för att uppgradera.</p>
          </section>
        )}
      </main>
    </>
  )
}

function Ledger() {
  const state = useTenant()
  const owner = state.tenant?.role === 'owner_user'
  const location = currentLocation(state)
  const [tab, setTab] = useState<Tab>('idag')
  const [persons, setPersons] = useState<Person[]>([])

  const loadPersons = useCallback(async () => {
    if (!owner) return
    try {
      setPersons(await listPersons())
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta personerna.', ERRORS), { tone: 'danger' })
    }
  }, [owner])

  useEffect(() => { void loadPersons() }, [loadPersons])
  useLiveRefresh(async () => {
    if (owner) setPersons(await listPersons())
  }, { enabled: owner })

  if (!location) return <p className="cell-muted">Hämtar…</p>
  const items = [
    { key: 'idag', label: 'Idag' },
    ...(owner ? [{ key: 'personer', label: 'Personer' }, { key: 'rattelser', label: 'Rättelser' }, { key: 'exportera', label: 'Exportera' }] : []),
  ]
  return (
    <>
      <Bar variant="banner" tone="warning">
        Under juridisk granskning. Fungerar inte appen? För liggaren på papper.
      </Bar>
      {owner ? (
        <div className="pl-section">
          <Bar variant="tab" kind="track" label="Personalliggare" items={items} value={tab} onChange={(k) => setTab(k as Tab)}
            panelId={(k) => `pl-panel-${k}`} />
        </div>
      ) : null}
      <div id={`pl-panel-${tab}`} role={owner ? 'tabpanel' : undefined}>
        {tab === 'idag' ? <Today locationId={location.locationId} owner={owner} persons={persons} /> : null}
        {tab === 'personer' ? <Persons persons={persons} onSaved={loadPersons} /> : null}
        {tab === 'rattelser' ? <Corrections locationId={location.locationId} persons={persons} /> : null}
        {tab === 'exportera' ? <Export locationId={location.locationId} /> : null}
      </div>
    </>
  )
}

// --- Idag -------------------------------------------------------------------------------------

function Today({ locationId, owner, persons }: { locationId: string; owner: boolean; persons: Person[] }) {
  const [day, setDay] = useState(today)
  const [data, setData] = useState<Day | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [forPerson, setForPerson] = useState('')
  const [inspecting, setInspecting] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await getDay(locationId, day))
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta liggaren.', ERRORS), { tone: 'danger' })
    }
  }, [locationId, day])

  useEffect(() => { void load() }, [load])
  // Levande: in- och utcheckningar från en annan enhet syns av sig själva.
  useLiveRefresh(async () => setData(await getDay(locationId, day)), { enabled: busy === null })

  async function register(kind: Kind, personId?: string) {
    setBusy(`${kind}:${personId ?? 'me'}`)
    try {
      const row = await (kind === 'check_in' ? checkIn : checkOut)(locationId, personId)
      toast(`${row.name || 'Personen'} är ${kind === 'check_in' ? 'incheckad' : 'utcheckad'} ${clock(row.eventTime)}.`, { tone: 'success' })
      await load()
    } catch (err) {
      toast(errorText(err, 'Det gick inte att registrera.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const me = data?.me
  const here = (personId: string) => Boolean(data?.present.some((p) => p.personId === personId))
  const others = persons.filter((p) => p.active && (p.locationIds.length === 0 || p.locationIds.includes(locationId)))
  const chosen = others.find((p) => p.personId === forPerson)

  return (
    <>
      <Card title="Checka in eller ut">
        {me ? (
          <div className="pl-me">
            <p className="pl-me__status">
              {me.name}: {me.present ? 'du är incheckad.' : 'du är inte incheckad.'}
            </p>
            {me.present ? (
              <Button size="md" variant="secondary" wide busy={busy === 'check_out:me'} busyLabel="Checkar ut…"
                onClick={() => void register('check_out')}>Checka ut</Button>
            ) : (
              <Button size="md" wide busy={busy === 'check_in:me'} busyLabel="Checkar in…" disabled={!me.worksHere}
                onClick={() => void register('check_in')}>Checka in</Button>
            )}
            {!me.worksHere ? <p className="cell-muted">Du är inte kopplad till den här platsen.</p> : null}
          </div>
        ) : data ? (
          <p className="cell-muted">
            {owner ? 'Din inloggning är inte kopplad till någon i liggaren. Lägg till dig själv under Personer.'
              : 'Din inloggning är inte kopplad till någon i liggaren. Be ägaren lägga till dig.'}
          </p>
        ) : null}
        {owner && others.length ? (
          <div className="pl-for">
            <Field label="Registrera för någon annan">
              <Select value={forPerson} onChange={(e) => setForPerson(e.target.value)}>
                <option value="">Välj person</option>
                {others.map((p) => <option key={p.personId} value={p.personId}>{p.name}</option>)}
              </Select>
            </Field>
            {chosen ? (
              here(chosen.personId) ? (
                <Button variant="secondary" busy={busy === `check_out:${chosen.personId}`} busyLabel="Checkar ut…"
                  onClick={() => void register('check_out', chosen.personId)}>Checka ut {chosen.name}</Button>
              ) : (
                <Button busy={busy === `check_in:${chosen.personId}`} busyLabel="Checkar in…"
                  onClick={() => void register('check_in', chosen.personId)}>Checka in {chosen.name}</Button>
              )
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="På plats nu" actions={<Button variant="secondary" onClick={() => setInspecting(true)}>Visa för Skatteverket</Button>}>
        {!data ? <p className="cell-muted">Hämtar…</p> : data.present.length === 0 ? <p className="admin-empty">Ingen incheckad.</p> : (
          <ul className="pl-present">
            {data.present.map((p) => <li key={p.personId}><span>{p.name}</span><span className="cell-muted">sedan {clock(p.since)}</span></li>)}
          </ul>
        )}
      </Card>

      <Card title="Liggaren">
        <Field label="Dag">
          <Input type="date" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>
        {data ? <Rows rows={data.records} /> : null}
      </Card>

      {inspecting ? <InspectionView locationId={locationId} day={day} onClose={() => setInspecting(false)} /> : null}
    </>
  )
}

function Rows({ rows, identity = false }: { rows: Row[]; identity?: boolean }) {
  if (rows.length === 0) return <p className="admin-empty">Inga registreringar.</p>
  return (
    <div className="table-scroll">
      <table className="data-table pl-table">
        <thead>
          <tr>
            <th scope="col">Tid</th><th scope="col">Namn</th>{identity ? <th scope="col">Personnummer</th> : null}
            <th scope="col">In/ut</th><th scope="col">Anmärkning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.seq}-${r.correctedBySeq ?? 0}`}>
              <td>{clock(r.eventTime)}</td>
              <td>{r.name}</td>
              {identity ? <td className="pl-mono">{r.personalIdentity}</td> : null}
              <td>{KIND_LABEL[r.kind as Kind] ?? r.kind}</td>
              <td>
                {r.original ? `Rättad (var ${KIND_LABEL[r.original.kind as Kind] ?? r.original.kind} ${clock(r.original.eventTime)}): ${r.reason}` : null}
                {r.late ? `Efterregistrerad: ${r.reason}` : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InspectionView({ locationId, day, onClose }: { locationId: string; day: string; onClose: () => void }) {
  const [view, setView] = useState<Inspection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getInspection(locationId, day).then(setView).catch((err) => setError(errorText(err, 'Kunde inte visa liggaren.', ERRORS)))
  }, [locationId, day])

  return (
    <Modal open size="wide" title="Personalliggare" onClose={onClose} closeLabel="Stäng">
      {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : !view ? <p className="cell-muted">Hämtar…</p> : (
        <div className="pl-inspection">
          <dl className="pl-facts">
            <dt>Arbetsgivare</dt><dd>{view.employer.legalName} ({view.employer.orgNumber || 'organisationsnummer saknas'})</dd>
            <dt>Arbetsplats</dt><dd>{[view.premises.name, view.premises.address].filter(Boolean).join(', ')}</dd>
            <dt>Dag</dt><dd>{view.day}</dd>
            <dt>Visad</dt><dd>{new Date(view.generatedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</dd>
          </dl>
          <h3 className="pl-sub">På plats nu</h3>
          {view.present.length === 0 ? <p>Ingen incheckad.</p> : (
            <ul className="pl-present">
              {view.present.map((p) => (
                <li key={p.personId}><span>{p.name}</span><span className="pl-mono">{p.personalIdentity}</span><span>sedan {clock(p.since)}</span></li>
              ))}
            </ul>
          )}
          <h3 className="pl-sub">Hela dagen</h3>
          <Rows rows={view.records} identity />
        </div>
      )}
    </Modal>
  )
}

// --- Personer (ägaren) ----------------------------------------------------------------------------

function Persons({ persons, onSaved }: { persons: Person[]; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState<Person | null>(null)
  const blank: Person = { personId: '', name: '', personalIdentity: '', userSub: null, locationIds: [], active: true, version: 0 }
  return (
    <Card title="Personer" actions={<Button onClick={() => setEditing(blank)}>Lägg till person</Button>}>
      {persons.length === 0 ? <p className="admin-empty">Inga personer än.</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Namn</th><th scope="col">Personnummer</th><th scope="col">Inloggning</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {persons.map((p) => (
                <tr key={p.personId}>
                  <td><button type="button" className="card-link pl-open" onClick={() => setEditing(p)}>{p.name}</button></td>
                  <td className="pl-mono">{p.personalIdentity}</td>
                  <td>{p.userSub ? 'Kopplad' : 'Ingen'}</td>
                  <td><span className="status-badge">{p.active ? 'Aktiv' : 'Slutat'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <PersonForm person={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onSaved() }} /> : null}
    </Card>
  )
}

function PersonForm({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => Promise<void> }) {
  const { tenant } = useTenant()
  const locations = tenant?.locations ?? []
  const [draft, setDraft] = useState(person)
  const [users, setUsers] = useState<User[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { listUsers().then(setUsers).catch(() => setUsers([])) }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await savePerson(draft.personId || newId(), {
        name: draft.name.trim(), personalIdentity: (draft.personalIdentity ?? '').trim(), userSub: draft.userSub,
        locationIds: draft.locationIds, active: draft.active, version: draft.version,
      })
      toast('Sparat.', { tone: 'success' })
      await onSaved()
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.', ERRORS))
    } finally {
      setSaving(false)
    }
  }

  function toggleLocation(id: string) {
    const list = draft.locationIds.includes(id) ? draft.locationIds.filter((x) => x !== id) : [...draft.locationIds, id]
    setDraft({ ...draft, locationIds: list })
  }

  return (
    <Modal open title={person.personId ? person.name : 'Ny person'} onClose={onClose} closeLabel="Stäng">
      <form className="form-grid" onSubmit={save} aria-label="Person">
        {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
        <Field label="Namn" required>
          <Input value={draft.name} maxLength={80} autoComplete="off" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Personnummer eller samordningsnummer" hint="ÅÅÅÅMMDD-XXXX" required>
          <Input value={draft.personalIdentity ?? ''} inputMode="numeric" autoComplete="off" maxLength={13}
            onChange={(e) => setDraft({ ...draft, personalIdentity: e.target.value })} />
        </Field>
        <Field label="Inloggning" hint="Med en inloggning kan personen checka in själv.">
          <Select value={draft.userSub ?? ''} onChange={(e) => setDraft({ ...draft, userSub: e.target.value || null })}>
            <option value="">Ingen inloggning</option>
            {users.map((u) => <option key={u.cognitoSub} value={u.cognitoSub}>{u.name || u.email}</option>)}
          </Select>
        </Field>
        {locations.length > 1 ? (
          <fieldset className="pl-locations">
            <legend>Arbetar på (inget val = alla platser)</legend>
            {locations.map((l) => (
              <label key={l.locationId} className="pl-check">
                <input type="checkbox" checked={draft.locationIds.includes(l.locationId)} onChange={() => toggleLocation(l.locationId)} />
                {l.name ?? l.locationId}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="pl-check">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          Arbetar här nu
        </label>
        <Bar variant="action" label="Spara person">
          <Button variant="ghost" type="button" onClick={onClose}>Avbryt</Button>
          <Button type="submit" busy={saving} busyLabel="Sparar…" disabled={!draft.name.trim() || !(draft.personalIdentity ?? '').trim()}>Spara</Button>
        </Bar>
      </form>
    </Modal>
  )
}

// --- Rättelser (ägaren) -----------------------------------------------------------------------------

function Corrections({ locationId, persons }: { locationId: string; persons: Person[] }) {
  const [day, setDay] = useState(today)
  const [data, setData] = useState<Day | null>(null)
  const [target, setTarget] = useState<Row | null>(null)
  const [personId, setPersonId] = useState('')
  const [kind, setKind] = useState<Kind>('check_in')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await getDay(locationId, day))
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta liggaren.', ERRORS), { tone: 'danger' })
    }
  }, [locationId, day])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => setData(await getDay(locationId, day)), { enabled: !saving })

  function pick(row: Row | null) {
    setTarget(row)
    setPersonId(row?.personId ?? '')
    setKind((row?.kind as Kind) ?? 'check_in')
    setTime(row ? clock(row.eventTime) : '')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await correct(locationId, { personId, kind, eventTime: stockholmIso(day, time), reason: reason.trim(),
        ...(target ? { correctsSeq: target.seq } : {}) })
      toast('Rättelsen är sparad. Den ursprungliga registreringen finns kvar bredvid.', { tone: 'success' })
      pick(null)
      setReason('')
      await load()
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara rättelsen.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card title="Rätta eller efterregistrera">
        <p className="cell-muted">Välj en rad nedan, eller fyll i för att efterregistrera.</p>
        <form className="form-grid" onSubmit={save} aria-label="Rättelse">
          <Field label="Dag" required>
            <Input type="date" value={day} max={today()} onChange={(e) => { if (e.target.value) { setDay(e.target.value); pick(null) } }} />
          </Field>
          <Field label="Person" required>
            <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Välj person</option>
              {persons.map((p) => <option key={p.personId} value={p.personId}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="In eller ut" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="check_in">Incheckning</option>
              <option value="check_out">Utcheckning</option>
            </Select>
          </Field>
          <Field label="Rätt tid" required>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Orsak" hint="5-300 tecken. Sparas i liggaren." required>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Bar variant="action" label="Spara rättelse"
            status={target ? `Rättar ${KIND_LABEL[target.kind as Kind] ?? target.kind} ${clock(target.eventTime)} för ${target.name}` : 'Efterregistrering'}>
            {target ? <Button variant="ghost" type="button" onClick={() => pick(null)}>Ingen rad</Button> : null}
            <Button type="submit" busy={saving} busyLabel="Sparar…" disabled={!personId || !time || reason.trim().length < 5}>Spara rättelse</Button>
          </Bar>
        </form>
      </Card>
      <Card title="Registreringar den dagen">
        {!data ? <p className="cell-muted">Hämtar…</p> : data.records.length === 0 ? <p className="admin-empty">Inga registreringar.</p> : (
          <ul className="pl-present">
            {data.records.map((r) => (
              <li key={`${r.seq}-${r.correctedBySeq ?? 0}`}>
                <span>{clock(r.eventTime)} {KIND_LABEL[r.kind as Kind] ?? r.kind} {r.name}{r.original || r.late ? ' (rättad)' : ''}</span>
                {r.late ? null : <Button size="sm" variant="secondary" onClick={() => pick(r)}>Rätta</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

// --- Exportera (ägaren) -----------------------------------------------------------------------------

function Export({ locationId }: { locationId: string }) {
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ count: number; chainOk: boolean; firstBadSeq?: number } | null>(null)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const file = await exportLedger(locationId, from, to)
      const url = URL.createObjectURL(new Blob([file.content ?? ''], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      a.click()
      URL.revokeObjectURL(url)
      setResult(file)
    } catch (err) {
      toast(errorText(err, 'Kunde inte exportera.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Exportera">
      <p className="cell-muted">Innehåller personnummer: spara filen säkert.</p>
      <form className="form-grid" onSubmit={run} aria-label="Exportera liggaren">
        <Field label="Från" required><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Till" required><Input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
        <Bar variant="action" label="Exportera">
          <Button type="submit" busy={busy} busyLabel="Exporterar…" disabled={!from || !to}>Ladda ner CSV</Button>
        </Bar>
      </form>
      {result ? (
        result.chainOk
          ? <Bar variant="banner" tone="success">{result.count} rader. Kontrollen visar att inget i liggaren har ändrats.</Bar>
          : <Bar variant="banner" tone="danger">{result.count} rader. Kontrollen hittade ett fel vid rad {result.firstBadSeq}. Kontakta Booqy innan du lämnar ut filen.</Bar>
      ) : null}
    </Card>
  )
}
