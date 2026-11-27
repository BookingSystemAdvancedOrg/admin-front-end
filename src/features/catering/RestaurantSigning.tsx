import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { tokens } from '@booqy/brand'
import { errorText, restaurantSign, restaurantSignStatus } from './cateringApi'
import type { CateringRequest } from './cateringApi'
import { ErrorNote } from '../../shared/ErrorNote'

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
  userCancel: 'Signeringen avbröts i BankID-appen. Tryck Signera med BankID för att försöka igen.',
  expiredTransaction: 'BankID-appen svarade inte i tid. Försök igen.',
  certificateErr: 'Ditt BankID är för gammalt eller spärrat. Använd ett annat BankID.',
  startFailed: 'BankID-appen hittades inte. Installera BankID-appen och försök igen.',
  checking: 'Kontrollerar signeringen',
  rejected: 'Signeringen avbröts. Gör en ny version av offerten för att börja om.',
  canceled: 'Den här versionen av offerten kan inte signeras längre. Gör en ny version av offerten.',
  timedout: 'Tiden för att signera tog slut. Gör en ny version av offerten.',
}

const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent)

/**
 * Steg 2: restaurangen signerar varje offertversion med BankID (C2), innan
 * den kan skickas till kunden (steg 3, OfferSteps). Signeringen sker här
 * (QR-kod, eller appen på samma enhet) eller på signeringstjänstens egen
 * sida, beroende på vad servern svarar.
 */
export function RestaurantSigning({ request, onSigned, returned, autoStart = false, onAutoStarted }: {
  request: CateringRequest
  onSigned: (r?: CateringRequest) => void
  /** Tillbaka från signeringstjänstens sida (?signering=klar). */
  returned: boolean
  /** Nästa: signera was just pressed: start BankID at once, no second press. */
  autoStart?: boolean
  /** Called when the auto start fired, so the page turns autoStart off (one shot, survives remounts). */
  onAutoStarted?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bankid, setBankid] = useState<{ hint?: string; qr?: string; autoStartToken?: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const asked = useRef(false)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Nästa: signera goes straight into the signing (once per mount).
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart || returned || autoStarted.current) return
    autoStarted.current = true
    onAutoStarted?.()
    void start()
  }, [autoStart, returned]) // eslint-disable-line react-hooks/exhaustive-deps

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
        else if (r.state === 'failed') setError(HINT[r.hint ?? ''] ?? 'Signeringen blev inte klar. Tryck Signera med BankID för att försöka igen.')
        else setError('Signeringen är inte klar än. Sidan visar den så fort den är klar.')
      } catch (err) {
        setBankid(null)
        // no_signing_started: ingen signering väntar (t.ex. sidan laddades om), knappen räcker
        if (!(err instanceof Error && err.message === 'no_signing_started')) setError(errorText(err, 'Signeringen blev inte klar.'))
      }
    }
    void check()
  }, [returned, request.locationId, request.requestId, onSigned])

  const qr = async (data?: string) => (data ? QRCode.toDataURL(data, { margin: 1, width: 240, color: { light: tokens.palette.snow } }).catch(() => undefined) : undefined)

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
      else setError(HINT[r.hint ?? ''] ?? 'Signeringen blev inte klar. Tryck Signera med BankID för att försöka igen.')
    } catch (err) {
      setBankid(null)
      setError(errorText(err, 'Signeringen blev inte klar.'))
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
      setError(errorText(err, 'Signeringen blev inte klar.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="restaurant-signing">
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
        <button type="button" className="btn primary square" disabled={busy} onClick={() => void start()}>
          {busy ? 'Startar…' : 'Signera med BankID'}
        </button>
      )}
      <ErrorNote text={error} />
    </div>
  )
}
