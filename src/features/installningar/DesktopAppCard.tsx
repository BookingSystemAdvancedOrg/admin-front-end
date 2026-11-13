import { useEffect, useState } from 'react'
import {
  desktopAppVersion,
  desktopFiles,
  detectDesktopOs,
  type DesktopOs,
} from '../../shared/desktopDownloads'
import './desktopApp.css'

/**
 * Inställningar > Utseende: "Skrivbordsappen". Föreslår filen för datorn man
 * sitter vid och listar resten. Appen är inte signerad ännu, så rutan säger
 * hur man öppnar den första gången (Gatekeeper och SmartScreen).
 */
export function DesktopAppCard() {
  const files = desktopFiles('admin', 'Booqy-Admin')
  const inApp = desktopAppVersion()
  const [os, setOs] = useState<DesktopOs | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void detectDesktopOs().then((v) => alive && setOs(v))
    return () => {
      alive = false
    }
  }, [])

  const mine = os ? files.find((f) => f.os === os) : undefined

  return (
    <section id="skrivbordsappen" className="admin-card table-card desktop-app">
      <h2 className="card-title">Skrivbordsappen</h2>
      <p className="cell-muted">
        Booqy Admin som app på datorn, i ett eget fönster. Samma inloggning och samma funktioner som här. Appen visar alltid
        den senaste versionen av Booqy och frågar när själva appen kan uppdateras.
      </p>

      {inApp ? (
        <p className="desktop-app__now">Du använder skrivbordsappen, version {inApp}. Hjälp-menyn har Sök efter uppdateringar.</p>
      ) : mine ? (
        <p className="desktop-app__pick">
          <a className="btn primary" href={mine.url} download>
            {mine.button}
          </a>
        </p>
      ) : os === null ? (
        <p className="desktop-app__now">Appen finns för datorer. På mobilen och surfplattan fungerar Booqy Admin här i webbläsaren.</p>
      ) : null}

      <ul className="desktop-app__list">
        {files.map((f) => (
          <li key={f.os} className={f.os === os ? 'is-yours' : undefined}>
            <a href={f.url} download>
              <span className="desktop-app__title">{f.title}</span>
              <span className="desktop-app__detail">{f.detail}</span>
            </a>
          </li>
        ))}
      </ul>

      <details className="desktop-app__help">
        <summary>Första gången du öppnar appen</summary>
        <p className="cell-muted">
          Appen är ännu inte signerad hos Apple och Microsoft, så datorn varnar första gången.
        </p>
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
