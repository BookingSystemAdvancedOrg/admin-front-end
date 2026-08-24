import { Link } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'

/**
 * Demo-data tills API:t är kopplat (se docs/API-OCH-NYCKLAR.md avsnitt 3 för
 * hur anrop autentiseras). Ersätt med fetch mot ert API.
 */
type BookingStatus = 'arrived' | 'reserved' | 'waiting' | 'cancelled'

// Svensk visningstext för varje status-badge i bokningslistan.
const STATUS_LABEL: Record<BookingStatus, string> = {
  arrived: 'Anlänt',
  reserved: 'Reserverad',
  waiting: 'Väntar',
  cancelled: 'Avbokad',
}

// Nyckeltalskorten högst upp på sidan.
const STATS = [
  { label: 'Bokningar idag', value: '12', note: '48 gäster totalt' },
  { label: 'Beläggning ikväll', value: '76%', note: '10 av 13 bord bokade' },
  {
    label: 'Obetalda avgifter',
    value: '2 st',
    note: '750 kr att driva in',
    danger: true,
  },
  { label: 'Nästa lediga tid', value: '20:30', note: 'för sällskap på 2–4' },
]

// Dagens bokningslista (vänsterkortet).
const TODAYS_BOOKINGS: {
  time: string
  name: string
  meta: string
  status: BookingStatus
}[] = [
  { time: '17:00', name: 'Familjen Öberg', meta: 'Bord 8 · 6 pers', status: 'arrived' },
  { time: '18:00', name: 'Klara Sandberg', meta: 'Bord 2 · 2 pers', status: 'reserved' },
  { time: '18:30', name: 'Erik Lindqvist', meta: 'Bord 3 · 2 pers', status: 'reserved' },
  { time: '19:00', name: 'Sofia Bergman', meta: 'Bord 8 · 6 pers', status: 'waiting' },
  { time: '19:30', name: 'Petter Malm', meta: 'Bord 11 · 4 pers', status: 'reserved' },
  { time: '20:00', name: 'Nina & Oskar', meta: 'Bord 6 · 4 pers', status: 'reserved' },
]

// Aktivitetsflödet (högerkortet).
const ACTIVITY: { text: string; time: string }[] = [
  { text: 'Sofia Bergman bokade Bord 8 för 6 personer', time: 'för 12 min sedan' },
  { text: 'Layout publicerad av Anna — version 4', time: 'för 2 timmar sedan' },
  { text: 'Betalningspåminnelse skickad till Maria Holm', time: 'igår, 14:20' },
  { text: 'Ny rätt tillagd: Smörstekt Torskrygg', time: 'igår, 11:05' },
  { text: 'Erik Lindqvist bekräftade bokning #KL-48213', time: 'igår, 09:40' },
]

// Genvägskorten längst ned som länkar till de andra sidorna.
const QUICK_LINKS = [
  { to: '/meny', icon: '🍽', label: 'Hantera meny' },
  { to: '/layout', icon: '📐', label: 'Redigera layout' },
  { to: '/bokningar', icon: '📅', label: 'Se alla bokningar' },
  { to: '/installningar', icon: '👥', label: 'Bjud in personal' },
]

/** Figma: admin-oversikt-page (36:165). */
export default function OversiktPage() {
  return (
    <>
      <AdminTopbar title="Översikt" />
      <div className="admin-main">
        <section className="stats-row" aria-label="Nyckeltal">
          {STATS.map((stat) => (
            <article key={stat.label} className="admin-card stat-tile">
              <p className="stat-tile-label">{stat.label}</p>
              <p
                className={
                  stat.danger ? 'stat-tile-value danger' : 'stat-tile-value'
                }
              >
                {stat.value}
              </p>
              <p className="stat-tile-note">{stat.note}</p>
            </article>
          ))}
        </section>

        <div className="oversikt-row">
          <section className="admin-card bookings-card" aria-label="Dagens bokningar">
            <div className="card-head">
              <h2 className="card-title">Dagens bokningar</h2>
              <Link className="card-link" to="/bokningar">
                Visa alla →
              </Link>
            </div>
            {TODAYS_BOOKINGS.map((b) => (
              <div key={`${b.time}-${b.name}`} className="booking-row">
                <div className="booking-left">
                  <span className="booking-time">{b.time}</span>
                  <span className="booking-name">{b.name}</span>
                </div>
                <div className="booking-right">
                  <span className="booking-meta">{b.meta}</span>
                  <span className={`status-badge ${b.status}`}>
                    {STATUS_LABEL[b.status]}
                  </span>
                </div>
              </div>
            ))}
          </section>

          <section className="admin-card activity-card" aria-label="Senaste aktivitet">
            <div className="card-head">
              <h2 className="card-title">Senaste aktivitet</h2>
            </div>
            {ACTIVITY.map((item) => (
              <div key={item.text} className="activity-item">
                <p className="activity-text">{item.text}</p>
                <p className="activity-time">{item.time}</p>
              </div>
            ))}
          </section>
        </div>

        <section className="quick-links-row" aria-label="Genvägar">
          {QUICK_LINKS.map((link) => (
            <Link key={link.to + link.label} className="admin-card quick-link" to={link.to}>
              <span className="quick-link-label">
                <span className="quick-link-icon" aria-hidden="true">
                  {link.icon}
                </span>
                {link.label}
              </span>
              <span className="quick-link-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </section>
      </div>
    </>
  )
}
