import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import { REMINDER_HOURS, replaceTenant, updateTenant } from '../../shared/tenant'
import type { Tenant, TenantNotifications } from '../../shared/tenant'

/**
 * Notiser: vad gäster och restaurangen får när någon bokar.
 *
 * Gästen får alltid en bokningsbekräftelse per e-post (med länk för att se
 * eller avboka), besked om restaurangen ändrar eller avbokar, och en
 * påminnelse före besöket. Här väljer ägaren om SMS ska skickas också, när
 * påminnelsen går ut och om restaurangen själv ska få e-post om nya
 * onlinebokningar. Avsändarnamnet är det som står som avsändare i SMS:et.
 */

const SENDER_NAME = /^[A-Za-z0-9 ]{1,11}$/
// Ett API från före notiserna svarar utan fältet - samma standard som servern.
const DEFAULTS: TenantNotifications = { sms: false, staffEmails: true, reminderHours: 24 }

function hoursLabel(hours: number): string {
  if (hours === 0) return 'Ingen påminnelse'
  if (hours === 24) return '1 dygn före'
  if (hours === 48) return '2 dygn före'
  return `${hours} timmar före`
}

export function NotificationsCard({ tenant, isOwner }: { tenant: Tenant; isOwner: boolean }) {
  const saved = tenant.notifications ?? DEFAULTS
  const [values, setValues] = useState<TenantNotifications>(saved)
  const [senderName, setSenderName] = useState(tenant.senderName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const senderTrimmed = senderName.trim()
  const dirty =
    values.sms !== saved.sms ||
    values.staffEmails !== saved.staffEmails ||
    values.reminderHours !== saved.reminderHours ||
    senderTrimmed !== (tenant.senderName ?? '')

  function set<K extends keyof TenantNotifications>(key: K, value: TenantNotifications[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setNotice(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (senderTrimmed && !SENDER_NAME.test(senderTrimmed)) {
      setError('Avsändarnamnet får vara högst 11 tecken: bokstäver a–z, siffror och mellanslag.')
      return
    }
    if (values.sms && !/[A-Za-z]/.test(senderTrimmed)) {
      setError('Ange ett avsändarnamn (minst en bokstav) när SMS är på.')
      return
    }
    setBusy(true)
    try {
      const updated = await updateTenant({
        notifications: values,
        senderName: senderTrimmed || null,
      })
      replaceTenant(updated)
      setValues(updated.notifications)
      setSenderName(updated.senderName ?? '')
      setNotice('Sparat.')
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : err instanceof ApiError && err.status === 403
            ? 'Bara restaurangens ägare kan ändra notiser.'
            : 'Kunde inte spara just nu. Försök igen om en stund.',
      )
    } finally {
      setBusy(false)
    }
  }

  const disabled = !isOwner || busy

  return (
    <section id="notiser" className="admin-card table-card">
      <h2 className="card-title">Notiser</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">
        Gäster får alltid bokningsbekräftelse per e-post med en länk för att se eller avboka,
        och besked om ni ändrar eller avbokar.
      </p>
      <div style={{ height: 16 }} />
      <form onSubmit={save} className="notifications-form">
        <div className="toggle-row">
          <div>
            <p className="toggle-row-label" id="notif-sms-label">SMS till gästen</p>
            <p className="cell-muted">
              Bekräftelse och påminnelse även som SMS. Kostar per SMS. Skickas till nordiska nummer
              (+46, +45, +47, +358, +354) - andra gäster får e-posten.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={values.sms}
            aria-labelledby="notif-sms-label"
            className="switch"
            disabled={disabled}
            onClick={() => set('sms', !values.sms)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="notif-sender">Avsändarnamn i SMS</label>
          <input
            id="notif-sender"
            value={senderName}
            maxLength={11}
            placeholder="t.ex. Roma"
            disabled={disabled}
            onChange={(e) => {
              setSenderName(e.target.value)
              setNotice(null)
            }}
          />
        </div>

        <div className="form-field">
          <label htmlFor="notif-reminder">Påminnelse före besöket</label>
          <select
            id="notif-reminder"
            value={values.reminderHours}
            disabled={disabled}
            onChange={(e) => set('reminderHours', Number(e.target.value))}
          >
            {REMINDER_HOURS.map((h) => (
              <option key={h} value={h}>
                {hoursLabel(h)}
              </option>
            ))}
          </select>
        </div>

        <div className="toggle-row">
          <div>
            <p className="toggle-row-label" id="notif-staff-label">E-post till restaurangen</p>
            <p className="cell-muted">Vid ny onlinebokning och när en gäst avbokar.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={values.staffEmails}
            aria-labelledby="notif-staff-label"
            className="switch"
            disabled={disabled}
            onClick={() => set('staffEmails', !values.staffEmails)}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {isOwner && (
          <span className="row-actions">
            <button type="submit" className="btn primary square" disabled={busy || !dirty}>
              {busy ? 'Sparar…' : 'Spara notiser'}
            </button>
            {notice && (
              <span className="save-notice" role="status">
                {notice}
              </span>
            )}
          </span>
        )}
        {!isOwner && <p className="cell-muted">Bara restaurangens ägare kan ändra notiser.</p>}
      </form>
    </section>
  )
}
