import { errorText } from '../../shared/errors'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { REMINDER_HOURS, replaceTenant, updateTenant } from '../../shared/tenant'
import type { Tenant, TenantNotifications } from '../../shared/tenant'
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Select } from '../../shared/Select'
import { SaveBar } from '../../shared/SaveBar'

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
  // Det som gäller (efter en sparning: svaret, även innan tenant hunnit uppdateras).
  const [stored, setStored] = useState(() => ({ notifications: tenant.notifications ?? DEFAULTS, senderName: tenant.senderName ?? '' }))
  const saved = stored.notifications
  const [values, setValues] = useState<TenantNotifications>(saved)
  const [senderName, setSenderName] = useState(stored.senderName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [senderInvalid, setSenderInvalid] = useState(false)

  const senderTrimmed = senderName.trim()
  const dirty =
    values.sms !== saved.sms ||
    values.staffEmails !== saved.staffEmails ||
    values.reminderHours !== saved.reminderHours ||
    senderTrimmed !== stored.senderName

  function set<K extends keyof TenantNotifications>(key: K, value: TenantNotifications[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setNotice(null)
    setFailed(false)
  }

  function discard() {
    setValues(saved)
    setSenderName(stored.senderName)
    setError(null)
    setFailed(false)
    setSenderInvalid(false)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setFailed(false)
    setSenderInvalid(false)
    const senderProblem =
      senderTrimmed && !SENDER_NAME.test(senderTrimmed)
        ? 'Avsändarnamnet får ha högst 11 tecken: bokstäver a-z, siffror och mellanslag. Till exempel Bistro Nord.'
        : values.sms && !/[A-Za-z]/.test(senderTrimmed)
          ? 'Skriv ett avsändarnamn för SMS, till exempel Bistro Nord.'
          : null
    if (senderProblem) {
      setError(senderProblem)
      setSenderInvalid(true)
      setFailed(true)
      return
    }
    setBusy(true)
    try {
      const updated = await updateTenant({
        notifications: values,
        senderName: senderTrimmed || null,
      })
      replaceTenant(updated)
      setStored({ notifications: updated.notifications, senderName: updated.senderName ?? '' })
      setValues(updated.notifications)
      setSenderName(updated.senderName ?? '')
      setNotice('Sparat.')
    } catch (err) {
      setError(errorText(err, 'Notiserna sparades inte.', { owner_only: 'Bara restaurangens ägare kan ändra notiser. Be ägaren göra det.', forbidden: 'Bara restaurangens ägare kan ändra notiser. Be ägaren göra det.' }))
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const disabled = !isOwner || busy

  return (
    <section id="notiser" className="admin-card table-card">
      <TitleInfo
        title="Notiser"
        info="Gäster får alltid bokningsbekräftelse per e-post med en länk för att se eller avboka, och besked om ni ändrar eller avbokar."
      />
      <div style={{ height: 16 }} />
      <form onSubmit={save} className="notifications-form">
        <div className="toggle-row">
          <div>
            <div className="title-info">
              <p className="toggle-row-label" id="notif-sms-label">SMS till gästen</p>
              <InfoTooltip label="SMS till gästen">
                Bekräftelse och påminnelse även som SMS. Ingår i priset. Skickas till nordiska nummer
                (+46, +45, +47, +358, +354), andra gäster får e-posten.
              </InfoTooltip>
            </div>
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
            aria-invalid={senderInvalid || undefined}
            onChange={(e) => {
              setSenderName(e.target.value)
              setNotice(null)
              setFailed(false)
              setSenderInvalid(false)
            }}
          />
        </div>

        <div className="form-field">
          <label htmlFor="notif-reminder">Påminnelse före besöket</label>
          <Select
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
          </Select>
        </div>

        <div className="toggle-row">
          <div>
            <p className="toggle-row-label" id="notif-staff-label">E-post till restaurangen</p>
            <p className="cell-muted">Ny bokning och avbokning</p>
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
          <ErrorNote text={error} />
        )}
        {isOwner && (
          <SaveBar
            dirty={dirty}
            busy={busy}
            label="Spara notiser"
            notice={notice}
            failed={failed}
            onDiscard={discard}
          />
        )}
        {!isOwner && <p className="cell-muted">Bara ägaren kan ändra.</p>}
      </form>
    </section>
  )
}
