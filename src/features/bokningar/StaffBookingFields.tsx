import type { ReactNode } from 'react'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { isSmsLimitText } from './bookingsApi'
import type { StaffChannel } from './ChannelPicker'

/**
 * Telefonfältet när personalen bokar (Bokningar och bordskartan): Telefon
 * kräver numret (kortlänken går dit), Drop-in gör det inte. `error` är
 * fältets egen regel eller serverns svar (phoneFieldError). `label` skrivs i
 * varje formulär som fast text (Telefon eller Telefon (valfritt)), så att
 * hjälpens korpus (scripts/help-corpus.mjs) hittar fältet på båda sidorna.
 */
export function StaffPhoneField({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
}: {
  id: string
  label: ReactNode
  value: string
  error: string | null
  onChange: (value: string) => void
  onBlur: () => void
}) {
  // Taket för sms gäller inte numret: fältet markeras inte som fel.
  const invalid = Boolean(error) && !isSmsLimitText(error)
  return (
    <div className="form-field">
      {label}
      <input
        id={id}
        type="tel"
        inputMode="tel"
        // Inte "tel": webbläsaren skulle föreslå personalens eget nummer.
        autoComplete="off"
        placeholder="070-123 45 67"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="field-hint error">
          {error}
        </p>
      )}
    </div>
  )
}

/** Skicka bekräftelse till gästen. En telefonbokning med kortlänk får alltid sin. */
export function NotifyGuestCheck({
  channel,
  checked,
  onChange,
}: {
  channel: StaffChannel
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="check-row-info">
      <label className="check-row">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        Skicka bekräftelse till gästen
      </label>
      {channel === 'phone' && (
        <InfoTooltip label="Bekräftelse">
          En bokning med kortlänk får alltid sin bekräftelse när kortet är sparat.
        </InfoTooltip>
      )}
    </div>
  )
}
