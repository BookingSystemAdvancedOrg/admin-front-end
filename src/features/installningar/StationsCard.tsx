import { useState } from 'react'
import type { FormEvent } from 'react'
import { NO_TICKET, printErrorText, saveRouting } from '../bestallningar/printApi'
import type { Course, Printer, Station, TicketRouting } from '../bestallningar/printApi'

/**
 * Inställningar > Skrivare > Stationer: vart bongarna går.
 *
 * En station (Kök, Bar, Kall kök, Kassa/disk ...) får noll eller flera
 * skrivare; utan skrivare syns bongarna bara på köksskärmen. Varje
 * menykategori går till en station eller "Ingen bong" (läsk ur kylen).
 * En rätt kan ändra sin station i Meny, och en meny/combo delas upp per
 * del. Allergibongen skrivs ut som en egen lapp på stationens skrivare.
 */

const CATEGORIES: { key: Course; label: string }[] = [
  { key: 'starters', label: 'Förrätter' },
  { key: 'mains', label: 'Varmrätter' },
  { key: 'desserts', label: 'Efterrätter' },
  { key: 'drinks', label: 'Drycker' },
]
const MAX_STATIONS = 12

/** Lokal nyckel för en station som inte är sparad än. */
type Draft = Station & { key: string }

function drafts(routing: TicketRouting): Draft[] {
  return routing.stations.map((s, i) => ({ ...s, key: s.stationId ?? `new-${i}` }))
}

