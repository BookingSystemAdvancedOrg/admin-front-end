import { useLiveRefresh } from '../../shared/live'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  getPrinting,
  printErrorText,
  saveCategoryRouting,
  saveRouting,
  savePrintSettings,
} from '../bestallningar/printApi'
import type { PaperWidth, PrintOverview } from '../bestallningar/printApi'
import { getMenuCategories } from '../meny/menuApi'
import type { MenuCategoryEntry } from '../meny/data'
import { DEFAULT_CATEGORIES } from '../meny/data'
import './printer.css'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'
import { TitleInfo } from '../../shared/TitleInfo'
import { Disclosure } from '../../shared/Disclosure'
import { Select } from '../../shared/Select'
import { Loading } from '../../shared/Loading'
import { SaveBar } from '../../shared/SaveBar'
import { PrinterTiles } from '../printers/PrinterTiles'
import { CategoryRouting } from '../printers/CategoryRouting'
import { drinkDefaults } from '../printers/kinds'

/**
 * Inställningar, Beställning, Kvittoskrivare (och steget i Kom igång).
 *
 * Ägaren lägger till en skrivare per plats i köket eller baren och väljer
 * med ett tryck vad den är: Kök (maten), Dryck (baren) eller Annat (en egen
 * station, till exempel pizzaugnen). Maten skrivs ut på Kök, drycken på
 * Dryck; finns bara den ena sorten skriver den allt. Under "Vad skickas
 * vart?" går varje menykategori till en skrivare med ett tryck, och en
 * rätt kan välja egen i Meny.
 *
 * Skrivarna (Star CloudPRNT, t.ex. mC-Print3, eller Epson Server Direct
 * Print, t.ex. TM-m30III) frågar Booqy efter bongar via internet. Ägaren
 * får en adress, ett användarnamn och ett lösenord att skriva in i
 * skrivarens webbsida (visas en gång). I testmiljön finns även en
 * simulerad skrivare som visar bongarna på skärmen.
 *
 * "Inga skrivare än" låter ägaren gå vidare: steget står kvar som öppet
 * (gult) i Kom igång tills en skrivare finns.
 *
 * Personal med Beställningar lägger också till skrivare, byter namn och
 * sort och testar; ta bort, ny nyckel och inställningarna är ägarens.
 */
