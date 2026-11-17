import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  addPrinter,
  getPrinting,
  MAX_PRINTERS,
  printErrorText,
  removePrinter,
  rotatePrinter,
  saveCategoryRouting,
  setPrinterSetupSkipped,
  testPrint,
  updatePrinter,
} from '../bestallningar/printApi'
import type { PrintOverview, Printer, PrinterCredentials, PrinterKind, PrinterProtocol } from '../bestallningar/printApi'
import type { MenuCategoryEntry } from '../meny/data'
import { clock } from '../bestallningar/ordersApi'
import { Icon } from '../../shared/Icon'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { ErrorNote } from '../../shared/ErrorNote'
import { useConfirm } from '../../shared/ConfirmDialog'
import { Num } from '../../shared/motion/Num'
import { KIND_ICON, KIND_LABEL, KINDS, categoryStation, kindOf, soundsLikeDrinks, suggestName } from './kinds'
import { SimPaperDialog } from './SimPaper'
import './printers.css'

/**
 * Skrivarna som stora kort: sortens ikon, "Kök · Kök 1", läget och vad den
 * får (kategorierna, live). Ett tryck byter sort. "Lägg till skrivare":
 * välj Kök, Dryck eller Annat, ge ett namn, klart. En riktig skrivare får
 * sina uppgifter att skriva in; en simulerad (bara i dev) skriver ut på
 * skärmen direkt.
 */

function status(printer: Printer): { text: string; tone: 'ok' | 'wait' | 'bad' | 'sim' } {
  if (printer.simulated) return { text: 'Simulerad', tone: 'sim' }
  if (!printer.lastSeenAt) return { text: 'Väntar', tone: 'wait' }
  if (printer.online) return { text: 'Ansluten', tone: 'ok' }
  return { text: `Svarar inte (${clock(printer.lastSeenAt)})`, tone: 'bad' }
}

function CopyField({ id, label, value, secret }: { id: string; label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="printer-copy">
        <input id={id} readOnly value={value} className={secret ? 'printer-secret' : undefined}
          onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn outline square" onClick={() => void copy()}>
          {copied ? 'Kopierat' : 'Kopiera'}
        </button>
      </div>
    </div>
  )
}

type AddStep = { kind: PrinterKind | null; name: string; protocol: PrinterProtocol }