export function StationsCard({ locationId, isOwner, routing, devices, onSaved }: {
  locationId: string
  isOwner: boolean
  routing: TicketRouting
  devices: Printer[]
  onSaved: (routing: TicketRouting) => void
}) {
  const [stations, setStations] = useState<Draft[]>(() => drafts(routing))
  const [categories, setCategories] = useState(routing.categories)
  const [allergyTicket, setAllergyTicket] = useState(routing.allergyTicket)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const disabled = !isOwner || busy

  function update(key: string, change: Partial<Station>) {
    setStations((prev) => prev.map((s) => (s.key === key ? { ...s, ...change } : s)))
    setNotice(null)
  }

  function togglePrinter(station: Draft, deviceId: string) {
    const on = station.printerIds.includes(deviceId)
    update(station.key, { printerIds: on ? station.printerIds.filter((id) => id !== deviceId) : [...station.printerIds, deviceId] })
  }

  function add() {
    const key = `new-${Date.now()}`
    setStations((prev) => [...prev, { key, name: '', printerIds: [] }])
    setNotice(null)
    window.setTimeout(() => document.getElementById(`station-name-${key}`)?.focus(), 0)
  }

  function remove(station: Draft) {
    setStations((prev) => prev.filter((s) => s.key !== station.key))
    // Kategorier som pekade på stationen går till den första som är kvar.
    setCategories((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === station.stationId ? undefined : v])))
    setNotice(null)
  }

  function fail(text: string, field: string) {
    setError({ text, field })
    document.getElementById(field)?.focus()
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const names = new Set<string>()
    for (const s of stations) {
      const name = s.name.trim()
      if (!name || name.length > 30) {
        fail('Ge stationen ett namn, högst 30 tecken (till exempel Kök eller Bar).', `station-name-${s.key}`)
        return
      }
      if (names.has(name.toLowerCase())) {
        fail(`Två stationer heter ${name}. Ge dem olika namn.`, `station-name-${s.key}`)
        return
      }
      names.add(name.toLowerCase())
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    const known = new Set(stations.map((s) => s.stationId).filter(Boolean))
    const body: TicketRouting = {
      stations: stations.map(({ stationId, name, printerIds }) => ({ ...(stationId ? { stationId } : {}), name: name.trim(), printerIds })),
      categories: Object.fromEntries(CATEGORIES.map(({ key }) => {
        const v = categories[key]
        return [key, v === NO_TICKET || (v && known.has(v)) ? v : stations[0]?.stationId]
      }).filter(([, v]) => v)),
      allergyTicket,
      version: routing.version,
    }
    saveRouting(locationId, body)
      .then((saved) => {
        setStations(drafts(saved))
        setCategories(saved.categories)
        onSaved(saved)
        setNotice('Sparat. Nya beställningar får bongar enligt det här.')
      })
      .catch((err) => setError({ text: printErrorText(err) }))
      .finally(() => setBusy(false))
  }

  const unsaved = stations.some((s) => !s.stationId)

  return (
    <section id="stationer" className="admin-card table-card printer-card" aria-labelledby="stations-title">
      <h2 className="card-title" id="stations-title">Bongar och stationer</h2>
      <p className="cell-muted printer-lead">
        Varje station får sin egen bong: maten till köket, drycken till baren. Allergier och önskemål följer
        rätten och står i fetstil. En station utan skrivare syns bara på köksskärmen under Beställningar.
      </p>
      <form onSubmit={save} className="printer-stack">
        <ul className="station-list" aria-label="Stationer">
          {stations.map((station) => (
            <li key={station.key} className="station-row">
              <div className="station-head">
                <div className="form-field">
                  <label htmlFor={`station-name-${station.key}`}>Station</label>
                  <input id={`station-name-${station.key}`} value={station.name} maxLength={30} disabled={disabled}
                    placeholder="Till exempel Kall kök" aria-invalid={error?.field === `station-name-${station.key}` || undefined}
                    onChange={(e) => update(station.key, { name: e.target.value })} />
                </div>
                {isOwner && stations.length > 1 && (
                  <button type="button" className="btn danger-outline square" disabled={busy} onClick={() => remove(station)}>
                    Ta bort
                  </button>
                )}
              </div>
              <fieldset className="station-printers" disabled={disabled}>
                <legend>Skrivare</legend>
                {devices.length === 0 ? (
                  <p className="cell-muted">Inga skrivare än: bongarna visas på köksskärmen.</p>
                ) : devices.map((d) => (
                  <label key={d.deviceId} className="station-printer">
                    <input type="checkbox" checked={station.printerIds.includes(d.deviceId)}
                      onChange={() => togglePrinter(station, d.deviceId)} />
                    <span>{d.name}</span>
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ul>
        {isOwner && stations.length < MAX_STATIONS && (
          <span className="row-actions">
            <button type="button" className="btn outline square" disabled={busy} onClick={add}>Lägg till station</button>
          </span>
        )}

        <div>
          <h3 className="printer-subtitle">Vart går menyns kategorier?</h3>
          <p className="cell-muted station-hint">
            En enskild rätt kan gå någon annanstans (Meny, rätten, Bong). Välj Ingen bong för det som inte
            behöver tillagas, som läsk ur kylen.
          </p>
          <div className="form-grid">
            {CATEGORIES.map(({ key, label }) => (
              <div key={key} className="form-field">
                <label htmlFor={`route-${key}`}>{label}</label>
                <select id={`route-${key}`} value={categories[key] ?? stations[0]?.stationId ?? ''} disabled={disabled}
                  onChange={(e) => { setCategories((prev) => ({ ...prev, [key]: e.target.value })); setNotice(null) }}>
                  {stations.filter((s) => s.stationId).map((s) => (
                    <option key={s.key} value={s.stationId}>{s.name || 'Namnlös station'}</option>
                  ))}
                  <option value={NO_TICKET}>Ingen bong</option>
                </select>
              </div>
            ))}
          </div>
          {unsaved && <p className="cell-muted station-hint">Nya stationer går att välja här när du har sparat.</p>}
        </div>

        <div className="toggle-row">
          <div>
            <p className="toggle-row-label" id="allergy-ticket-label">Egen allergibong</p>
            <p className="cell-muted">När en rad har en allergi skrivs en extra, tydligt märkt lapp ut på stationen.</p>
          </div>
          <button type="button" role="switch" aria-checked={allergyTicket} aria-labelledby="allergy-ticket-label"
            className="switch" disabled={disabled} onClick={() => { setAllergyTicket(!allergyTicket); setNotice(null) }} />
        </div>

        {isOwner ? (
          <span className="row-actions">
            <button type="submit" className="btn primary square" disabled={disabled}>
              {busy ? 'Sparar…' : 'Spara stationer'}
            </button>
          </span>
        ) : (
          <p className="cell-muted">Bara restaurangens ägare kan ändra stationerna.</p>
        )}
        {error && <p className="form-error" role="alert">{error.text}</p>}
        {notice && <p className="save-notice" role="status">{notice}</p>}
      </form>
    </section>
  )
}
