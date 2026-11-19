import { useRef } from 'react'
import { Icon } from '../../../shared/Icon'
import { kronor } from '../ordersApi'
import { menuImageUrl } from '../../meny/menuApi'
import { needsOptions } from './cart'
import type { TabMenu, TabMenuItem } from './types'

const LONG_PRESS_MS = 480

/**
 * One dish: tap adds one (dishes with a required choice open the choice
 * first), long press or the "..." corner opens the editor (options, note,
 * allergy, course). The badge shows how many are in the order and "-"
 * takes one away. On phones the same tile is a 64 px row.
 */
export function DishTile({
  item,
  count,
  station,
  onAdd,
  onRemoveOne,
  onEdit,
}: {
  item: TabMenuItem
  count: number
  station: TabMenu['stations'][number] | undefined
  onAdd: () => void
  onRemoveOne: () => void
  onEdit: () => void
}) {
  const timer = useRef<number | null>(null)
  const longFired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const image = menuImageUrl(item.imageKey)
  const kind = station?.kind ?? (item.course === 'drinks' ? 'dryck' : 'kok')
  const stationName = station?.name ?? item.stationName

  function clear() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <div className={`to-tile${count > 0 ? ' has-count' : ''}`} data-dish={item.menuItemId}>
      <button
        type="button"
        className="to-tile-main"
        aria-label={`${item.name}, ${kronor(item.price)}${needsOptions(item) ? ', välj tillval' : ''}${count ? `, ${count} i beställningen` : ''}`}
        onPointerDown={(e) => {
          longFired.current = false
          start.current = { x: e.clientX, y: e.clientY }
          clear()
          timer.current = window.setTimeout(() => {
            longFired.current = true
            onEdit()
          }, LONG_PRESS_MS)
        }}
        onPointerMove={(e) => {
          if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear()
        }}
        onPointerUp={clear}
        onPointerCancel={clear}
        onPointerLeave={clear}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longFired.current) {
            longFired.current = false
            return
          }
          onAdd()
        }}
      >
        {image && <img className="to-tile-img" src={image} alt="" loading="lazy" decoding="async" />}
        <span className="to-tile-text">
          <span className="to-tile-name">{item.name}</span>
          <span className="to-tile-meta">
            <span className="to-tile-price">{kronor(item.price)}</span>
            {stationName && (
              <span className={`to-station to-station--${kind}`}>
                <Icon name={kind === 'dryck' ? 'glass' : kind === 'kok' ? 'tool-kitchen' : 'station'} size={14} />
                {stationName}
              </span>
            )}
            {item.allergens.length > 0 && (
              <span className="to-allergens" title={`Allergener: ${item.allergens.join(', ')}`}>
                <span className="sr-only">Allergener</span>
                <span className="sr-only">: {item.allergens.join(', ')}</span>
                <span aria-hidden="true">Allergener <strong>{item.allergens.length}</strong></span>
              </span>
            )}
            {needsOptions(item) && <span className="to-tile-choice">Välj</span>}
          </span>
        </span>
        <span className="to-tile-plus" aria-hidden="true">
          <Icon name="plus" size={20} />
        </span>
      </button>
      {count > 0 && (
        <>
          <span className="to-tile-count" aria-hidden="true">{count}</span>
          <button type="button" className="to-tile-minus" aria-label={`En ${item.name} mindre`} onClick={onRemoveOne}>
            <Icon name="minus" size={18} />
          </button>
        </>
      )}
      <button type="button" className="to-tile-more" aria-label={`Ändra ${item.name}: tillval, notering, rätt`} onClick={onEdit}>
        <Icon name="more" size={18} />
      </button>
    </div>
  )
}
