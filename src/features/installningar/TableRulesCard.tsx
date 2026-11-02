import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTables } from '../../shared/tables'
import { getLocation, updateLocation } from './locationApi'
import type { TableCombination, TableRule } from './locationApi'
import {
  MAX_COMBINATION,
  MAX_PARTY,
  MIN_COMBINATION,
  rowsFor,
  rulesToSave,
  whole,
} from './bookingRules'
import type { ComboDraft, RowState } from './bookingRules'
import '../bokningar/bokningar.css'
import { SkelRows } from '../../shared/Skeleton'

/**
 * Bord vid onlinebokning för den valda platsen (backend shared/booking_rules.py).
 *
 * Gästerna väljer själva bord på planritningen, men bara bord som passar
 * sällskapet: varje bord har ett spann (antal personer) och kan stängas för
 * onlinebokning. Utan egen regel erbjuds ett bord sällskap från halva
 * platserna (avrundat uppåt) till alla - en ensam gäst kan inte ta
 * tiobordet. Kombinationer är bord gästerna får boka tillsammans, med eget
 * spann. Personalen kan alltid boka och kombinera alla bord.
 *
 * Borden kommer från den gällande publicerade planritningen. Bara regler
 * som skiljer sig från standard sparas, så ändras ett bords platser i
 * ritningen följer standardspannet med.
 */

