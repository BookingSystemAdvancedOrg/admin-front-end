import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { WEEKDAYS, getLocation, updateLocation } from './locationApi'
import {
  DURATION_OPTIONS,
  EXTENSION_OPTIONS,
  LAST_SEATING_OPTIONS,
  MAX_WINDOWS,
  NAME_MAX,
  WEEKDAY_SHORT,
  describeWindow,
  minutesLabel,
  newWindow,
  overlapWarnings,
  rulesFromLocation,
  toPayload,
  validateRules,
} from './bookingTime'
import type { BookingExtension, BookingTimeRules, BookingTimeWindow } from './bookingTime'
import './bookingTime.css'
import { DateInput, TimeInput } from '../../shared/DateInput'
import { SkelRows } from '../../shared/Skeleton'

/**
 * Bokningstid (backend shared/booking_rules.py): standardlängd, om
 * personalen får förlänga, sista sittning och specialtider (t.ex.
 * lunchbuffé) som styr längden för bokningar som STARTAR inom dem. Varje
 * bokning sparar regeln den fick, så en ändring här flyttar aldrig
 * befintliga bokningar.
 */

function MinutesSelect({
  id,
  value,
  options,
  onChange,
  zeroLabel,
}: {
  id: string
  value: number
  options: number[]
  onChange: (m: number) => void
  zeroLabel?: string
}) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b)
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {all.map((m) => (
        <option key={m} value={m}>
          {m === 0 && zeroLabel ? zeroLabel : minutesLabel(m)}
        </option>
      ))}
    </select>
  )
}

function ExtensionFields({
  id,
  value,
  onChange,
  label,
}: {
  id: string
  value: BookingExtension
  onChange: (next: BookingExtension) => void
  label: string
}) {
  return (
    <div className="bt-extension">
      <label className="check-row">
        <input
          type="checkbox"
          checked={value.allowed}
          onChange={(e) => onChange({ allowed: e.target.checked, maxMinutes: e.target.checked ? value.maxMinutes || 30 : 0 })}
        />
        {label}
      </label>
      {value.allowed && (
        <div className="form-field bt-extension-max">
          <label htmlFor={id}>Högst</label>
          <MinutesSelect
            id={id}
            value={value.maxMinutes}
            options={EXTENSION_OPTIONS}
            onChange={(m) => onChange({ allowed: true, maxMinutes: m })}
          />
        </div>
      )}
    </div>
  )
}

