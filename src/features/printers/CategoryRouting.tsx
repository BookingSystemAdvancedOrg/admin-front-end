import { useState } from 'react'
import { NO_TICKET, printErrorText, saveCategoryRouting } from '../bestallningar/printApi'
import type { Printer, TicketRouting } from '../bestallningar/printApi'
import type { MenuCategoryEntry } from '../meny/data'
import { ErrorNote } from '../../shared/ErrorNote'
import { categoryStation } from './kinds'
import { SendTo } from './SendTo'
import './printers.css'

/**
 * "Vad skickas vart?": varje menykategori med ett chip per skrivare.
 * Ett tryck sparar direkt (busy-strimman och klicket kommer av sig själva),
 * bongen flyger till skrivarens kort. Ett fel visar raden som den var.
 */
export function CategoryRouting({
  locationId,
  routing,
  categories,
  canEdit,
  onSaved,
}: {
  locationId: string
  routing: TicketRouting
  devices?: Printer[]
  categories: MenuCategoryEntry[]
  canEdit: boolean
  onSaved: (routing: TicketRouting) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})

  async function choose(categoryId: string, next: string) {
    setError(null)
    setPending((p) => ({ ...p, [categoryId]: next }))
    try {
      onSaved(await saveCategoryRouting(locationId, { [categoryId]: next }))
    } catch (err) {
      setError(printErrorText(err))
    } finally {
      setPending((p) => {
        const rest = { ...p }
        delete rest[categoryId]
        return rest
      })
    }
  }

  return (
    <div className="cat-routing">
      <ul className="cat-routing-list" aria-label="Kategorier">
        {categories.map((c) => {
          const value = pending[c.categoryId] ?? categoryStation(routing, c.categoryId, c.name) ?? NO_TICKET
          return (
            <li key={c.categoryId} className="cat-routing-row">
              <span className="cat-routing-name">{c.name}</span>
              <SendTo label={`${c.name} skickas till`} stations={routing.stations} value={value} compact
                disabled={!canEdit} onChange={(next) => void choose(c.categoryId, next)} />
            </li>
          )
        })}
      </ul>
      <ErrorNote text={error} />
    </div>
  )
}
