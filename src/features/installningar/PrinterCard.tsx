import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  addPrinter,
  getPrinting,
  printErrorText,
  removePrinter,
  rotatePrinter,
  savePrintSettings,
  testPrint,
} from '../bestallningar/printApi'
import type { PaperWidth, PrintOverview, Printer, PrinterCredentials } from '../bestallningar/printApi'
import { clock } from '../bestallningar/ordersApi'
import './printer.css'
import { SkelLines } from '../../shared/Skeleton'

/**
 * Inställningar > Skrivare: köksskrivaren för matbeställningar.
 *
 * Skrivaren (Star CloudPRNT, t.ex. mC-Print3 med nätverkskabel) frågar
 * Booqy var femte sekund om det finns något att skriva ut. Ägaren lägger
 * till skrivaren här och får en adress, ett användarnamn och ett lösenord
 * att skriva in i skrivarens egen webbsida. Lösenordet visas en gång;
 * "Ny nyckel" ger ett nytt (och stänger det gamla). Personalen ser läget
 * och kan skriva ut en testlapp.
 */

function seenText(printer: Printer): string {
  if (!printer.lastSeenAt) return 'Väntar på första kontakt'
  if (printer.online) return 'Ansluten'
  return `Svarar inte (senast ${clock(printer.lastSeenAt)})`
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

export function PrinterCard({ locationId, isOwner }: { locationId: string | null; isOwner: boolean }) {
  const [data, setData] = useState<PrintOverview | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [autoPrint, setAutoPrint] = useState(false)
  const [printerId, setPrinterId] = useState('')
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(80)
  const [name, setName] = useState('')
  const [credentials, setCredentials] = useState<PrinterCredentials | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function apply(next: PrintOverview) {
    setData(next)
    setAutoPrint(next.settings.autoPrint)
    setPrinterId(next.settings.printerId ?? '')
    setPaperWidth(next.settings.paperWidth)
  }

  async function reload() {
    if (!locationId) return
    try {
      apply(await getPrinting(locationId))
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getPrinting(locationId)
      .then((next) => !cancelled && apply(next))
      .catch(() => !cancelled && setLoadError(true))
    return () => {
      cancelled = true
    }
  }, [locationId])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(printErrorText(err))
      void reload()
    } finally {
      setBusy(false)
    }
  }

  function saveSettings(e: FormEvent) {
    e.preventDefault()
    if (!locationId || !data) return
    if (autoPrint && !printerId) {
      setError('Välj vilken skrivare som ska skriva ut beställningarna.')
      return
    }
    void run(async () => {
      const settings = await savePrintSettings(locationId, {
        autoPrint,
        printerId: printerId || null,
        paperWidth,
        version: data.settings.version,
      })
      setData({ ...data, settings })
      setNotice(settings.autoPrint ? 'Sparat. Nya betalda beställningar skrivs ut.' : 'Sparat. Automatisk utskrift är avstängd.')
    })
  }

  function add(e: FormEvent) {
    e.preventDefault()
    if (!locationId) return
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40) {
      setError('Ge skrivaren ett namn, högst 40 tecken (till exempel Köket).')
      return
    }
    void run(async () => {
      setCredentials(await addPrinter(locationId, trimmed))
      setName('')
      await reload()
    })
  }

  function rotate(printer: Printer) {
    if (!locationId) return
    void run(async () => {
      setCredentials(await rotatePrinter(locationId, printer.deviceId))
      await reload()
    })
  }

  function remove(printer: Printer) {
    if (!locationId) return
    void run(async () => {
      apply(await removePrinter(locationId, printer.deviceId))
      setConfirmRemove(null)
      if (credentials?.device.deviceId === printer.deviceId) setCredentials(null)
      setNotice(`${printer.name} är borttagen och kan inte längre hämta utskrifter.`)
    })
  }

  function test(printer: Printer) {
    if (!locationId) return
    void run(async () => {
      await testPrint(locationId, printer.deviceId)
      setNotice(`Testlapp skickad till ${printer.name}. Den kommer ut inom några sekunder om skrivaren är ansluten.`)
    })
  }

  const devices = data?.devices ?? []
  const saved = data?.settings
  const dirty = Boolean(saved) && (saved!.autoPrint !== autoPrint || (saved!.printerId ?? '') !== printerId
    || saved!.paperWidth !== paperWidth)
  const disabled = !isOwner || busy

  return (
    <>
      <section id="skrivare" className="admin-card table-card printer-card">
        <h2 className="card-title">Köksskrivare</h2>
        <p className="cell-muted printer-lead">
          Betalda beställningar skrivs ut i köket av sig själva, som en köksnota utan priser. Fungerar med
          Star-skrivare med CloudPRNT (till exempel mC-Print3) som är kopplade till internet med nätverkskabel.
        </p>

        {!locationId ? (
          <p className="cell-muted">Välj en plats först.</p>
        ) : loadError && !data ? (
          <p className="form-error" role="alert">Kunde inte hämta skrivarna. Ladda om sidan om en stund.</p>
        ) : !data ? (
          <SkelLines n={3} />
        ) : (
          <div className="printer-stack">
            {credentials && (
              <div className="printer-credentials" role="region" aria-label="Uppgifter till skrivaren">
                <h3 className="printer-subtitle">Skriv in detta i skrivaren nu</h3>
                <p className="cell-muted">
                  Lösenordet visas bara den här gången. Tappar du bort det: välj Ny nyckel och skriv in det nya.
                </p>
                <CopyField id="printer-url" label="Server-URL (CloudPRNT)" value={credentials.device.serverUrl ?? ''} />
                <CopyField id="printer-user" label="Användarnamn" value={credentials.username} />
                <CopyField id="printer-secret" label="Lösenord" value={credentials.secret} secret />
                <span className="row-actions">
                  <button type="button" className="btn primary square" onClick={() => setCredentials(null)}>
                    Klar, jag har skrivit in det
                  </button>
                </span>
              </div>
            )}

            {devices.length === 0 ? (
              <p className="cell-muted">Ingen skrivare är tillagd än.</p>
            ) : (
              <ul className="printer-list" aria-label="Skrivare">
                {devices.map((printer) => {
                  const removing = confirmRemove === printer.deviceId
                  return (
                    <li key={printer.deviceId} className="printer-row">
                      <div className="printer-row-head">
                        <strong>{printer.name}</strong>
                        <span className={`status-badge ${printer.online ? 'reserved' : printer.lastSeenAt ? 'cancelled' : 'waiting'}`}>
                          {seenText(printer)}
                        </span>
                      </div>
                      <p className="cell-muted printer-meta">
                        {printer.deviceId === saved?.printerId ? 'Skriver ut beställningarna' : 'Används inte för beställningar'}
                        {printer.mac ? ` · MAC ${printer.mac}` : ''}
                        {printer.statusCode && !printer.statusCode.startsWith('2') ? ` · Skrivaren rapporterar: ${printer.statusCode}` : ''}
                      </p>
                      <span className="row-actions">
                        <button type="button" className="btn outline square" disabled={busy}
                          onClick={() => test(printer)}>
                          Testutskrift
                        </button>
                        {isOwner && !removing && (
                          <>
                            <button type="button" className="btn outline square" disabled={busy}
                              onClick={() => rotate(printer)}>
                              Ny nyckel
                            </button>
                            <button type="button" className="btn danger-outline square" disabled={busy}
                              onClick={() => setConfirmRemove(printer.deviceId)}>
                              Ta bort
                            </button>
                          </>
                        )}
                        {isOwner && removing && (
                          <>
                            <button type="button" className="btn danger-outline square" disabled={busy}
                              onClick={() => remove(printer)}>
                              Bekräfta: ta bort {printer.name}
                            </button>
                            <button type="button" className="btn outline square" onClick={() => setConfirmRemove(null)}>
                              Behåll
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            {isOwner && devices.length < 5 && (
              <form onSubmit={add} className="printer-add">
                <div className="form-field">
                  <label htmlFor="printer-name">Lägg till skrivare</label>
                  <input id="printer-name" value={name} maxLength={40} placeholder="Till exempel Köket"
                    disabled={busy} onChange={(e) => setName(e.target.value)} />
                </div>
                <button type="submit" className="btn outline square" disabled={busy}>
                  Lägg till
                </button>
              </form>
            )}

            {devices.length > 0 && (
              <form onSubmit={saveSettings} className="notifications-form printer-settings">
                <div className="toggle-row">
                  <div>
                    <p className="toggle-row-label" id="print-auto-label">Skriv ut beställningar automatiskt</p>
                    <p className="cell-muted">När en gäst har betalat kommer köksnotan ut direkt.</p>
                  </div>
                  <button type="button" role="switch" aria-checked={autoPrint} aria-labelledby="print-auto-label"
                    className="switch" disabled={disabled} onClick={() => { setAutoPrint(!autoPrint); setNotice(null) }} />
                </div>
                <div className="form-grid">
                  <div className="form-field">
                    <label htmlFor="print-printer">Skrivare för beställningar</label>
                    <select id="print-printer" value={printerId} disabled={disabled}
                      onChange={(e) => { setPrinterId(e.target.value); setNotice(null) }}>
                      <option value="">Ingen</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="print-width">Pappersbredd</label>
                    <select id="print-width" value={paperWidth} disabled={disabled}
                      onChange={(e) => { setPaperWidth(Number(e.target.value) as PaperWidth); setNotice(null) }}>
                      <option value={80}>80 mm (48 tecken per rad)</option>
                      <option value={58}>58 mm (32 tecken per rad)</option>
                    </select>
                  </div>
                </div>
                {isOwner ? (
                  <span className="row-actions">
                    <button type="submit" className="btn primary square" disabled={disabled}>
                      {busy ? 'Sparar…' : 'Spara skrivare'}
                    </button>
                    {dirty && !busy && (
                      <span className="form-error" role="status">Ej sparat - klicka Spara skrivare.</span>
                    )}
                  </span>
                ) : (
                  <p className="cell-muted">Bara restaurangens ägare kan ändra skrivarna.</p>
                )}
              </form>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="save-notice" role="status">{notice}</p>}
          </div>
        )}
      </section>

      <section className="admin-card table-card printer-guide" aria-labelledby="printer-guide-title">
        <h2 className="card-title" id="printer-guide-title">Så kopplar du skrivaren</h2>
        <p className="cell-muted printer-lead">Gäller Star mC-Print3. Andra Star-skrivare med CloudPRNT fungerar likadant.</p>
        <ol className="printer-steps">
          <li>
            Koppla skrivaren till routern med nätverkskabel och slå på den. Håll inne FEED-knappen när du slår
            på strömmen: skrivaren skriver då ut en lapp med sin IP-adress.
          </li>
          <li>
            Skriv in IP-adressen i webbläsaren på en dator i samma nätverk och logga in i skrivarens
            inställningar (användare och lösenord står i skrivarens manual, byt gärna lösenordet).
          </li>
          <li>Lägg till skrivaren under Köksskrivare. Booqy visar Server-URL, användarnamn och lösenord.</li>
          <li>
            Öppna CloudPRNT i skrivarens inställningar. Slå på CloudPRNT, klistra in Server-URL och sätt
            avfrågningsintervallet (polling) till 5 sekunder.
          </li>
          <li>
            Fyll i användarnamn och lösenord under autentisering (HTTP Basic). Spara och starta om
            skrivaren.
          </li>
          <li>
            Tryck på Testutskrift. Inom några sekunder kommer en testlapp ut och skrivaren står som
            Ansluten. Slå sedan på Skriv ut beställningar automatiskt.
          </li>
        </ol>
        <h3 className="printer-subtitle">Om något inte fungerar</h3>
        <ul className="printer-tips cell-muted">
          <li>Svarar inte: kontrollera kabeln, att CloudPRNT är på och att Server-URL är exakt rätt.</li>
          <li>
            Saknar skrivaren fält för användarnamn och lösenord: uppdatera dess firmware. Går det inte,
            lägg till <code>?k=</code> och lösenordet sist i Server-URL.
          </li>
          <li>Står det Svarar inte på Beställningar, skrivs notorna ut så fort skrivaren är tillbaka.</li>
        </ul>
      </section>
    </>
  )
}