export function TableRulesCard({
  locationId,
  isOwner,
}: {
  locationId: string | null
  isOwner: boolean
}) {
  const { tables, labels, error: tablesError } = useTables(locationId)
  const [saved, setSaved] = useState<{
    rules: Record<string, TableRule>
    combos: TableCombination[]
  } | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [combos, setCombos] = useState<TableCombination[]>([])
  const [draft, setDraft] = useState<ComboDraft>({ tableIds: [], min: '', max: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved({ rules: loc.tableRules ?? {}, combos: loc.tableCombinations ?? [] })
        setCombos(loc.tableCombinations ?? [])
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta platsens bordsregler.')))
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Raderna byggs när både bord och sparade regler finns (och om efter sparning).
  const savedKey = saved ? JSON.stringify(saved.rules) : null
  const tablesKey = tables ? JSON.stringify(tables) : null
  const [rowsBuiltFor, setRowsBuiltFor] = useState<string | null>(null)
  const rowsKey = savedKey !== null && tablesKey !== null ? `${tablesKey}|${savedKey}` : null
  if (rowsKey !== null && rowsKey !== rowsBuiltFor && tables && saved) {
    setRowsBuiltFor(rowsKey)
    setRows(rowsFor(tables, saved.rules))
  }

  const name = (id: string) => (labels ? (labels.get(id) ?? '?') : id)
  const seatsOf = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (tables?.find((t) => t.tableId === id)?.seats ?? 0), 0)
  const ready = Boolean(tables && saved)
  const disabled = !isOwner || busy || !ready

  const computed = tables ? rulesToSave(tables, rows) : { rules: {}, error: null }
  const dirty =
    ready &&
    (JSON.stringify(computed.rules) !== JSON.stringify(saved?.rules ?? {}) ||
      JSON.stringify(combos) !== JSON.stringify(saved?.combos ?? []))

  function setRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setNotice(null)
  }

  function toggleDraftTable(id: string) {
    setDraft((d) => ({
      ...d,
      tableIds: d.tableIds.includes(id) ? d.tableIds.filter((t) => t !== id) : [...d.tableIds, id],
    }))
    setError(null)
  }

  function addCombination() {
    const ids = [...draft.tableIds].sort()
    const min = whole(draft.min)
    const max = whole(draft.max)
    const seats = seatsOf(ids)
    if (ids.length < MIN_COMBINATION || ids.length > MAX_COMBINATION) {
      return setError(`Välj ${MIN_COMBINATION}-${MAX_COMBINATION} bord för en kombination.`)
    }
    if (min === null || max === null || min < 1 || max > MAX_PARTY || min > max) {
      return setError('Kombinationen: ange antal personer från och till (heltal, från ≤ till).')
    }
    if (max > seats) return setError(`Kombinationen har ${seats} platser - högst ${seats} personer.`)
    if (combos.some((c) => c.tableIds.join() === ids.join())) {
      return setError('Den kombinationen finns redan.')
    }
    setCombos((prev) =>
      [...prev, { tableIds: ids, minParty: min, maxParty: max }].sort((a, b) =>
        a.tableIds.join().localeCompare(b.tableIds.join()),
      ),
    )
    setDraft({ tableIds: [], min: '', max: '' })
    setError(null)
    setNotice(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId || !tables) return
    setError(null)
    setNotice(null)
    if (computed.error) return setError(computed.error)
    setBusy(true)
    try {
      const updated = await updateLocation(locationId, {
        tableRules: Object.keys(computed.rules).length ? computed.rules : null,
        tableCombinations: combos.length ? combos : null,
      })
      setSaved({ rules: updated.tableRules ?? {}, combos: updated.tableCombinations ?? [] })
      setCombos(updated.tableCombinations ?? [])
      setNotice('Sparat. Gäller bokningssidan direkt.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.', { owner_only: 'Bara restaurangens ägare kan ändra bordsreglerna.', forbidden: 'Bara restaurangens ägare kan ändra bordsreglerna.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="bord-online" className="admin-card table-card">
      <h2 className="card-title">Bord vid onlinebokning</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">
        Gästerna väljer bord på planritningen, men bara bord som passar sällskapet. Personalen kan
        alltid boka och kombinera alla bord.
      </p>
      <div style={{ height: 16 }} />
      {!locationId ? (
        <p className="cell-muted">Välj en plats först.</p>
      ) : tablesError ? (
        <p className="form-error" role="alert">
          Kunde inte hämta planritningen.
        </p>
      ) : !tables || !saved ? (
        <SkelRows n={3} cols={3} />
      ) : tables.length === 0 ? (
        <p className="cell-muted">Publicera en planritning med bord först (Planritning).</p>
      ) : (
        <form onSubmit={save} className="notifications-form">
          <div className="table-scroll">
            <table className="data-table rules-table">
              <thead>
                <tr>
                  <th>Bord</th>
                  <th>Platser</th>
                  <th>Online</th>
                  <th>Från (pers)</th>
                  <th>Till (pers)</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => {
                  const row = rows[t.tableId] ?? { online: true, min: '', max: '' }
                  return (
                    <tr key={t.tableId}>
                      <td className="cell-strong">Bord {t.label}</td>
                      <td>{t.seats}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Bord ${t.label} bokas online`}
                          checked={row.online}
                          disabled={disabled}
                          onChange={(e) => setRow(t.tableId, { online: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className="rules-number"
                          inputMode="numeric"
                          aria-label={`Bord ${t.label} från antal personer`}
                          value={row.min}
                          disabled={disabled || !row.online}
                          onChange={(e) => setRow(t.tableId, { min: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="rules-number"
                          inputMode="numeric"
                          aria-label={`Bord ${t.label} till antal personer`}
                          value={row.max}
                          disabled={disabled || !row.online}
                          onChange={(e) => setRow(t.tableId, { max: e.target.value })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="form-section-label">Kombinationer</p>
          <p className="cell-muted">
            Bord som gästerna får boka tillsammans, t.ex. två fyrabord för 5-8 personer. Utan
            kombinationer bokar gästerna ett bord per bokning.
          </p>
          {combos.length > 0 && (
            <ul className="combo-list">
              {combos.map((c) => {
                const missing = c.tableIds.some((id) => !labels?.has(id))
                return (
                  <li key={c.tableIds.join()}>
                    <span>
                      <span className="cell-strong">Bord {c.tableIds.map(name).join(' + ')}</span>
                      <span className="cell-muted">
                        {' '}
                        · {seatsOf(c.tableIds)} pl · {c.minParty}-{c.maxParty} pers
                      </span>
                      {missing && (
                        <span className="form-error">
                          {' '}
                          - ett bord finns inte i planritningen, kombinationen erbjuds inte
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={disabled}
                      onClick={() => {
                        setCombos((prev) => prev.filter((p) => p !== c))
                        setNotice(null)
                      }}
                    >
                      Ta bort
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <fieldset className="combo-add" disabled={disabled}>
            <legend className="form-section-label">Ny kombination</legend>
            <div className="table-chips">
              {tables.map((t) => (
                <label
                  key={t.tableId}
                  className={`table-chip${draft.tableIds.includes(t.tableId) ? ' selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={draft.tableIds.includes(t.tableId)}
                    onChange={() => toggleDraftTable(t.tableId)}
                  />
                  Bord {t.label}
                  <span className="cell-muted"> · {t.seats} pl</span>
                </label>
              ))}
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="combo-min">Från (pers)</label>
                <input
                  id="combo-min"
                  inputMode="numeric"
                  value={draft.min}
                  onChange={(e) => setDraft((d) => ({ ...d, min: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <label htmlFor="combo-max">Till (pers)</label>
                <input
                  id="combo-max"
                  inputMode="numeric"
                  value={draft.max}
                  onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))}
                />
              </div>
            </div>
            <button type="button" className="btn outline square" onClick={addCombination}>
              Lägg till kombination
            </button>
          </fieldset>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {isOwner && (
            <span className="row-actions">
              <button type="submit" className="btn primary square" disabled={disabled}>
                {busy ? 'Sparar…' : 'Spara bordsregler'}
              </button>
              {notice && !dirty && (
                <span className="save-notice" role="status">
                  {notice}
                </span>
              )}
              {dirty && !busy && (
                <span className="form-error" role="status">
                  Ej sparat - klicka Spara bordsregler.
                </span>
              )}
            </span>
          )}
          {!isOwner && <p className="cell-muted">Bara restaurangens ägare kan ändra bordsreglerna.</p>}
        </form>
      )}
    </section>
  )
}