export function PrinterTiles({
  locationId,
  isOwner,
  data,
  categories,
  onChange,
  onReload,
  onEditing,
}: {
  locationId: string
  isOwner: boolean
  data: PrintOverview
  categories: MenuCategoryEntry[]
  onChange: (next: PrintOverview) => void
  onReload: () => Promise<void>
  /** Medan något skrivs i: pausa den levande uppdateringen. */
  onEditing?: (on: boolean) => void
}) {
  const devices = data.devices
  const simAllowed = data.simulatorAllowed === true
  const [adding, setAdding] = useState<AddStep | null>(null)
  const [credentials, setCredentials] = useState<PrinterCredentials | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [paper, setPaper] = useState<Printer | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState<string | null>(null)
  const [confirmEl, ask] = useConfirm()
  const nameInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onEditing?.(Boolean(adding || renaming || credentials))
  }, [adding, renaming, credentials, onEditing])

  useEffect(() => {
    if (adding?.kind) nameInput.current?.select()
  }, [adding?.kind])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(printErrorText(err))
      void onReload()
    } finally {
      setBusy(false)
    }
  }

  function startAdd() {
    setCelebrate(null)
    setAdding({ kind: null, name: '', protocol: 'star' })
  }

  function pickKind(kind: PrinterKind) {
    setAdding((a) => ({ ...(a ?? { protocol: 'star' as PrinterProtocol }), kind, name: suggestName(kind, devices) }))
  }

  function add(e: FormEvent) {
    e.preventDefault()
    if (!adding?.kind) return
    const name = adding.name.trim()
    if (!name || name.length > 40) {
      setError('Ge skrivaren ett namn, högst 40 tecken.')
      nameInput.current?.focus()
      return
    }
    const kind = adding.kind
    void run(async () => {
      const made = await addPrinter(locationId, name, adding.protocol, kind)
      // Kategorier som låter som dryck ("Öl", "Vin") går till Dryck från början.
      const routing = data.routing
      const drinks = routing
        ? categories.filter((c) => !routing.categories[c.categoryId] && c.categoryId !== 'drinks' && soundsLikeDrinks(c.name))
        : []
      if (drinks.length) {
        await saveCategoryRouting(locationId, Object.fromEntries(drinks.map((c) => [c.categoryId, 'bar']))).catch(() => undefined)
      }
      const next = await getPrinting(locationId)
      onChange(next)
      setAdding(null)
      setFresh(made.device.deviceId)
      if (made.secret) setCredentials(made)
      setCelebrate(`${KIND_LABEL[kind]} · ${name}`)
    })
  }

  function changeKind(printer: Printer, kind: PrinterKind) {
    if (kindOf(printer) === kind) return
    void run(async () => {
      onChange(await updatePrinter(locationId, printer.deviceId, { kind }))
      setFresh(printer.deviceId)
    })
  }

  function rename(e: FormEvent) {
    e.preventDefault()
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name || name.length > 40) {
      setError('Ge skrivaren ett namn, högst 40 tecken.')
      return
    }
    void run(async () => {
      onChange(await updatePrinter(locationId, renaming.id, { name }))
      setRenaming(null)
    })
  }

  async function remove(printer: Printer) {
    const ok = await ask({
      title: `Ta bort ${KIND_LABEL[kindOf(printer)]} · ${printer.name}?`,
      text: printer.simulated ? undefined : 'Skrivaren kan inte längre hämta bongar.',
      confirmLabel: 'Ta bort',
      danger: true,
    })
    if (!ok) return
    void run(async () => {
      onChange(await removePrinter(locationId, printer.deviceId))
      if (credentials?.device.deviceId === printer.deviceId) setCredentials(null)
      setCelebrate(null)
    })
  }

  function rotate(printer: Printer) {
    void run(async () => {
      setCredentials(await rotatePrinter(locationId, printer.deviceId))
    })
  }

  function test(printer: Printer) {
    void run(async () => {
      await testPrint(locationId, printer.deviceId)
      setFresh(printer.deviceId)
      if (printer.simulated) setPaper(printer)
    })
  }

  function skip(skipped: boolean) {
    void run(async () => {
      const status = await setPrinterSetupSkipped(locationId, skipped)
      onChange({ ...data, status: { ...data.status, ...status } })
    })
  }

  // Vad varje skrivare får: kategorierna vars station skriver på den.
  const routing = data.routing
  const receives = (printer: Printer): { stations: string[]; names: string[] } => {
    const stations = (routing?.stations ?? []).filter((s) => s.printerIds.includes(printer.deviceId))
    const ids = stations.map((s) => s.stationId ?? '')
    const names = routing
      ? categories.filter((c) => {
        const sid = categoryStation(routing, c.categoryId)
        return sid !== null && ids.includes(sid)
      }).map((c) => c.name)
      : []
    return { stations: ids, names }
  }

  const skipped = data.status.setupSkipped === true

  return (
    <div className="pset">
      {confirmEl}
      <div className="pset-count" aria-label={`${devices.length} skrivare`}>
        <Num>{devices.length}</Num>
        <span>{devices.length === 1 ? 'skrivare' : 'skrivare'}</span>
      </div>

      {celebrate && (
        <p className="pset-yay" role="status">
          <span className="pset-yay-check" aria-hidden="true"><Icon name="check" size={16} /></span>
          <span><strong>{celebrate}</strong> är klar</span>
        </p>
      )}

      {credentials && (
        <div className="printer-credentials" role="region" aria-label="Uppgifter till skrivaren">
          <h3 className="printer-subtitle">Skriv in i skrivaren</h3>
          <p className="cell-muted">Lösenordet visas bara nu.</p>
          <CopyField id="printer-url"
            label={credentials.device.protocol === 'epson' ? 'Server-URL (Server Direct Print)' : 'Server-URL (CloudPRNT)'}
            value={credentials.device.serverUrl ?? ''} />
          <CopyField id="printer-user" label="Användarnamn" value={credentials.username ?? ''} />
          <CopyField id="printer-secret" label="Lösenord" value={credentials.secret ?? ''} secret />
          <span className="row-actions">
            <button type="button" className="btn primary square" onClick={() => setCredentials(null)}>
              Klar, jag har skrivit in det
            </button>
          </span>
        </div>
      )}

      <ul className="pset-grid" aria-label="Skrivare">
        {devices.map((printer) => {
          const kind = kindOf(printer)
          const st = status(printer)
          const got = receives(printer)
          const isRenaming = renaming?.id === printer.deviceId
          return (
            <li key={printer.deviceId} data-stations={got.stations.join(' ')}
              className={`pset-card pset-card--${kind}${fresh === printer.deviceId ? ' is-new' : ''}`}
              onAnimationEnd={(e) => e.animationName === 'pset-print-in' && setFresh(null)}>
              <div className="pset-card-head">
                <span className="pset-icon" aria-hidden="true"><Icon name={KIND_ICON[kind]} size={26} /></span>
                <span className="pset-name">
                  <span className="pset-kind">{KIND_LABEL[kind]}</span>
                  <strong>{printer.name}</strong>
                </span>
                <span className={`pset-status pset-status--${st.tone}`}>{st.text}</span>
              </div>

              {isOwner && (
                <div className="pset-kinds" role="radiogroup" aria-label={`Sort för ${printer.name}`}>
                  {KINDS.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={busy}
                      className={`pset-kind-btn pset-kind-btn--${k}${kind === k ? ' is-on' : ''}`}
                      onClick={() => changeKind(printer, k)}>
                      <Icon name={KIND_ICON[k]} size={16} />
                      <span>{KIND_LABEL[k]}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="pset-gets">
                <span className="pset-gets-label">Får</span>
                {got.names.length ? (
                  got.names.map((n) => <span key={n} className="pset-tag">{n}</span>)
                ) : (
                  <span className="pset-tag pset-tag--empty">Inget än</span>
                )}
              </div>

              {isRenaming ? (
                <form className="pset-rename" onSubmit={rename}>
                  <label className="sr-only" htmlFor={`rename-${printer.deviceId}`}>Namn</label>
                  <input id={`rename-${printer.deviceId}`} value={renaming.name} maxLength={40} autoFocus
                    onChange={(e) => setRenaming({ id: printer.deviceId, name: e.target.value })} />
                  <button type="submit" className="btn primary square" disabled={busy}>Spara</button>
                  <button type="button" className="btn outline square" onClick={() => setRenaming(null)}>Avbryt</button>
                </form>
              ) : (
                <span className="row-actions pset-actions">
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => test(printer)}>
                    Testutskrift
                  </button>
                  {printer.simulated && (
                    <button type="button" className="btn outline square" onClick={() => setPaper(printer)}>
                      <Icon name="receipt" size={16} /> Papper
                    </button>
                  )}
                  {isOwner && (
                    <>
                      <button type="button" className="btn outline square" disabled={busy}
                        onClick={() => setRenaming({ id: printer.deviceId, name: printer.name })}>
                        Byt namn
                      </button>
                      {!printer.simulated && (
                        <button type="button" className="btn outline square" disabled={busy} onClick={() => rotate(printer)}>
                          Ny nyckel
                        </button>
                      )}
                      <button type="button" className="btn danger-outline square" disabled={busy}
                        aria-label={`Ta bort ${printer.name}`} onClick={() => void remove(printer)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </span>
              )}
            </li>
          )
        })}

        {isOwner && devices.length < MAX_PRINTERS && !adding && (
          <li className="pset-add-slot">
            <button type="button" className="pset-add" onClick={startAdd} disabled={busy}>
              <span className="pset-add-plus" aria-hidden="true"><Icon name="plus" size={28} /></span>
              <span>Lägg till skrivare</span>
            </button>
          </li>
        )}
      </ul>

      {adding && (
        <form className="pset-flow" onSubmit={add} aria-label="Ny skrivare">
          <div className="pset-flow-head">
            <h3 className="printer-subtitle">Vad ska den skriva ut?</h3>
            <InfoTooltip label="Sorterna">
              Kök: maten. Dryck: drinkar och annat från baren. Annat: en egen station, till exempel pizzaugnen eller desserterna.
            </InfoTooltip>
          </div>
          <div className="pset-pick" role="radiogroup" aria-label="Sort">
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={adding.kind === k}
                className={`pset-pick-tile pset-pick-tile--${k}${adding.kind === k ? ' is-on' : ''}`}
                onClick={() => pickKind(k)}>
                <span className="pset-pick-icon" aria-hidden="true"><Icon name={KIND_ICON[k]} size={34} /></span>
                <span className="pset-pick-label">{KIND_LABEL[k]}</span>
                {adding.kind === k && <span className="pset-pick-check" aria-hidden="true"><Icon name="check" size={14} /></span>}
              </button>
            ))}
          </div>

          {adding.kind && (
            <div className="pset-flow-rest">
              <div className="form-field">
                <label htmlFor="printer-name">Namn</label>
                <input id="printer-name" ref={nameInput} value={adding.name} maxLength={40} disabled={busy}
                  onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
              </div>
              <div className="form-field">
                <span className="pset-field-label" id="printer-brand-label">Skrivare</span>
                <div className="pset-brands" role="radiogroup" aria-labelledby="printer-brand-label">
                  {(['star', 'epson', ...(simAllowed ? ['sim' as const] : [])] as PrinterProtocol[]).map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={adding.protocol === p}
                      className={`sendto-chip${adding.protocol === p ? ' is-on' : ''}${p === 'sim' ? ' sendto-chip--sim' : ''}`}
                      onClick={() => setAdding({ ...adding, protocol: p })}>
                      {p === 'sim' ? <Icon name="receipt" size={16} /> : <Icon name="printer" size={16} />}
                      <span>{p === 'star' ? 'Star' : p === 'epson' ? 'Epson' : 'Simulerad'}</span>
                    </button>
                  ))}
                </div>
              </div>
              <span className="row-actions">
                <button type="submit" className="btn primary square" disabled={busy}>
                  {busy ? 'Lägger till…' : 'Lägg till'}
                </button>
                <button type="button" className="btn outline square" onClick={() => setAdding(null)}>Avbryt</button>
              </span>
            </div>
          )}
        </form>
      )}

      {isOwner && devices.length === 0 && !adding && (
        <div className={`pset-later${skipped ? ' is-skipped' : ''}`}>
          {skipped ? (
            <>
              <span className="pset-later-pill">Inga skrivare än</span>
              <button type="button" className="btn outline square" disabled={busy} onClick={() => skip(false)}>Ångra</button>
            </>
          ) : (
            <button type="button" className="btn outline square" disabled={busy} onClick={() => skip(true)}>
              Inga skrivare än
            </button>
          )}
        </div>
      )}

      <ErrorNote text={error} />

      {paper && <SimPaperDialog locationId={locationId} printer={paper} onClose={() => setPaper(null)} />}
    </div>
  )
}
