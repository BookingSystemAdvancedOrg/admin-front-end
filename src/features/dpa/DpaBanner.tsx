import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTenant } from '../../shared/tenant'
import { dpaBlocksSite, dpaPending } from './dpaApi'
import './dpa.css'

/**
 * Remsa överst i admin när personuppgiftsbiträdesavtalet inte är godkänt.
 *
 * - Ny restaurang (inget godkänt än): ägaren och personalen ser att
 *   webbplatsen publiceras först när ägaren har godkänt. Går inte att stänga.
 * - Restaurang som redan är live: en påminnelse till ägaren, som kan
 *   skjutas upp under besöket. Webbplatsen påverkas aldrig.
 *
 * Visas inte på /avtal, där texten och knappen finns.
 */
export function DpaBanner() {
  const { tenant } = useTenant()
  const { pathname } = useLocation()
  const [later, setLater] = useState(false)

  if (!dpaPending(tenant) || pathname === '/avtal') return null
  const isOwner = tenant.role === 'owner_user'
  const blocking = dpaBlocksSite(tenant)
  if (!isOwner && !blocking) return null
  if (later && !blocking) return null

  const title = blocking
    ? 'Webbplatsen är inte publicerad än'
    : tenant.dpa.acceptedVersion
      ? 'Ny version av personuppgiftsbiträdesavtalet'
      : 'Godkänn personuppgiftsbiträdesavtalet'
  const text = blocking
    ? isOwner
      ? 'Godkänn personuppgiftsbiträdesavtalet så publiceras er webbplats och gästerna kan boka och beställa.'
      : 'Restaurangens ägare behöver godkänna personuppgiftsbiträdesavtalet innan webbplatsen publiceras.'
    : 'Avtalet beskriver hur Booqy behandlar era gästers personuppgifter för er räkning. Er webbplats påverkas inte.'

  return (
    <div className="dpa-banner-wrap">
      <section className={`dpa-banner${blocking ? ' dpa-banner--blocking' : ''}`} role="status">
        <div className="dpa-banner-text">
          <p className="dpa-banner-title">{title}</p>
          <p>{text}</p>
        </div>
        <div className="dpa-banner-actions">
          {!blocking && (
            <button type="button" className="btn outline square" onClick={() => setLater(true)}>
              Senare
            </button>
          )}
          <Link className="btn primary square" to="/avtal">
            {isOwner ? 'Läs och godkänn' : 'Läs avtalet'}
          </Link>
        </div>
      </section>
    </div>
  )
}
