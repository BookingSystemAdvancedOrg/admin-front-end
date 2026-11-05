import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { bookedByPhone } from './callBadgeCache'

/** Bokningar > bokningsraden: "Bokad via telefon", länk till utskriften. */
export default function CallBadge({ locationId, reservationId }: { locationId: string; reservationId: string }) {
  const [callId, setCallId] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void bookedByPhone(locationId).then((m) => { if (alive) setCallId(m.get(reservationId) ?? null) })
    return () => { alive = false }
  }, [locationId, reservationId])
  if (!callId) return null
  return <Link className="status-badge" to={`/telefon/samtal/${encodeURIComponent(callId)}`}>Bokad via telefon</Link>
}
