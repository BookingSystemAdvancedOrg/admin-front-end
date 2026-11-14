import { useState } from 'react'
import { RowActions } from '../../shared/RowActions'
import { Num } from '../../shared/motion/Num'
import { Slot } from '../../shared/slots'
import { Icon } from '../../shared/Icon'
import type { Dish } from './data'
import { dishStatus, dishStatusLabel } from './schedule'
import type { DishStatus } from './schedule'
import { focusPosition } from './imageFocus'
import { isRowOpenKey, shouldOpenRow } from './rowClick'

const STATUS_BADGE: Record<DishStatus, string> = {
  active: 'reserved',
  scheduled: 'arrived',
  expired: 'waiting',
  off: 'cancelled-free',
}

/**
 * Rättens bild med platshållare som reserv. Bild-URL:en byggs från
 * VITE_MENU_IMAGE_BASE_URL + imageKey; pekar basen fel (eller saknas
 * CDN-regeln) svarar CDN:et med HTML och webbläsaren hade visat en trasig
 * ikon - då är platshållaren ärligare, och felet syns i nätverksfliken.
 * Med en bild är den en knapp som visar bilden i stort.
 */
function DishThumb({ dish, onPreview }: { dish: Dish; onPreview: (dish: Dish) => void }) {
  const [failed, setFailed] = useState(false)
  if (!dish.image || failed) {
    return (
      <span className="dish-placeholder" aria-hidden="true">
        <Icon name="dish" size={22} />
      </span>
    )
  }
  return (
    <button
      type="button"
      className="dish-thumb"
      aria-label={`Visa bilden på ${dish.name}`}
      title="Visa bilden"
      data-help="meny:visa-bild"
      onClick={() => onPreview(dish)}
    >
      <img
        className="dish-photo"
        src={dish.image}
        alt={dish.name}
        style={{ objectPosition: focusPosition(dish.imageFocus) }}
        onError={() => setFailed(true)}
      />
    </button>
  )
}

/**
 * En rad i menylistan. Hela raden öppnar redigeringen (som Redigera), med
 * tangentbordet också (Tab till raden, Enter). Reglaget, knapparna och
 * bilden gör bara sitt eget: vilket klick som räknas avgörs av
 * shouldOpenRow, så inga knappar ligger inuti andra knappar.
 */
export function DishRow({
  dish,
  index,
  now,
  timeZone,
  canEdit,
  busy,
  locationId,
  onOpen,
  onToggle,
  onDelete,
  onPreview,
  categoryLabel,
  categoryTone = -1,
}: {
  dish: Dish
  /** Kategorins namn (platsens egna kategorier). */
  categoryLabel: string
  /** Kategorins plats i listan, för färgen; -1 = neutral. */
  categoryTone?: number
  index: number
  now: Date
  timeZone: string
  canEdit: boolean
  busy: boolean
  locationId: string | null
  onOpen: (dish: Dish) => void
  onToggle: (dish: Dish) => void
  onDelete: (dish: Dish) => void
  onPreview: (dish: Dish) => void
}) {
  const status = dishStatus(dish, now)
  return (
    <tr
      className={canEdit ? 'dish-row' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      aria-label={canEdit ? `${dish.name}, öppna för att redigera` : undefined}
      data-help={index === 0 ? 'meny:rad' : undefined}
      onClick={(e) => {
        if (canEdit && !busy && shouldOpenRow(e.target, e.currentTarget)) onOpen(dish)
      }}
      onKeyDown={(e) => {
        if (canEdit && !busy && isRowOpenKey(e)) {
          e.preventDefault()
          onOpen(dish)
        }
      }}
    >
      <td className="dish-cell-image">
        <DishThumb dish={dish} onPreview={onPreview} />
      </td>
      <td className="cell-strong">
        {dish.name}
        {dish.description && <div className="cell-muted">{dish.description}</div>}
      </td>
      <td>
        <span className={`status-badge${categoryTone >= 0 ? ` cat-tone-${categoryTone % 4}` : ''}`}>{categoryLabel}</span>
      </td>
      <td className="cell-price">
        <Num>{`${dish.price} kr`}</Num>
      </td>
      <td>
        <span className="dish-status">
          <button
            type="button"
            role="switch"
            data-tour={index === 0 ? 'menu-row-toggle' : undefined}
            data-help="meny:status"
            aria-checked={dish.active}
            aria-label={`${dish.name} aktiv`}
            className="switch"
            disabled={!canEdit || busy}
            onClick={() => onToggle(dish)}
          />
          <span className={`status-badge ${STATUS_BADGE[status]}`}>{dishStatusLabel(dish, now, timeZone)}</span>
        </span>
      </td>
      <td className="right">
        <RowActions label="Åtgärder för rätten" tour={index === 0 ? 'menu-row-actions' : undefined}>
          <button
            type="button"
            className="link-action"
            disabled={!canEdit || busy}
            onClick={() => onOpen(dish)}
          >
            Redigera
          </button>
          <button
            type="button"
            className="link-action danger"
            disabled={!canEdit || busy}
            onClick={() => onDelete(dish)}
          >
            Radera
          </button>
          {locationId && <Slot id="meny.dish.share" props={{ locationId, menuItemId: dish.id }} />}
        </RowActions>
      </td>
    </tr>
  )
}