export function BookingTimeCard({ locationId, isOwner }: { locationId: string | null; isOwner: boolean }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [rules, setRules] = useState<BookingTimeRules | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [graceMinutes, setGraceMinutes] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        const value = rulesFromLocation(loc.bookingTimeRules, loc.bookingDurationHours)
        setRules(value)
        setSaved(JSON.stringify(toPayload(value)))
        setLegacy(!loc.bookingTimeRules)
        setGraceMinutes(Math.round((loc.gracePeriodHours ?? 0) * 60))
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta platsens bokningstid.')))
    return () => {
      cancelled = true
    }
  }, [locationId])

  const disabled = !isOwner || busy || !rules
  const dirty = rules !== null && (legacy || JSON.stringify(toPayload(rules)) !== saved)
  const warnings = rules ? overlapWarnings(rules) : []

  function change(next: BookingTimeRules) {
    setRules(next)
    setNotice(null)
    setError(null)
  }

  function setWindow(id: string, patch: Partial<BookingTimeWindow>) {
    if (!rules) return
    change({ ...rules, windows: rules.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) })
  }

  function addWindow() {
    if (!rules) return
    const w = newWindow()
    change({ ...rules, windows: [...rules.windows, w] })
    setOpen(w.id)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId || !rules) return
    const problem = validateRules(rules, graceMinutes)
    if (problem) return setError(problem)
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const payload = toPayload(rules)
      // bookingDurationHours följer standardlängden (äldre klienter och
      // reserven om reglerna tas bort).
      const updated = await updateLocation(locationId, {
        bookingTimeRules: payload,
        bookingDurationHours: payload.defaultMinutes / 60,
      })
      const value = rulesFromLocation(updated.bookingTimeRules, updated.bookingDurationHours)
      setRules(value)
      setSaved(JSON.stringify(toPayload(value)))
      setLegacy(!updated.bookingTimeRules)
      setOpen(null)
      setNotice('Sparat. Gäller nya bokningar; befintliga behåller sin tid.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.', { owner_only: 'Bara restaurangens ägare kan ändra bokningstiden.', forbidden: 'Bara restaurangens ägare kan ändra bokningstiden.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-card table-card">
      <h2 className="card-title">Bokningstid</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">
        Hur länge ett bord är bokat. Specialtider (t.ex. lunchbuffé) gäller bokningar som börjar inom dem.
        Varje bokning behåller tiden den fick, även om du ändrar här.
      </p>
      <div style={{ height: 16 }} />
      {!locationId ? (
        <p className="cell-muted">Välj en plats först.</p>
      ) : !rules ? (
        error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <SkelRows n={3} cols={3} />
        )
      ) : (
        <form onSubmit={save} className="notifications-form">
          {legacy && (
            <p className="cell-muted" role="note">
              Nu: {minutesLabel(rules.defaultMinutes)} per bokning, ingen förlängning. Spara för att börja använda
              inställningarna nedan.
            </p>
          )}
          <fieldset className="bt-fieldset" disabled={disabled}>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="bt-default">Standardlängd</label>
                <MinutesSelect
                  id="bt-default"
                  value={rules.defaultMinutes}
                  options={DURATION_OPTIONS}
                  onChange={(m) => change({ ...rules, defaultMinutes: m })}
                />
              </div>
              <div className="form-field">
                <span className="form-field-label-row">
                  <label htmlFor="bt-last">Sista sittning före stängning</label>
                  <InfoTooltip label="Sista sittning">
                    Ingen bokning börjar senare än så här före stängning. Är bokningen längre gäller längden (hela
                    bokningen ska rymmas före stängning).
                  </InfoTooltip>
                </span>
                <MinutesSelect
                  id="bt-last"
                  value={rules.lastSeatingMinutes}
                  options={LAST_SEATING_OPTIONS}
                  zeroLabel="Bara bokningens längd"
                  onChange={(m) => change({ ...rules, lastSeatingMinutes: m })}
                />
              </div>
            </div>
            <ExtensionFields
              id="bt-default-ext"
              value={rules.extension}
              label="Personalen får förlänga bokningar om bordet är ledigt"
              onChange={(extension) => change({ ...rules, extension })}
            />
          </fieldset>

          <div>
            <p className="form-section-label">Specialtider</p>
            {rules.windows.length === 0 && (
              <p className="cell-muted">Inga specialtider. Alla bokningar får standardlängden.</p>
            )}
          </div>
          {rules.windows.length > 0 && (
            <ul className="bt-windows">
              {rules.windows.map((w) => (
                <li key={w.id} className="bt-window">
                  <div className="special-day-row">
                    <span className="bt-window-summary">
                      <span className="cell-strong">{w.name || 'Namnlös'}</span>
                      <span className="cell-muted"> · {describeWindow(w)}</span>
                    </span>
                    {isOwner && (
                      <span className="row-actions">
                        <button
                          type="button"
                          className="link-btn bt-link"
                          disabled={disabled}
                          aria-expanded={open === w.id}
                          onClick={() => setOpen(open === w.id ? null : w.id)}
                        >
                          {open === w.id ? 'Stäng' : 'Ändra'}
                        </button>
                        <button
                          type="button"
                          className="link-btn bt-link"
                          disabled={disabled}
                          aria-label={`Ta bort ${w.name}`}
                          onClick={() => change({ ...rules, windows: rules.windows.filter((x) => x.id !== w.id) })}
                        >
                          Ta bort
                        </button>
                      </span>
                    )}
                  </div>
                  {open === w.id && (
                    <fieldset className="special-day-add" disabled={disabled}>
                      <legend className="form-section-label">{w.name || 'Specialtid'}</legend>
                      <div className="form-grid">
                        <div className="form-field">
                          <label htmlFor={`bt-name-${w.id}`}>Namn (visas för gästen)</label>
                          <input
                            id={`bt-name-${w.id}`}
                            maxLength={NAME_MAX}
                            value={w.name}
                            onChange={(e) => setWindow(w.id, { name: e.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor={`bt-len-${w.id}`}>Längd</label>
                          <MinutesSelect
                            id={`bt-len-${w.id}`}
                            value={w.durationMinutes}
                            options={DURATION_OPTIONS}
                            onChange={(m) => setWindow(w.id, { durationMinutes: m })}
                          />
                        </div>
                      </div>
                      <div className="form-field">
                        <span className="form-section-label" id={`bt-days-${w.id}`}>
                          Veckodagar
                        </span>
                        <div className="bt-days" role="group" aria-labelledby={`bt-days-${w.id}`}>
                          {WEEKDAYS.map((d) => (
                            <label key={d} className={`bt-day${w.weekdays.includes(d) ? ' on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={w.weekdays.includes(d)}
                                onChange={(e) =>
                                  setWindow(w.id, {
                                    weekdays: e.target.checked ? [...w.weekdays, d] : w.weekdays.filter((x) => x !== d),
                                  })
                                }
                              />
                              {WEEKDAY_SHORT[d]}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="form-grid">
                        <div className="form-field">
                          <label htmlFor={`bt-start-${w.id}`}>Starttider från</label>
                          <TimeInput
                            id={`bt-start-${w.id}`}
                            step={900}
                            value={w.startTime}
                            onChange={(e) => setWindow(w.id, { startTime: e.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor={`bt-end-${w.id}`}>till (inte med)</label>
                          <TimeInput
                            id={`bt-end-${w.id}`}
                            step={900}
                            value={w.endTime}
                            onChange={(e) => setWindow(w.id, { endTime: e.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor={`bt-from-${w.id}`}>Från datum (valfritt)</label>
                          <DateInput
                            id={`bt-from-${w.id}`}
                            value={w.dateFrom ?? ''}
                            onChange={(e) => setWindow(w.id, { dateFrom: e.target.value || undefined })}
                          />
                        </div>
                        <div className="form-field">
                          <label htmlFor={`bt-to-${w.id}`}>Till datum (valfritt)</label>
                          <DateInput
                            id={`bt-to-${w.id}`}
                            value={w.dateTo ?? ''}
                            onChange={(e) => setWindow(w.id, { dateTo: e.target.value || undefined })}
                          />
                        </div>
                      </div>
                      <ExtensionFields
                        id={`bt-ext-${w.id}`}
                        value={w.extension}
                        label="Kan förlängas"
                        onChange={(extension) => setWindow(w.id, { extension })}
                      />
                      <div className="form-field bt-priority">
                        <span className="form-field-label-row">
                          <label htmlFor={`bt-prio-${w.id}`}>Prioritet</label>
                          <InfoTooltip label="Prioritet">
                            Om två specialtider överlappar gäller den med datum först, sedan den med högst prioritet.
                          </InfoTooltip>
                        </span>
                        <input
                          id={`bt-prio-${w.id}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={100}
                          value={w.priority}
                          onChange={(e) => setWindow(w.id, { priority: Math.trunc(Number(e.target.value) || 0) })}
                        />
                      </div>
                    </fieldset>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isOwner && rules.windows.length < MAX_WINDOWS && (
            <button type="button" className="btn outline square bt-add" disabled={disabled} onClick={addWindow}>
              + Lägg till specialtid
            </button>
          )}
          {warnings.length > 0 && (
            <ul className="bt-warnings" role="status">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {isOwner ? (
            <span className="row-actions">
              <button type="submit" className="btn primary square" disabled={disabled}>
                {busy ? 'Sparar…' : 'Spara bokningstid'}
              </button>
              {notice && !dirty && (
                <span className="save-notice" role="status">
                  {notice}
                </span>
              )}
              {dirty && !busy && !legacy && (
                <span className="form-error" role="status">
                  Ej sparat - klicka Spara bokningstid.
                </span>
              )}
            </span>
          ) : (
            <p className="cell-muted">Bara restaurangens ägare kan ändra bokningstiden.</p>
          )}
        </form>
      )}
    </section>
  )
}
