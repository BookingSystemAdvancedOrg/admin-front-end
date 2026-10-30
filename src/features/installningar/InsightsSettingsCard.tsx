import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { replaceTenant, updateTenant } from '../../shared/tenant'
import type { Tenant, TenantInsightsSettings } from '../../shared/tenant'
import { clearInsightsCache } from '../statistik/insightsApi'
import { getLocation, updateLocation } from './locationApi'

/**
 * Statistik: vad personalen får se och var lunchen slutar.
 *
 *  - Personalen ser antingen driftsiffrorna för sin egen plats (gäster,
 *    beläggning, uteblivna, beställningar, rätter) utan några belopp, eller
 *    ingenting. Ägaren ser alltid allt. Servern tar bort beloppen, inte bara
 *    sidan.
 *  - Lunch är bokningar och beställningar före den valda timmen, resten är
 *    middag. Gäller den valda platsen och alla tidigare dagar direkt.
 */

const LUNCH_HOURS = ['14:00', '15:00', '16:00', '17:00']
const DEFAULT_LUNCH = '15:00'

export function InsightsSettingsCard({ tenant, locationId }: { tenant: Tenant; locationId: string | null }) {
  const savedAccess: TenantInsightsSettings['staffAccess'] = tenant.insights?.staffAccess ?? 'operations'
  const [access, setAccess] = useState(savedAccess)
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

  const dirty = access !== savedAccess || (lunch !== null && lunch !== savedLunch)

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (access !== savedAccess) {
        replaceTenant(await updateTenant({ insights: { staffAccess: access } }))
      }
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
      <h2 className="card-title">Statistik</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">Du ser alltid alla siffror. Här väljer du vad personalen ser och hur dagen delas i lunch och middag.</p>
      <div style={{ height: 16 }} />
      <form onSubmit={save} className="notifications-form">
        <div className="toggle-row">
          <div>
            <p className="toggle-row-label" id="insights-staff-label">
              Personalen ser statistik
            </p>
            <p className="cell-muted">
              Gäster, beläggning, uteblivna, beställningar och rätter för sin egen plats. Aldrig omsättning, avgifter eller
              andra belopp.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={access === 'operations'}
            aria-labelledby="insights-staff-label"
            className="switch"
            disabled={busy}
            onClick={() => {
              setAccess((a) => (a === 'operations' ? 'none' : 'operations'))
              setNotice(null)
            }}
          />
        </div>

        {locationId && (
          <div className="form-field">
            <label htmlFor="insights-lunch">Lunchen slutar</label>
            <select
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
            </select>
            <p className="cell-muted">Bokningar och beställningar före klockan {lunch ?? DEFAULT_LUNCH} räknas som lunch, resten som middag.</p>
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
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
