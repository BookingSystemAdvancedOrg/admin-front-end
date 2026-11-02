import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { DateInput } from '../../shared/DateInput'
import { Icon } from '../../shared/Icon'
import { parseKronor } from '../tabetalt/cardApi'
import {
  PROBLEMS,
  copyReceipt,
  downloadExport,
  errorText,
  getReceipt,
  kr,
  listJournal,
  returnReceipt,
} from './kassaApi'
import type { Delivery, Discount, Done, JournalItem, KassaDocument, ReceiptInfo } from './kassaApi'
import { SkelRows } from '../../shared/Skeleton'

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal kassa-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="kassa-modal-head">
          <h2>{title}</h2>
          <button type="button" className="kassa-icon-btn" aria-label="Stäng" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Kvittot eller rapporten som den skrivs ut. */
export function DocumentView({ document }: { document: KassaDocument }) {
  return (
    <div className="kassa-paper" aria-label={document.title}>
      {document.rows.map((row, i) => {
        if (row.rule) return <hr key={i} />
        const cls = `${row.bold ? 'b' : ''} ${row.big ? 'big' : ''} ${row.center ? 'c' : ''} ${row.code ? 'code' : ''}`.replace(/\s+/g, ' ').trim()
        if (row.pair) {
          return (
            <div key={i} className={`pair ${cls}`}>
              <span>{row.pair[0]}</span>
              <span>{row.pair[1]}</span>
            </div>
          )
        }
        return <p key={i} className={cls}>{row.text}</p>
      })}
    </div>
  )
}

export function DoneDialog({ done, title, onClose }: { done: Done; title: string; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      {done.problems.map((p) => (
        <p key={p} className="kassa-alert warn" role="alert">{PROBLEMS[p] ?? p}</p>
      ))}
      <DocumentView document={done.document} />
      <div className="modal-actions">
        <button type="button" className="btn primary kassa-big" onClick={onClose}>Klar</button>
      </div>
    </Dialog>
  )
}

/** Kvitto i pappersform eller mejl; skärm bara i testläge. */
export function DeliveryPicker({
  testMode, printer, busy, onPick, label,
}: { testMode: boolean; printer: boolean; busy: boolean; onPick: (d: Delivery, email?: string) => void; label: string }) {
  const [email, setEmail] = useState('')
  const [mailing, setMailing] = useState(false)
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())
  if (mailing) {
    return (
      <form className="kassa-delivery" onSubmit={(e) => { e.preventDefault(); if (valid) onPick('email', email.trim()) }}>
        <div className="form-field">
          <label htmlFor="kassa-email">Gästens e-post</label>
          <input id="kassa-email" type="email" inputMode="email" autoComplete="off" value={email} autoFocus
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="kassa-row">
          <button type="button" className="btn outline kassa-big" onClick={() => setMailing(false)}>Tillbaka</button>
          <button type="submit" className="btn primary kassa-big" disabled={!valid || busy}>Skicka {label.toLowerCase()}</button>
        </div>
      </form>
    )
  }
  return (
    <div className="kassa-delivery">
      <button type="button" className="btn primary kassa-big" disabled={busy || !printer} onClick={() => onPick('print')}>
        <Icon name="printer" size={22} /> Skriv ut {label.toLowerCase()}
      </button>
      {!printer && <p className="cell-muted">Ingen skrivare kopplad. Koppla en under Inställningar, eller mejla.</p>}
      <button type="button" className="btn outline kassa-big" disabled={busy} onClick={() => setMailing(true)}>
        <Icon name="mail" size={22} /> Mejla {label.toLowerCase()}
      </button>
      {testMode && (
        <button type="button" className="btn outline kassa-big" disabled={busy} onClick={() => onPick('screen')}>
          <Icon name="receipt" size={22} /> Visa på skärmen (testläge)
        </button>
      )}
    </div>
  )
}

