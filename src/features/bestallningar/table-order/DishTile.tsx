import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../shared/Icon'
import { kronor } from '../ordersApi'
import { menuImageUrl } from '../../meny/menuApi'
import { needsOptions } from './cart'
import type { TabMenu, TabMenuItem } from './types'

const LONG_PRESS_MS = 480

/**
 * One dish. The first tap chooses it: one in the order and the tile marked
 * (dishes with a required choice open the choice first). From then on a
 * minus, count, plus stepper changes the amount; tapping the tile again adds
 * nothing, it only nudges the stepper. Minus at one takes the dish out and
 * the tile goes back to unchosen. Long press or the "..." corner opens the
 * editor (options, note, allergy, course). On phones the tile is a 64 px row.
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
  const mainRef = useRef<HTMLButtonElement>(null)
  const [nudge, setNudge] = useState(0)
  const chosen = count > 0
  const kind = station?.kind ?? (item.course === 'drinks' ? 'dryck' : 'kok')
  const stationName = station?.name ?? item.stationName

  useEffect(() => {
    if (!nudge) return
    const id = window.setTimeout(() => setNudge(0), 520)
    return () => window.clearTimeout(id)
  }, [nudge])

  function clear() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <div className={`to-tile${chosen ? ' has-count' : ''}${nudge ? ' is-nudge' : ''}`} data-dish={item.menuItemId}>
      <button
        ref={mainRef}
        type="button"
        className="to-tile-main"
        aria-label={`${item.name}, ${kronor(item.price)}${needsOptions(item) ? ', välj tillval' : ''}${chosen ? `, vald, ${count} st` : ''}`}
        aria-pressed={chosen}
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
          if (chosen) setNudge((n) => n + 1)
          else onAdd()
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
        {!chosen && (
          <span className="to-tile-plus" aria-hidden="true">
            <Icon name="plus" size={20} />
          </span>
        )}
      </button>
      {chosen && (
        <div className="to-tstep" role="group" aria-label={`${item.name}, antal`}>
          <button type="button" className="to-tstep-btn" aria-label="Ta bort en" onClick={() => {
            // the last one out: the stepper goes away, keep the keyboard on the tile
            if (count === 1) mainRef.current?.focus()
            onRemoveOne()
          }}>
            <Icon name="minus" size={18} />
          </button>
          <output className="to-tstep-count" aria-live="polite" aria-atomic="true">
            {count}
            <span className="sr-only"> st</span>
          </output>
          <button type="button" className="to-tstep-btn" aria-label="Lägg till en" onClick={onAdd}>
            <Icon name="plus" size={18} />
          </button>
        </div>
      )}
      <button type="button" className="to-tile-more" aria-label={`Ändra ${item.name}: tillval, notering, rätt`} onClick={onEdit}>
        <Icon name="more" size={18} />
      </button>
    </div>
  )
}
