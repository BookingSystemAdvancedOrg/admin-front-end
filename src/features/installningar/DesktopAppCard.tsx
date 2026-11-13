import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  desktopFiles,
  isDesktopShell,
  readSignals,
  recommend,
  type DesktopOs,
  type Recommendation,
} from '../../shared/desktopDownloads'
import './desktopApp.css'

const LABELS: Record<DesktopOs, { title: string; detail: string; button: string }> = {
  'mac-arm64': { title: 'Mac med Apple-chip', detail: 'M1 eller senare, .dmg', button: 'Ladda ner för Mac (Apple-chip)' },
  'mac-x64': { title: 'Mac med Intel-processor', detail: '.dmg', button: 'Ladda ner för Mac (Intel)' },
  win: { title: 'Windows 10 och 11', detail: '.exe', button: 'Ladda ner för Windows' },
  'linux-appimage': { title: 'Linux, AppImage', detail: 'alla distributioner', button: 'Ladda ner AppImage' },
  linux: { title: 'Linux, .deb', detail: 'Ubuntu och Debian', button: 'Ladda ner .deb' },
}

/** "Rekommenderas för din dator", med Windows-versionen när den är känd. */
function badge(rec: Recommendation): string {
  return `Rekommenderas för din dator${rec.windows ? ` (Windows ${rec.windows})` : ''}`
}

/**
 * Skrivbordsappens nedladdningar: hela listan och, när datorn går att avgöra
 * säkert, en markerad rad "Rekommenderas för din dator". Används på sidan
 * Inställningar > Den här enheten (sidomenyns "Ladda ner appen" leder hit). Inte signerad ännu, så rutan
 * säger hur man öppnar den första gången (Gatekeeper och SmartScreen).
 */
export function DesktopAppCard({ heading = true }: { heading?: boolean }) {
  // I skrivbordsappen finns inget att ladda ner: kortet visas inte alls.
  if (isDesktopShell()) return null
  return <DesktopAppCardBody heading={heading} />
}

function DesktopAppCardBody({ heading }: { heading: boolean }) {
  const files = desktopFiles('admin', 'Booqy-Admin')
  // undefined = läser fortfarande, null = ingen säker rekommendation.
  const [rec, setRec] = useState<Recommendation | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void readSignals()
      .then((s) => alive && setRec(recommend(s)))
      .catch(() => alive && setRec(null))
    return () => {
      alive = false
    }
  }, [])

  const mine = rec ? files.find((f) => f.os === rec.os) : undefined

  // Sidomenyns "Ladda ner appen" går till #skrivbordsappen: rulla hit, flytta
  // fokus och lys upp kortet en kort stund. location.key gör att det sker
  // vid varje klick, även när adressen redan slutar på #skrivbordsappen.
  const location = useLocation()
  const ref = useRef<HTMLElement>(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (location.hash !== '#skrivbordsappen' || !el) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), 1800)
    return () => window.clearTimeout(t)
  }, [location.hash, location.key])

  return (
    <section
      id="skrivbordsappen"
      ref={ref}
      tabIndex={-1}
      className={flash ? 'admin-card table-card desktop-app is-flash' : 'admin-card table-card desktop-app'}
    >
      {heading && <h2 className="card-title">Skrivbordsappen</h2>}
      <p className="cell-muted">
        Booqy Admin som app på datorn, i ett eget fönster. Samma inloggning och samma funktioner som här. Appen visar alltid
        den senaste versionen av Booqy och frågar när själva appen kan uppdateras.
      </p>

      {mine && rec ? (
        <p className="desktop-app__pick">
          <a className="btn primary" href={mine.url} download>
            {LABELS[rec.os].button}
          </a>
        </p>
      ) : rec === null ? (
        <p className="desktop-app__now">Välj filen för din dator i listan.</p>
      ) : null}

      <ul className="desktop-app__list">
        {files.map((f) => {
          const yours = rec?.os === f.os
          return (
            <li key={f.os} className={yours ? 'is-yours' : undefined}>
              <a href={f.url} download>
                <span className="desktop-app__title">
                  {LABELS[f.os].title}
                  {yours && rec && <span className="desktop-app__badge">{badge(rec)}</span>}
                </span>
                <span className="desktop-app__detail">{LABELS[f.os].detail}</span>
              </a>
            </li>
          )
        })}
      </ul>

      <details className="desktop-app__help">
        <summary>Första gången du öppnar appen</summary>
        <p className="cell-muted">Appen är ännu inte signerad hos Apple och Microsoft, så datorn varnar första gången.</p>
        <p>
          <strong>Mac:</strong> dra Booqy Admin till Program och öppna den. Säger macOS att den inte kan kontrolleras: klicka
          Klar, öppna Systeminställningar &gt; Integritet och säkerhet, scrolla ner och klicka Öppna ändå. Efter en
          uppdatering kan macOS fråga om nyckelringen: välj Tillåt alltid.
        </p>
        <p>
          <strong>Windows:</strong> visar Windows "Windows skyddade datorn", klicka Mer information och sedan Kör ändå.
        </p>
        <p>
          <strong>Linux:</strong> öppna .deb-filen i programhanteraren, eller gör AppImage-filen körbar och starta den.
        </p>
      </details>
    </section>
  )
}
