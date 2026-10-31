/**
 * Medan statistiken hämtas: sidan står redan på plats, med suddiga glasrutor
 * där nyckeltalen, diagrammet och tabellerna kommer att ligga. Samma rutnät
 * och samma kort som den riktiga sidan, så ingenting hoppar när datan kommer.
 * Minska rörelse: rutorna andas inte.
 */
const BARS = [18, 30, 22, 46, 34, 58, 40, 70, 52, 38, 64, 48, 80, 56, 36, 44, 28, 62, 50, 34]

function Lines({ rows }: { rows: number }) {
  return (
    <div className="sk-lines">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-line-row">
          <span className="sk-block sk-w-40" />
          <span className="sk-block sk-w-15" />
          <span className="sk-block sk-w-15" />
        </div>
      ))}
    </div>
  )
}

export function OverviewSkeleton() {
  return (
    <div className="sk" role="status" aria-label="Hämtar statistiken">
      <section className="stats-row" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="admin-card stat-tile sk-tile" style={{ animationDelay: `${i * 120}ms` }}>
            <span className="sk-block sk-label" />
            <span className="sk-block sk-value" />
            <span className="sk-block sk-note" />
          </div>
        ))}
      </section>

      <section className="admin-card table-card" aria-hidden="true">
        <div className="card-head">
          <span className="sk-block sk-title" />
          <span className="sk-block sk-aside" />
        </div>
        <div className="sk-chart">
          {BARS.map((h, i) => (
            <span key={i} className="sk-block sk-bar" style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
        <div className="sk-legend">
          <span className="sk-block sk-w-12" />
          <span className="sk-block sk-w-25" />
          <span className="sk-block sk-w-18" />
        </div>
      </section>

      <div className="mk-two" aria-hidden="true">
        <section className="admin-card table-card">
          <div className="card-head">
            <span className="sk-block sk-title" />
          </div>
          <Lines rows={3} />
        </section>
        <section className="admin-card table-card">
          <div className="card-head">
            <span className="sk-block sk-title" />
            <span className="sk-block sk-aside sk-aside--short" />
          </div>
          <Lines rows={2} />
        </section>
      </div>
    </div>
  )
}
