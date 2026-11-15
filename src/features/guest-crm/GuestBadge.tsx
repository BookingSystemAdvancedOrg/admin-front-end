import { useEffect, useState } from 'react'
import { lookupGuests } from './api'

interface Props {
  locationId: string
  reservationId: string
  email?: string
  phone?: string
}

type Result = { status: 'new' | 'returning'; visits: number }
type Waiter = { contact: { key: string; email?: string; phone?: string }; resolve: (r: Result | null) => void }

const BATCH_MS = 25
const MAX = 100
const queues = new Map<string, Waiter[]>()

/** Alla märken i samma bokningslista frågar i ett anrop (högst 100 åt gången). */
function ask(locationId: string, contact: Waiter['contact']): Promise<Result | null> {
  return new Promise((resolve) => {
    const queue = queues.get(locationId) ?? []
    if (queue.length === 0) setTimeout(() => void flush(locationId), BATCH_MS)
    queue.push({ contact, resolve })
    queues.set(locationId, queue)
  })
}

async function flush(locationId: string) {
  const all = queues.get(locationId) ?? []
  queues.delete(locationId)
  for (let i = 0; i < all.length; i += MAX) {
    const chunk = all.slice(i, i + MAX)
    try {
      const out = await lookupGuests(locationId, chunk.map((w) => w.contact))
      chunk.forEach((w) => w.resolve(out.results[w.contact.key] ?? null))
    } catch {
      chunk.forEach((w) => w.resolve(null)) // inget märke hellre än ett felaktigt
    }
  }
}

/** "Ny gäst" eller "Återkommande (4)" på en bokning. */
export default function GuestBadge({ locationId, reservationId, email, phone }: Props) {
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!email && !phone) return
    let cancelled = false
    ask(locationId, { key: reservationId, ...(email ? { email } : {}), ...(phone ? { phone } : {}) })
      .then((r) => { if (!cancelled) setResult(r) })
    return () => { cancelled = true }
  }, [locationId, reservationId, email, phone])

  if (!result) return null
  return (
    <span className="status-badge">
      {result.status === 'returning' ? `Återkommande (${result.visits})` : 'Ny gäst'}
    </span>
  )
}
