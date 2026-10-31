/**
 * Medan layouten hämtas: i stället för en laddare ligger planen bakom frostat
 * glas och en skiss av en lokal dukas fram, väggar först och sedan borden ett
 * i taget, som när personalen ställer i ordning före öppning. Försvinner med
 * en mjuk toning när den riktiga planen är här. Minska rörelse: skissen står
 * still.
 */
export function LayoutPrep({ done }: { done: boolean }) {
  return (
    <div
      className={done ? 'layout-prep is-done' : 'layout-prep'}
      role="status"
      aria-live="polite"
      aria-hidden={done || undefined}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="layout-prep-card">
        <svg className="layout-prep-plan" viewBox="0 0 240 150" aria-hidden="true">
          <path className="layout-prep-wall" pathLength={1} d="M12 12h216v126H12z" />
          <path className="layout-prep-wall layout-prep-wall--inner" pathLength={1} d="M150 12v54" />
          <rect className="layout-prep-table" style={{ animationDelay: '0.5s' }} x="34" y="30" width="34" height="22" rx="4" />
          <rect className="layout-prep-table" style={{ animationDelay: '0.7s' }} x="88" y="30" width="34" height="22" rx="4" />
          <circle className="layout-prep-table" style={{ animationDelay: '0.9s' }} cx="51" cy="98" r="14" />
          <circle className="layout-prep-table" style={{ animationDelay: '1.1s' }} cx="105" cy="98" r="14" />
          <rect className="layout-prep-table" style={{ animationDelay: '1.3s' }} x="150" y="86" width="58" height="26" rx="4" />
          <rect className="layout-prep-door" x="176" y="134" width="30" height="8" rx="2" />
        </svg>
        <p>Dukar fram lokalen</p>
      </div>
    </div>
  )
}