export function PrinterCard({ locationId, isOwner, canSetUp = isOwner }: {
  locationId: string | null
  isOwner: boolean
  /** Ägaren eller personal med Beställningar: lägga till skrivare, byta namn och sort, testa. */
  canSetUp?: boolean
}) {
  const [data, setData] = useState<PrintOverview | null>(null)
  const [categories, setCategories] = useState<MenuCategoryEntry[]>(DEFAULT_CATEGORIES)
  const [loadError, setLoadError] = useState(false)
  const [autoPrint, setAutoPrint] = useState(false)
  const [printerId, setPrinterId] = useState('')
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(80)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

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

  // Levande: skrivare som kopplas in eller tappar kontakten syns av sig själva.
  // Inställningarna du håller på att ändra skrivs inte över.
  useLiveRefresh(async () => {
    if (!locationId) return
    const next = await getPrinting(locationId)
    const s = data?.settings
    const untouched = !s || (autoPrint === s.autoPrint && printerId === (s.printerId ?? '') && paperWidth === s.paperWidth)
    if (untouched) apply(next)
    else setData(next)
    setLoadError(false)
  }, { enabled: Boolean(locationId) && !busy && !editing })

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getPrinting(locationId)
      .then((next) => !cancelled && apply(next))
      .catch(() => !cancelled && setLoadError(true))
    getMenuCategories(locationId)
      .then((c) => !cancelled && c.categories.length && setCategories(c.categories))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Äldre kategorier som låter som dryck ("Öl", "Vin") utan eget val går till
  // Dryck, aldrig till köket (en gång per kategori; syns som vanliga chips).
  const healed = useRef(new Set<string>())
  const routingNow = data?.routing ?? null
  useEffect(() => {
    if (!locationId || !isOwner || !routingNow) return
    const todo = Object.fromEntries(Object.entries(drinkDefaults(routingNow, categories)).filter(([id]) => !healed.current.has(id)))
    if (!Object.keys(todo).length) return
    Object.keys(todo).forEach((id) => healed.current.add(id))
    saveCategoryRouting(locationId, todo)
      .then((routing) => setData((d) => (d ? { ...d, routing } : d)))
      .catch(() => undefined)
  }, [locationId, isOwner, routingNow, categories])

  async function run(action: () => Promise<void>, settingsForm = false) {
    setBusy(true)
    setError(null)
    setNotice(null)
    setFailed(false)
    try {
      await action()
    } catch (err) {
      setError(printErrorText(err))
      if (settingsForm) setFailed(true)
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
      setFailed(true)
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
    }, true)
  }

  function setAllergyTicket(on: boolean) {
    if (!locationId || !data?.routing) return
    const routing = data.routing
    void run(async () => {
      const saved = await saveRouting(locationId, {
        ...routing,
        stations: routing.stations.map(({ stationId, name, printerIds }) => ({ stationId, name, printerIds })),
        allergyTicket: on,
      })
      setData({ ...data, routing: saved })
    })
  }

  const devices = data?.devices ?? []
  const saved = data?.settings
  const dirty = Boolean(saved) && (saved!.autoPrint !== autoPrint || (saved!.printerId ?? '') !== printerId
    || saved!.paperWidth !== paperWidth)
  const disabled = !isOwner || busy

  function edited() {
    setNotice(null)
    setFailed(false)
  }

  function discard() {
    if (!saved) return
    setAutoPrint(saved.autoPrint)
    setPrinterId(saved.printerId ?? '')
    setPaperWidth(saved.paperWidth)
    setError(null)
    setFailed(false)
  }

  return (
    <>
      <section id="skrivare" className="admin-card table-card printer-card">
        <TitleInfo
          title="Kvittoskrivare"
          info="En skrivare per plats i köket eller baren. Maten skrivs ut på Kök, drycken på Dryck. Finns bara Kök skrivs drycken där också, och tvärtom. Annat är en egen station, till exempel pizzaugnen. Fungerar med Star (CloudPRNT, till exempel mC-Print3) och Epson (Server Direct Print, till exempel TM-m30III) med internet."
        />

        {!locationId ? (
          <p className="cell-muted">Välj en plats först.</p>
        ) : loadError && !data ? (
          <ErrorNote text={booqyFaultText('Skrivarna kunde inte visas.')} onRetry={() => { setLoadError(false); void reload() }} />
        ) : !data ? (
          <Loading label="Hämtar skrivare" />
        ) : (
          <PrinterTiles
            locationId={locationId}
            isOwner={isOwner}
            canSetUp={canSetUp}
            data={data}
            categories={categories}
            onChange={apply}
            onReload={reload}
            onEditing={setEditing}
          />
        )}
      </section>

      {locationId && data?.routing && (
        <section className="admin-card table-card printer-card" id="skickas-till">
          <TitleInfo
            title="Vad skickas vart?"
            info="Ett tryck per kategori. Förrätter, varmrätter och efterrätter går till Kök, drycker till Dryck. Ingen bong = inget skrivs ut (läsk ur kylen). En rätt kan välja egen i Meny. Gäller skrivarna och köksskärmen."
          />
          <CategoryRouting
            locationId={locationId}
            routing={data.routing}
            devices={devices}
            categories={categories}
            canEdit={isOwner}
            onSaved={(routing) => setData({ ...data, routing })}
          />
        </section>
      )}

      {locationId && data && (
        <Disclosure title="Mer inställningar" className="admin-card table-card printer-guide">
          <form onSubmit={saveSettings} className="notifications-form printer-settings">
            <div className="toggle-row">
              <div>
                <p className="toggle-row-label" id="print-auto-label">Skriv ut bongar automatiskt</p>
              </div>
              <button type="button" role="switch" aria-checked={autoPrint} aria-labelledby="print-auto-label"
                className="switch" disabled={disabled} onClick={() => { setAutoPrint(!autoPrint); edited() }} />
            </div>
            {data.routing && (
              <div className="toggle-row">
                <div>
                  <p className="toggle-row-label" id="print-allergy-label">Egen allergibong</p>
                </div>
                <button type="button" role="switch" aria-checked={data.routing.allergyTicket} aria-labelledby="print-allergy-label"
                  className="switch" disabled={disabled} onClick={() => setAllergyTicket(!data.routing!.allergyTicket)} />
              </div>
            )}
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="print-printer">Orderskrivare (omtryck och makulering)</label>
                <Select id="print-printer" value={printerId} disabled={disabled}
                  aria-invalid={(failed && autoPrint && !printerId) || undefined}
                  onChange={(e) => { setPrinterId(e.target.value); edited() }}>
                  <option value="">Ingen</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.name}</option>
                  ))}
                </Select>
              </div>
              <div className="form-field">
                <label htmlFor="print-width">Pappersbredd</label>
                <Select id="print-width" value={paperWidth} disabled={disabled}
                  onChange={(e) => { setPaperWidth(Number(e.target.value) as PaperWidth); edited() }}>
                  <option value={80}>80 mm (48 tecken per rad)</option>
                  <option value={58}>58 mm (32 tecken per rad)</option>
                </Select>
              </div>
            </div>
            <ErrorNote text={error} />
            {isOwner ? (
              <SaveBar
                dirty={dirty}
                busy={busy}
                label="Spara skrivare"
                notice={notice}
                failed={failed}
                disabled={disabled}
                onDiscard={discard}
              />
            ) : (
              <p className="cell-muted">Bara ägaren kan ändra.</p>
            )}
          </form>
        </Disclosure>
      )}

      <Disclosure title="Så kopplar du skrivaren" className="admin-card table-card printer-guide">
        <p className="cell-muted printer-lead">Star mC-Print3 och andra Star med CloudPRNT</p>
        <ol className="printer-steps">
          <li>
            Koppla skrivaren till routern med nätverkskabel och slå på den. Håll inne FEED-knappen när du slår
            på strömmen: skrivaren skriver då ut en lapp med sin IP-adress.
          </li>
          <li>
            Skriv in IP-adressen i webbläsaren på en dator i samma nätverk och logga in i skrivarens
            inställningar (användare och lösenord står i skrivarens manual, byt gärna lösenordet).
          </li>
          <li>Tryck Lägg till skrivare och välj Kök, Dryck eller Annat. Booqy visar Server-URL, användarnamn och lösenord.</li>
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
            Ansluten.
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
        <h3 className="printer-subtitle printer-subtitle--gap">Epson TM-m30III och andra Epson med Server Direct Print</h3>
        <ol className="printer-steps">
          <li>Lägg till skrivaren med märket Epson. Booqy visar Server-URL, användarnamn och lösenord.</li>
          <li>
            Öppna skrivarens webbsida (EpsonNet Config) via dess IP-adress och välj Server Direct Print.
            Slå på det, klistra in Server-URL och sätt intervallet till 5 sekunder.
          </li>
          <li>Fyll i användarnamn (ID) och lösenord under autentisering, spara och starta om skrivaren.</li>
          <li>Tryck på Testutskrift. Lappen kommer ut inom några sekunder.</li>
        </ol>
      </Disclosure>
    </>
  )
}
