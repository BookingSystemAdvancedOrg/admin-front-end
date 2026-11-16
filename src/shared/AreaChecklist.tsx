import './access.css'
import type { Area, TickSource } from './access'
import { AREAS } from './access'
import { hasFeature } from './tenant'
import type { Tenant } from './tenant'

const SOURCE_TAG: Partial<Record<TickSource, string>> = {
  group: 'Gruppen',
  own: 'Extra',
  removed: 'Borttagen',
}

/**
 * Bockar per område (Inställningar > Behörigheter och en person i Personal).
 * Bara områden som ingår i planen visas. `source` ger en liten etikett per
 * rad: från gruppen, extra för personen eller gruppens men borttagen.
 */
export function AreaChecklist({
  tenant,
  idPrefix,
  checked,
  source,
  disabled,
  onChange,
}: {
  tenant: Pick<Tenant, 'entitlements'> | null
  idPrefix: string
  checked: (area: Area) => boolean
  source?: (area: Area) => TickSource
  disabled?: boolean
  onChange: (area: Area, on: boolean) => void
}) {
  const shown = AREAS.filter((a) => !a.feature || hasFeature(tenant, a.feature))
  return (
    <ul className="area-list">
      {shown.map(({ area, label }) => {
        const id = `${idPrefix}-${area}`
        const tag = source ? SOURCE_TAG[source(area)] : undefined
        return (
          <li key={area} className="area-row">
            <label htmlFor={id} className="area-check">
              <input
                id={id}
                type="checkbox"
                className="bq-check"
                checked={checked(area)}
                disabled={disabled}
                onChange={(e) => onChange(area, e.target.checked)}
              />
              <span>{label}</span>
            </label>
            {tag && <span className={`area-tag ${source?.(area)}`}>{tag}</span>}
          </li>
        )
      })}
    </ul>
  )
}
