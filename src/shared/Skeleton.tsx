import type { CSSProperties, ReactNode } from 'react'
import './skeleton.css'

/**
 * Medan en sida hämtar sin data: sidan står redan på plats, byggd av samma
 * kort och rutnät som den riktiga, med suddiga glasrutor där text, siffror
 * och rader kommer och ett långsamt glasskimmer över korten. När datan är här
 * hamnar den där användaren redan ser rutorna. Varje sida sätter ihop sitt
 * eget skelett av delarna här (gärna med sidans egna layoutklasser), så
 * ingenting hoppar. Minska rörelse: rutorna står still.
 */

type Size = number | string

/** En suddig glasruta. */
export function SkelBlock({ w = '100%', h = 14, round, className = '', style }: {
  w?: Size
  h?: Size
  round?: boolean
  className?: string
  style?: CSSProperties
}) {
  return <span className={`skel-block${round ? ' skel-round' : ''}${className ? ` ${className}` : ''}`} style={{ width: w, height: h, ...style }} />
}

/** Skimret som drar över ett kort. */
function Sheen() {
  return <i className="skel-sheen" aria-hidden="true" />
}

/** Ytterst: talar om för skärmläsare att sidan hämtas. */
export function SkelPage({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`skel${className ? ` ${className}` : ''}`} role="status" aria-label={label} aria-busy="true">
      {children}
    </div>
  )
}

/** Rubrikraden i ett kort: titel och ev. en kort text till höger. */
export function SkelHead({ aside = true }: { aside?: boolean }) {
  return (
    <div className="card-head">
      <SkelBlock w="38%" h={22} style={{ maxWidth: 220 }} />
      {aside && <SkelBlock w={120} h={14} />}
    </div>
  )
}

/** Tabellrader: en bred kolumn och några smala. */
export function SkelRows({ n = 4, cols = 3 }: { n?: number; cols?: number }) {
  return (
    <div className="skel-rows">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-row">
          <SkelBlock w="38%" />
          {Array.from({ length: cols - 1 }, (_, j) => <SkelBlock key={j} w="14%" />)}
        </div>
      ))}
    </div>
  )
}

const CELL_WIDTHS = ['70%', '55%', '40%', '62%', '48%', '58%']

/** Rader i en riktig tabell, under dess egna rubriker, så kolumnerna stämmer. */
export function SkelTableRows({ n = 5, cols }: { n?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i} className="skel-tr" aria-hidden="true">
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}><SkelBlock w={CELL_WIDTHS[(i + j) % CELL_WIDTHS.length]} /></td>
          ))}
        </tr>
      ))}
    </>
  )
}

const LINE_WIDTHS = ['94%', '86%', '72%', '90%', '64%', '80%']

/** Textrader, som ett stycke. */
export function SkelLines({ n = 3 }: { n?: number }) {
  return (
    <div className="skel-lines">
      {Array.from({ length: n }, (_, i) => <SkelBlock key={i} w={LINE_WIDTHS[i % LINE_WIDTHS.length]} />)}
    </div>
  )
}

const BARS = [18, 30, 22, 46, 34, 58, 40, 70, 52, 38, 64, 48, 80, 56, 36, 44, 28, 62, 50, 34]

/** Ett stapeldiagram och dess förklaring. */
export function SkelChart({ height = 230 }: { height?: number }) {
  return (
    <>
      <div className="skel-chart" style={{ height }}>
        {BARS.map((h, i) => <SkelBlock key={i} className="skel-bar" h={`${h}%`} style={{ animationDelay: `${i * 40}ms` }} />)}
      </div>
      <div className="skel-legend">
        <SkelBlock w="12%" h={12} />
        <SkelBlock w="25%" h={12} />
        <SkelBlock w="18%" h={12} />
      </div>
    </>
  )
}

/** Ett kort med rubrik och rader (eller diagram, eller eget innehåll). */
export function SkelCard({ rows = 4, cols = 3, head = true, aside = true, chart, lines, className = '', children }: {
  rows?: number
  cols?: number
  head?: boolean
  aside?: boolean
  chart?: boolean
  lines?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={`admin-card table-card skel-card${className ? ` ${className}` : ''}`} aria-hidden="true">
      <Sheen />
      {head && <SkelHead aside={aside} />}
      {children ?? (chart ? <SkelChart /> : lines ? <SkelLines n={lines} /> : <SkelRows n={rows} cols={cols} />)}
    </section>
  )
}

/** Nyckeltalsrutorna överst, i sidans eget rutnät (.stats-row). */
export function SkelTiles({ n = 4 }: { n?: number }) {
  return (
    <section className="stats-row" aria-hidden="true" style={{ '--stat-cols': n } as CSSProperties}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="admin-card stat-tile skel-tile">
          <Sheen />
          <SkelBlock w="46%" h={12} />
          <SkelBlock w="34%" h={40} style={{ borderRadius: 12 }} />
          <SkelBlock w="70%" h={12} style={{ marginTop: 'auto' }} />
        </div>
      ))}
    </section>
  )
}

/** En ruta i sidans eget kort eller rutnät (t.ex. kassans rätter). */
export function SkelBox({ className = '', h, children }: { className?: string; h?: Size; children?: ReactNode }) {
  return (
    <div className={`skel-box${className ? ` ${className}` : ''}`} aria-hidden="true" style={h !== undefined ? { minHeight: h } : undefined}>
      <Sheen />
      {children}
    </div>
  )
}

/** Hela adminramen medan inloggningen kontrolleras: sidomeny, sidhuvud och innehåll. */
export function SkelShell({ label }: { label: string }) {
  return (
    <div className="admin-shell" role="status" aria-label={label} aria-busy="true">
      <aside className="admin-sidebar admin-sidebar--full skel-sidebar" aria-hidden="true">
        <div className="admin-logo">
          <SkelBlock w={120} h={26} />
        </div>
        <nav className="admin-nav">
          {[70, 60, 0, 80, 90, 0, 56, 64, 82].map((w, i) =>
            w ? <SkelBlock key={i} className="skel-nav" w={`${w}%`} h={16} /> : <SkelBlock key={i} className="skel-nav-head" w="40%" h={12} />,
          )}
        </nav>
      </aside>
      <div className="admin-right">
        <header className="admin-topbar" aria-hidden="true">
          <SkelBlock w={220} h={30} />
        </header>
        <div className="admin-main">
          <div className="skel">
            <SkelTiles />
            <SkelCard rows={5} />
          </div>
        </div>
      </div>
    </div>
  )
}
