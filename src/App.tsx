import { useState } from 'react'
import './App.css'
import { useAuth } from './auth/useAuth'

type Page = 'overview' | 'reservations' | 'locations' | 'menu' | 'staff'

const NAV: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'locations', label: 'Locations' },
  { id: 'menu', label: 'Menu' },
  { id: 'staff', label: 'Staff' },
]

const STATS = [
  { label: 'Today', value: '—' },
  { label: 'This week', value: '—' },
  { label: 'Open locations', value: '—' },
  { label: 'Pending', value: '—' },
]

function PageHeading({ title, body }: { title: string; body: string }) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      <p>{body}</p>
    </header>
  )
}

function App() {
  const [page, setPage] = useState<Page>('overview')
  const { email, logout } = useAuth()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Admin</strong>
            <span>Booking system</span>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {email && <span className="sidebar-user">{email}</span>}
          <button type="button" className="nav-item" onClick={logout}>
            Logga ut
          </button>
        </div>
      </aside>

      <main className="content">
        {page === 'overview' && (
          <>
            <PageHeading
              title="Overview"
              body="Staff dashboard for reservations, locations, and menus."
            />
            <section className="stats">
              {STATS.map((stat) => (
                <article key={stat.label} className="card">
                  <p>{stat.label}</p>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </section>
          </>
        )}

        {page === 'reservations' && (
          <>
            <PageHeading
              title="Reservations"
              body="Review and manage upcoming bookings once the API is connected."
            />
            <div className="card empty">No reservations loaded yet.</div>
          </>
        )}

        {page === 'locations' && (
          <>
            <PageHeading
              title="Locations"
              body="Manage venues and opening hours."
            />
            <div className="card empty">No locations loaded yet.</div>
          </>
        )}

        {page === 'menu' && (
          <>
            <PageHeading title="Menu" body="Edit items available for booking." />
            <div className="card empty">No menu loaded yet.</div>
          </>
        )}

        {page === 'staff' && (
          <>
            <PageHeading
              title="Staff"
              body="Invite and manage admin users."
            />
            <div className="card empty">No staff loaded yet.</div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
