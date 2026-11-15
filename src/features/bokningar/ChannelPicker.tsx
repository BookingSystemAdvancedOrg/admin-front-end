import { Icon } from '../../shared/Icon'

export type StaffChannel = 'phone' | 'walk_in'

const OPTIONS: { value: StaffChannel; label: string; hint: string; icon: 'phone' | 'users' }[] = [
  { value: 'phone', label: 'Telefon', hint: 'Gästen ringde', icon: 'phone' },
  { value: 'walk_in', label: 'Drop-in', hint: 'Gästen kom in', icon: 'users' },
]

/**
 * Hur gästen bokade, när personalen bokar: telefon eller drop-in. Sparas som
 * bokningens `source` (phone, walk_in) och räknas i Statistik under "Hur
 * gästerna bokar". Två stora knappar mitt i kortet, lätta att träffa i telefonen.
 */
export function ChannelPicker({
  value,
  onChange,
}: {
  value: StaffChannel
  onChange: (next: StaffChannel) => void
}) {
  return (
    <div className="channel-picker" role="radiogroup" aria-label="Typ av bokning">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          className={value === o.value ? 'channel-option active' : 'channel-option'}
          onClick={() => onChange(o.value)}
        >
          <Icon name={o.icon} size={22} />
          <span className="channel-option-text">
            <span className="channel-option-label">{o.label}</span>
            <span className="channel-option-hint" aria-hidden="true">{o.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
