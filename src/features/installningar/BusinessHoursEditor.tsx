import { WEEKDAYS } from './locationApi'
import type { BusinessHours, BusinessHoursInterval, Weekday } from './locationApi'

const DAY_LABEL: Record<Weekday, string> = {
  monday: 'Måndag',
  tuesday: 'Tisdag',
  wednesday: 'Onsdag',
  thursday: 'Torsdag',
  friday: 'Fredag',
  saturday: 'Lördag',
  sunday: 'Söndag',
}

/**
 * Redigerbara öppettider per veckodag, en-till-en mot Location-schemat
 * businessHours (alla sju dagar, 0+ tidsintervall per dag - tom lista = stängt).
 */
export function BusinessHoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: BusinessHours
  onChange: (next: BusinessHours) => void
  disabled?: boolean
}) {
  function updateDay(day: Weekday, intervals: BusinessHoursInterval[]) {
    onChange({ ...value, [day]: intervals })
  }

  function addInterval(day: Weekday) {
    updateDay(day, [...value[day], { opensAt: '11:00', closesAt: '22:00' }])
  }

  function removeInterval(day: Weekday, index: number) {
    updateDay(
      day,
      value[day].filter((_, i) => i !== index),
    )
  }

  function updateInterval(
    day: Weekday,
    index: number,
    field: keyof BusinessHoursInterval,
    time: string,
  ) {
    updateDay(
      day,
      value[day].map((interval, i) =>
        i === index ? { ...interval, [field]: time } : interval,
      ),
    )
  }

  return (
    <div className="hours-editor">
      {WEEKDAYS.map((day) => (
        <div key={day} className="hours-editor-row">
          <strong className="hours-editor-day">{DAY_LABEL[day]}</strong>
          <div className="hours-editor-intervals">
            {value[day].length === 0 && (
              <span className="cell-muted">Stängt</span>
            )}
            {value[day].map((interval, index) => (
              <span key={index} className="hours-editor-interval">
                <input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} öppnar`}
                  value={interval.opensAt}
                  disabled={disabled}
                  onChange={(e) =>
                    updateInterval(day, index, 'opensAt', e.target.value)
                  }
                />
                <span aria-hidden="true">–</span>
                <input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} stänger`}
                  value={interval.closesAt}
                  disabled={disabled}
                  onChange={(e) =>
                    updateInterval(day, index, 'closesAt', e.target.value)
                  }
                />
                {!disabled && (
                  <button
                    type="button"
                    className="link-action danger"
                    aria-label={`Ta bort tid för ${DAY_LABEL[day]}`}
                    onClick={() => removeInterval(day, index)}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {!disabled && (
              <button
                type="button"
                className="link-action"
                onClick={() => addInterval(day)}
              >
                + Lägg till tid
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
