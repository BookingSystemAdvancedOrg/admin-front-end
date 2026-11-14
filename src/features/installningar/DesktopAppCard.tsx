import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  desktopFiles,
  installCommand,
  installShellFor,
  isDesktopShell,
  isPhoneOrTablet,
  readSignals,
  recommend,
  type DesktopOs,
  type InstallShell,
  type Recommendation,
} from '../../shared/desktopDownloads'
import { phoneKind, usePwaInstall } from '../../shared/pwa'
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
  // Telefon och surfplatta: ingen fillista, appen installeras från webbläsaren.
  if (isPhoneOrTablet({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints })) {
    return <PhoneInstallBody />
  }
  return <DesktopAppCardBody heading={heading} />
}

/**
 * Sidomenyns "Ladda ner appen" / "Installera appen" går till #skrivbordsappen:
 * rulla hit, flytta fokus och lys upp kortet en kort stund. location.key gör
 * att det sker vid varje klick, även när adressen redan slutar på #skrivbordsappen.
 */
/** Ett installationskommando med Kopiera-knapp. */
function CommandRow({ shell }: { shell: InstallShell }) {
  const command = installCommand('admin', shell)
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="desktop-app__cmd">
      <span className="desktop-app__cmd-label">
        {shell === 'windows' ? 'Windows: i PowerShell' : 'Mac och Linux: i Terminal'}
      </span>
      <div className="desktop-app__cmd-row">
        <code>{command}</code>
        <button type="button" className="btn outline square" onClick={() => void copy()}>
          {copied ? 'Kopierat' : 'Kopiera'}
        </button>
      </div>
    </div>
  )
}

function useFlashOnHash() {
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
  return { ref, flash }
}

/** iOS Dela-ikonen (ruta med pil uppåt) och Lägg till-ikonen (ruta med plus). */
function ShareGlyph() {
  return (
    <svg className="phone-install__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5v11M8 7.5l4-4 4 4M7.5 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5" />
    </svg>
  )
}
function AddGlyph() {
  return (
    <svg className="phone-install__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}

/** Telefonens kort: installera Booqy Admin som app på hemskärmen. */
function PhoneInstallBody() {
  const { ref, flash } = useFlashOnHash()
  const { canPrompt, installed, prompt } = usePwaInstall()
  const kind = phoneKind()

  return (
    <section
      id="skrivbordsappen"
      ref={ref}
      tabIndex={-1}
      className={flash ? 'admin-card table-card desktop-app phone-install is-flash' : 'admin-card table-card desktop-app phone-install'}
    >
      <h2 className="card-title">Appen på telefonen</h2>
      {installed ? (
        <p className="desktop-app__now">Appen är installerad. Öppna Booqy Admin från hemskärmen.</p>
      ) : (
        <>
          <p className="cell-muted">
            Lägg Booqy Admin på hemskärmen, så öppnas den som en egen app i helskärm. Samma inloggning och samma funktioner
            som här, och den visar alltid den senaste versionen.
          </p>
          {kind === 'ios' ? (
            <ol className="phone-install__steps">
              <li>
                <span className="phone-install__icon"><ShareGlyph /></span>
                <span>Tryck på <strong>Dela</strong> i Safari (längst ned, på iPad uppe till höger).</span>
              </li>
              <li>
                <span className="phone-install__icon"><AddGlyph /></span>
                <span>Scrolla och välj <strong>Lägg till på hemskärmen</strong>.</span>
              </li>
              <li>
                <span className="phone-install__icon phone-install__icon--text">Lägg till</span>
                <span>Tryck <strong>Lägg till</strong> uppe till höger. Appen hamnar på hemskärmen.</span>
              </li>
            </ol>
          ) : canPrompt ? (
            <p className="desktop-app__pick">
              <button type="button" className="btn primary" onClick={() => void prompt()}>
                Installera appen
              </button>
            </p>
          ) : (
            <ol className="phone-install__steps">
              <li>
                <span className="phone-install__icon phone-install__icon--text">⋮</span>
                <span>Tryck på menyn <strong>⋮</strong> uppe till höger i Chrome.</span>
              </li>
              <li>
                <span className="phone-install__icon"><AddGlyph /></span>
                <span>Välj <strong>Installera app</strong> eller <strong>Lägg till på startskärmen</strong>.</span>
              </li>
            </ol>
          )}
          {kind === 'ios' && (
            <p className="cell-muted phone-install__note">
              Första gången i appen loggar du in en gång till; hemskärmsappen har egen inloggning.
            </p>
          )}
        </>
      )}
    </section>
  )
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

  const { ref, flash } = useFlashOnHash()

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
        den senaste versionen av Booqy och uppdaterar sig själv utan frågor.
      </p>

      {rec !== undefined && (
        <div className="desktop-app__install">
          <h3 className="desktop-app__sub">Installera med ett kommando (rekommenderas)</h3>
          <p className="cell-muted">
            Klistra in i {installShellFor(rec) === 'windows' ? 'PowerShell' : installShellFor(rec) === 'unix' ? 'Terminal' : 'Terminal eller PowerShell'} och
            tryck Retur. Kommandot kontrollerar filen och installerar utan varningsrutor.
          </p>
          {installShellFor(rec) !== 'windows' && <CommandRow shell="unix" />}
          {installShellFor(rec) !== 'unix' && <CommandRow shell="windows" />}
          <h3 className="desktop-app__sub">Eller ladda ner filen</h3>
        </div>
      )}

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
