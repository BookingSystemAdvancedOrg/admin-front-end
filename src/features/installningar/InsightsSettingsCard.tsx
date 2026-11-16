import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { clearInsightsCache } from '../statistik/insightsApi'
import { getLocation, updateLocation } from './locationApi'
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { Select } from '../../shared/Select'

/**
 * Statistik: var lunchen slutar. Lunch är bokningar och beställningar före
 * den valda timmen, resten är middag. Gäller den valda platsen och alla
 * tidigare dagar direkt. Om personalen ser Statistik väljs under
 * Behörigheter (StaffAccessCard); de ser aldrig belopp.
 */

const LUNCH_HOURS = ['14:00', '15:00', '16:00', '17:00']
const DEFAULT_LUNCH = '15:00'

export function InsightsSettingsCard({ locationId }: { locationId: string | null }) {
  const [lunch, setLunch] = useState<string | null>(null)
  const [savedLunch, setSavedLunch] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        const value = loc.lunchUntil ?? DEFAULT_LUNCH
        setLunch(value)
        setSavedLunch(value)
      })
      .catch(() => {
        if (!cancelled) {
          setLunch(DEFAULT_LUNCH)
          setSavedLunch(DEFAULT_LUNCH)
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  const dirty = lunch !== null && lunch !== savedLunch

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (locationId && lunch !== null && lunch !== savedLunch) {
        const loc = await updateLocation(locationId, { lunchUntil: lunch === DEFAULT_LUNCH ? null : lunch })
        setSavedLunch(loc.lunchUntil ?? DEFAULT_LUNCH)
      }
      clearInsightsCache()
      setNotice('Sparat.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="statistik" className="admin-card table-card">
      <TitleInfo title="Statistik" info="Hur dagen delas i lunch och middag. Personalen ser aldrig belopp." />
      <div style={{ height: 16 }} />
      <form onSubmit={save} className="notifications-form">
        {locationId && (
          <div className="form-field">
            <label htmlFor="insights-lunch">Lunchen slutar</label>
            <Select
              id="insights-lunch"
              value={lunch ?? DEFAULT_LUNCH}
              disabled={busy || lunch === null}
              onChange={(e) => {
                setLunch(e.target.value)
                setNotice(null)
              }}
            >
              {LUNCH_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </div>
        )}

        {error && (
          <ErrorNote text={error} />
        )}
        <span className="row-actions">
          <button type="submit" className="btn primary square" disabled={busy || !dirty}>
            {busy ? 'Sparar…' : 'Spara'}
          </button>
          {notice && (
            <span className="save-notice" role="status">
              {notice}
            </span>
          )}
        </span>
      </form>
    </section>
  )
}