/** Dagens kvitton och rapporter; kopia (en gång) och retur. */
export function ReceiptsDialog({
  locationId, registerId, testMode, printer, onClose, onChanged,
}: { locationId: string; registerId: string; testMode: boolean; printer: boolean; onClose: () => void; onChanged: () => void }) {
  const [date, setDate] = useState('')
  const [items, setItems] = useState<JournalItem[] | null>(null)
  const [open, setOpen] = useState<{ seq: number; info: ReceiptInfo } | null>(null)
  const [mode, setMode] = useState<'view' | 'copy' | 'return'>('view')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  useEffect(() => {
    let live = true
    setItems(null)
    listJournal(locationId, registerId, date || undefined)
      .then((r) => { if (live) { setItems(r.entries); if (!date) setDate(r.date) } })
      .catch((err) => { if (live) { setItems([]); setError(errorText(err)) } })
    return () => { live = false }
  }, [locationId, registerId, date])

  async function show(seq: number) {
    setError(null)
    try {
      setOpen({ seq, info: await getReceipt(locationId, registerId, seq) })
      setMode('view')
      setQty({})
      setReason('')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function act(delivery: Delivery, email?: string) {
    if (!open) return
    setBusy(true)
    setError(null)
    try {
      const result = mode === 'copy'
        ? await copyReceipt(locationId, registerId, open.seq, delivery, email)
        : await returnReceipt(locationId, registerId, open.seq, {
          lines: Object.entries(qty).filter(([, q]) => q > 0).map(([lineId, quantity]) => ({ lineId, quantity })),
          reason: reason.trim(), delivery, email,
        })
      setDone(result)
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) return <DoneDialog done={done} title={done.document.title} onClose={onClose} />

  const returnable = open?.info.lines.map((l) => ({ ...l, left: l.quantity - (open.info.returned[l.lineId]?.quantity ?? 0) })) ?? []
  const chosen = Object.values(qty).some((q) => q > 0)

  return (
    <Dialog title={open ? `Kvitto nr ${open.seq}` : 'Kvitton'} onClose={onClose} wide>
      {error && <p className="kassa-alert danger" role="alert">{error}</p>}
      {!open ? (
        <>
          <div className="form-field kassa-date">
            <label htmlFor="kassa-day">Dag</label>
            <DateInput id="kassa-day" value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value) }} />
          </div>
          {items === null ? <SkelRows n={4} cols={3} /> : items.length === 0 ? (
            <p className="cell-muted">Inga kvitton eller rapporter den dagen.</p>
          ) : (
            <ul className="kassa-journal">
              {items.map((it) => (
                <li key={it.jseq}>
                  {it.kind === 'kassakvitto' ? (
                    <button type="button" onClick={() => it.seq && void show(it.seq)}>
                      <span>{it.title} nr {it.seq}</span>
                      <span className="cell-muted">{it.at.slice(11, 16)}</span>
                      <strong>{kr(it.total ?? 0)}</strong>
                    </button>
                  ) : (
                    <div>
                      <span>{it.title}{it.seq ? ` nr ${it.seq}` : ''}</span>
                      <span className="cell-muted">{it.at.slice(11, 16)}</span>
                      <strong>{it.total != null ? kr(it.total) : ''}</strong>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : mode === 'view' ? (
        <>
          <DocumentView document={open.info.document} />
          <div className="kassa-row">
            <button type="button" className="btn outline kassa-big" onClick={() => setOpen(null)}>Alla kvitton</button>
            <button type="button" className="btn outline kassa-big" disabled={open.info.copyTaken}
              title={open.info.copyTaken ? 'Kopian är redan utskriven' : undefined} onClick={() => setMode('copy')}>
              {open.info.copyTaken ? 'Kopia tagen' : 'Kopia'}
            </button>
            <button type="button" className="btn outline kassa-big" disabled={!returnable.some((l) => l.left > 0)}
              onClick={() => setMode('return')}>Retur</button>
          </div>
        </>
      ) : mode === 'copy' ? (
        <>
          <p className="modal-text">Varje kvitto får bara ha en kopia. Den märks KOPIA.</p>
          <DeliveryPicker testMode={testMode} printer={printer} busy={busy} label="Kopia" onPick={(d, e) => void act(d, e)} />
          <button type="button" className="btn outline" onClick={() => setMode('view')}>Tillbaka</button>
        </>
      ) : (
        <>
          <p className="modal-text">Välj vad som lämnas tillbaka. Beloppet går tillbaka till kortet, och ett returkvitto skapas.</p>
          <ul className="kassa-return">
            {returnable.map((l) => (
              <li key={l.lineId}>
                <span>{l.name}<small className="cell-muted"> {l.left} av {l.quantity} kvar</small></span>
                <div className="kassa-stepper">
                  <button type="button" aria-label={`En färre ${l.name}`} disabled={!qty[l.lineId]}
                    onClick={() => setQty({ ...qty, [l.lineId]: (qty[l.lineId] ?? 0) - 1 })}><Icon name="minus" size={20} /></button>
                  <output>{qty[l.lineId] ?? 0}</output>
                  <button type="button" aria-label={`En till ${l.name}`} disabled={(qty[l.lineId] ?? 0) >= l.left}
                    onClick={() => setQty({ ...qty, [l.lineId]: (qty[l.lineId] ?? 0) + 1 })}><Icon name="plus" size={20} /></button>
                </div>
              </li>
            ))}
          </ul>
          <div className="form-field">
            <label htmlFor="kassa-reason">Orsak</label>
            <input id="kassa-reason" maxLength={72} placeholder="T.ex. fel rätt" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {chosen && reason.trim() ? (
            <DeliveryPicker testMode={testMode} printer={printer} busy={busy} label="Returkvitto" onPick={(d, e) => void act(d, e)} />
          ) : (
            <p className="cell-muted">Välj minst en rad och skriv en orsak.</p>
          )}
          <button type="button" className="btn outline" onClick={() => setMode('view')}>Tillbaka</button>
        </>
      )}
    </Dialog>
  )
}

export function ExportDialog({ locationId, registerId, onClose }: { locationId: string; registerId: string; onClose: () => void }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())   // YYYY-MM-DD
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const file = await downloadExport(locationId, registerId, from, to)
      const url = URL.createObjectURL(file.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Exportera journal (XML)" onClose={onClose}>
      <form className="kassa-form" onSubmit={(e) => void submit(e)}>
        <p className="modal-text">Journalminnet i Skatteverkets format (SKVFS 2021:16), till exempel när Skatteverket begär det. Högst ett år åt gången.</p>
        {error && <p className="kassa-alert danger" role="alert">{error}</p>}
        <div className="kassa-row">
          <div className="form-field"><label htmlFor="exp-from">Från</label>
            <DateInput id="exp-from" value={from} max={to} onChange={(e) => { if (e.target.value) setFrom(e.target.value) }} /></div>
          <div className="form-field"><label htmlFor="exp-to">Till</label>
            <DateInput id="exp-to" value={to} min={from} onChange={(e) => { if (e.target.value) setTo(e.target.value) }} /></div>
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn primary kassa-big" disabled={busy || !from || !to}>Ladda ner</button>
        </div>
      </form>
    </Dialog>
  )
}

export function AmountDialog({
  title, text, label, initial, submit, onSubmit, onClose, allowZero,
}: {
  title: string; text: string; label: string; initial: string; submit: string
  onSubmit: (ore: number) => void; onClose: () => void; allowZero?: boolean
}) {
  const [value, setValue] = useState(initial)
  const ore = parseKronor(value)
  const ok = ore !== null && (allowZero || ore > 0)
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="kassa-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(ore) }}>
        <p className="modal-text">{text}</p>
        <div className="form-field">
          <label htmlFor="kassa-amount">{label}</label>
          <div className="pay-amount">
            <input id="kassa-amount" inputMode="decimal" autoComplete="off" value={value} autoFocus
              onChange={(e) => setValue(e.target.value)} />
            <span aria-hidden="true">kr</span>
          </div>
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn primary kassa-big" disabled={!ok}>{submit}</button>
        </div>
      </form>
    </Dialog>
  )
}

export function DiscountDialog({
  current, onSave, onClose,
}: { current: Discount | null; onSave: (d: Discount | null) => void; onClose: () => void }) {
  const [kind, setKind] = useState<Discount['kind']>(current?.kind ?? 'percent')
  const [value, setValue] = useState(current ? (current.kind === 'percent' ? String(current.value) : kr(current.value)) : '')
  const [label, setLabel] = useState(current?.label ?? '')
  const parsed = kind === 'percent' ? (/^\d{1,3}$/.test(value) ? Number(value) : null) : parseKronor(value)
  const ok = parsed !== null && parsed > 0 && (kind === 'amount' || parsed <= 100)
  return (
    <Dialog title="Rabatt på notan" onClose={onClose}>
      <form className="kassa-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ kind, value: parsed, label: label.trim() || 'Rabatt' }) }}>
        <div className="pay-mode" role="radiogroup" aria-label="Typ av rabatt">
          {(['percent', 'amount'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''}
              onClick={() => { setKind(k); setValue('') }}>{k === 'percent' ? 'Procent' : 'Belopp'}</button>
          ))}
        </div>
        <div className="kassa-chips" aria-label="Snabbval">
          {kind === 'percent' && [10, 15, 20, 50].map((p) => (
            <button key={p} type="button" className={`kassa-chip${value === String(p) ? ' on' : ''}`} onClick={() => setValue(String(p))}>{p} %</button>
          ))}
        </div>
        <div className="form-field">
          <label htmlFor="kassa-disc">{kind === 'percent' ? 'Procent' : 'Belopp i kronor'}</label>
          <input id="kassa-disc" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="kassa-disc-label">Benämning</label>
          <input id="kassa-disc-label" maxLength={40} placeholder="T.ex. Personal" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="modal-actions">
          {current && <button type="button" className="btn outline" onClick={() => onSave(null)}>Ta bort rabatten</button>}
          <button type="submit" className="btn primary kassa-big" disabled={!ok}>Lägg på rabatt</button>
        </div>
      </form>
    </Dialog>
  )
}

export function TextDialog({
  title, label, initial, max, submit, onSubmit, onClose, quick,
}: {
  title: string; label: string; initial: string; max: number; submit: string
  onSubmit: (text: string) => void; onClose: () => void; quick?: string[]
}) {
  const [value, setValue] = useState(initial)
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="kassa-form" onSubmit={(e) => { e.preventDefault(); onSubmit(value.trim()) }}>
        {quick && (
          <div className="kassa-chips">
            {quick.map((q) => (
              <button key={q} type="button" className="kassa-chip" onClick={() => onSubmit(q)}>{q}</button>
            ))}
          </div>
        )}
        <div className="form-field">
          <label htmlFor="kassa-text">{label}</label>
          <input id="kassa-text" maxLength={max} autoComplete="off" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn primary kassa-big">{submit}</button>
        </div>
      </form>
    </Dialog>
  )
}
