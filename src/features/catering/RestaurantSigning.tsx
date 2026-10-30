import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { errorText, restaurantSign, restaurantSignStatus } from './cateringApi'
import type { CateringRequest } from './cateringApi'

/** BankID: status en gång i sekunden (QR-koden byts varje sekund). */
export const SIGN_POLL_MS = 1_000
/** Tillbaka från signeringstjänsten: så många statusfrågor, med så långt mellanrum. */
export const RETURN_CHECKS = 5
export const RETURN_CHECK_MS = 2_000

const HINT: Record<string, string> = {
  outstandingTransaction: 'Starta BankID-appen och skanna QR-koden.',
  noClient: 'Starta BankID-appen och skanna QR-koden.',
  started: 'Söker efter BankID, det kan ta en liten stund…',
  userSign: 'Skriv in din säkerhetskod i BankID-appen och välj Signera.',
  userCancel: 'Signeringen avbröts.',
  expiredTransaction: 'BankID-appen svarade inte. Försök igen.',
  certificateErr: 'BankID:t är för gammalt eller spärrat. Använd ett annat.',
  startFailed: 'BankID-appen hittades inte. Installera den och försök igen.',
  checking: 'Kontrollerar signeringen',
  rejected: 'Signeringen avbröts hos signeringstjänsten. Skicka offerten igen för att börja om.',
  canceled: 'Den här offertversionen går inte längre att signera. Skicka offerten igen.',
  timedout: 'Tiden för att signera har gått ut. Skicka offerten igen.',
}

const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent)

/**
 * Restaurangen signerar varje skickad offertversion först (C2). Därefter
 * får kunden mejl och sms och kan signera. Signeringen sker med BankID här
 * (QR-kod, eller appen på samma enhet) eller på signeringstjänstens egen
 * sida, beroende på vad servern svarar.
 */
export function RestaurantSigning({ request, onSigned, returned }: {
  request: CateringRequest
  onSigned: (r?: CateringRequest) => void
  /** Tillbaka från signeringstjänstens sida (?signering=klar). */
  returned: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bankid, setBankid] = useState<{ hint?: string; qr?: string; autoStartToken?: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const asked = useRef(false)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Tillbaka från tjänstens sida: fråga hur det gick, några gånger om
  // tjänsten inte hunnit registrera signaturen.
  useEffect(() => {
    if (!returned || asked.current) return
    asked.current = true
    let tries = 0
    setBankid({ hint: 'checking' })
    const check = async () => {
      try {
        const r = await restaurantSignStatus(request.locationId, request.requestId)
        if (r.state === 'pending' && ++tries < RETURN_CHECKS) {
          timer.current = window.setTimeout(() => void check(), RETURN_CHECK_MS)
          return
        }
        setBankid(null)
        if (r.state === 'signed') onSigned(r.request)
        else if (r.state === 'failed') setError(HINT[r.hint ?? ''] ?? 'Signeringen avbröts. Försök igen.')
        else setError('Signeringen är inte klar än. Ladda om sidan om en liten stund.')
      } catch (err) {
        setBankid(null)
        // no_signing_started: ingen signering väntar (t.ex. sidan laddades om), knappen räcker
        if (!(err instanceof Error && err.message === 'no_signing_started')) setError(errorText(err))
      }
    }
    void check()
  }, [returned, request.locationId, request.requestId, onSigned])

  const qr = async (data?: string) => (data ? QRCode.toDataURL(data, { margin: 1, width: 240 }).catch(() => undefined) : undefined)

  async function poll() {
    try {
      const r = await restaurantSignStatus(request.locationId, request.requestId)
      if (r.state === 'pending') {
        const image = await qr(r.qrData)
        setBankid((b) => (b ? { ...b, hint: r.hint, ...(image ? { qr: image } : {}) } : b))
        timer.current = window.setTimeout(() => void poll(), SIGN_POLL_MS)
        return
      }
      setBankid(null)
      if (r.state === 'signed') onSigned(r.request)
      else setError(HINT[r.hint ?? ''] ?? 'Signeringen avbröts. Försök igen.')
    } catch (err) {
      setBankid(null)
      setError(errorText(err))
    }
  }

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const s = await restaurantSign(request.locationId, request.requestId)
      if (s.kind === 'redirect' && s.url) {
        window.location.assign(s.url)
        return
      }
      setBankid({ hint: 'outstandingTransaction', qr: await qr(s.qrData), autoStartToken: s.autoStartToken })
      if (isMobile() && s.autoStartToken) {
        window.location.href = `https://app.bankid.com/?autostarttoken=${s.autoStartToken}&redirect=null`
      }
      timer.current = window.setTimeout(() => void poll(), SIGN_POLL_MS)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-card table-card restaurant-signing" aria-label="Signera offerten">
      <h2 className="card-title">Signera offerten (v{request.currentOfferVersion})</h2>
      <p className="cell-muted">
        Restaurangen signerar först. När ni har signerat skickas offerten till kunden via mejl och sms, och kunden
        signerar samma version.
      </p>
      {bankid ? (
        <div className="bankid-box" role="status" aria-live="polite">
          <p>
            {HINT[bankid.hint ?? ''] ?? 'Signera med BankID.'}
            {bankid.hint === 'checking' && <span className="checking-dots" aria-hidden="true" />}
          </p>
          {bankid.qr && !isMobile() && <img className="bankid-qr" src={bankid.qr} alt="QR-kod för BankID" />}
          {bankid.autoStartToken && (
            <a className="btn outline square"
              href={isMobile()
                ? `https://app.bankid.com/?autostarttoken=${bankid.autoStartToken}&redirect=null`
                : `bankid:///?autostarttoken=${bankid.autoStartToken}&redirect=null`}>
              Öppna BankID på den här enheten
            </a>
          )}
        </div>
      ) : (
        <span className="row-actions">
          <button type="button" className="btn primary square" disabled={busy} onClick={() => void start()}>
            {busy ? 'Startar…' : 'Signera med BankID'}
          </button>
        </span>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}
