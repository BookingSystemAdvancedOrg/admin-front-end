import { useEffect, useState } from 'react'
import { errorText } from '../../shared/errors'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import ModalOverlay from '../../shared/ModalOverlay'
import { withBusy } from '../../shared/motion/busy'
import { cardPdf, cardPng, cardSvg, download, fileName, printCards, sheetPdf, svgDataUrl } from './qrCard'
import type { QrCard } from './qrCard'
import { regenerateTableCode } from './tableQrApi'
import { useCardName, useTableCodes } from './useTableCodes'
import type { TableCode } from './tableQrApi'
import './table-qr.css'

type MockTable = { tableId: string; label: string; seats?: number }

function toCard(code: TableCode, restaurant: string): QrCard {
  return { title: code.title, restaurant, url: code.url as string }
}

/** Ladda ner ett kort som PNG, SVG eller PDF. */
async function save(card: QrCard, kind: 'png' | 'svg' | 'pdf') {
  const blob =
    kind === 'png'
      ? await cardPng(card)
      : kind === 'svg'
        ? new Blob([cardSvg(card)], { type: 'image/svg+xml' })
        : cardPdf(card)
  download(blob, fileName(card.title, kind))
}

const NO_SITE = 'Restaurangen har ingen webbadress än. QR-koderna kan skapas när webbplatsen finns.'

/** Kortet, knapparna för utskrift/nedladdning och "Ny kod" för ett bord. */
function CodeCard({
  locationId,
  code,
  restaurant,
  onRegenerated,
  compact = false,
}: {
  locationId: string
  code: TableCode
  restaurant: string
  onRegenerated: (next: TableCode) => void
  compact?: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const card = code.url ? toCard(code, restaurant) : null
  const preview = card ? svgDataUrl(cardSvg(card)) : null

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      const next = await withBusy(() => regenerateTableCode(locationId, code))
      onRegenerated(next)
      setNotice('Ny kod skapad. Den gamla dekalen fungerar inte längre - skriv ut den nya.')
      setConfirm(false)
    } catch (err) {
      setError(errorText(err, 'Kunde inte skapa en ny kod just nu. Försök igen.'))
    } finally {
      setBusy(false)
    }
  }

  async function run(kind: 'png' | 'svg' | 'pdf') {
    if (!card) return
    setError(null)
    try {
      await save(card, kind)
    } catch {
      setError('Kunde inte skapa filen. Försök igen.')
    }
  }

  return (
    <figure className={compact ? 'tqr-card tqr-card--compact' : 'tqr-card'}>
      {preview ? (
        <img className="tqr-preview" src={preview} alt={`QR-kort för ${code.title}`} />
      ) : (
        <p className="cell-muted">{NO_SITE}</p>
      )}
      <figcaption className="tqr-caption">
        <strong>{code.title}</strong>
        {code.seats ? <span className="cell-muted"> · {code.seats} platser</span> : null}
      </figcaption>
      {card && (
        <div className="tqr-actions">
          <button type="button" className="btn primary square" onClick={() => printCards([card], code.title)}>
            <Icon name="printer" size={16} /> Skriv ut
          </button>
          <select
              className="tqr-download"
              value=""
              aria-label={`Ladda ner ${code.title}`}
              onChange={(e) => {
                const kind = e.target.value as 'png' | 'svg' | 'pdf'
                e.target.value = ''
                if (kind) void run(kind)
              }}
            >
              <option value="">Ladda ner…</option>
              <option value="pdf">PDF (för tryck)</option>
              <option value="png">PNG (bild)</option>
              <option value="svg">SVG (vektor)</option>
            </select>
        </div>
      )}
      <div className="tqr-regenerate">
        {confirm ? (
          <>
            <p className="cell-muted">Den nuvarande dekalen slutar fungera direkt. Fortsätt?</p>
            <span className="row-actions">
              <button type="button" className="btn danger-outline square" disabled={busy} onClick={() => void regenerate()}>
                {busy ? 'Skapar…' : 'Ja, ny kod'}
              </button>
              <button type="button" className="btn outline square" disabled={busy} onClick={() => setConfirm(false)}>
                Behåll
              </button>
            </span>
          </>
        ) : (
          <button type="button" className="btn outline square" onClick={() => { setNotice(null); setConfirm(true) }}>
            <Icon name="rotate" size={16} /> Ny kod (stulen dekal)
          </button>
        )}
        {notice && <p className="save-notice" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </figure>
  )
}

/**
 * Layout-redigeraren: QR-koden för det markerade bordet. Bara bord i den
 * publicerade planritningen har en kod; ett nytt eller ändrat bord i
 * utkastet får sin kod (eller sitt nya namn på kortet) när layouten
 * publiceras.
 */
export function TableQrPanel({
  locationId,
  tableId,
  mockTables,
  version,
}: {
  locationId: string | null
  tableId: string
  mockTables: MockTable[]
  version: number
}) {
  const restaurant = useCardName()
  const { codes, error, replace } = useTableCodes(locationId, mockTables, version)
  const code = codes?.find((c) => c.tableId === tableId) ?? null
  if (!locationId) return null
  return (
    <div className="props-field tqr-panel">
      <p className="props-label">QR-KOD FÖR BESTÄLLNING</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!codes && !error && <Loading label="Hämtar QR-koden" variant="inline" />}
      {codes && !code && (
        <p className="props-empty">
          Bordet finns inte i den publicerade layouten än. Publicera layouten så får bordet sin QR-kod.
        </p>
      )}
      {code && (
        <CodeCard locationId={locationId} code={code} restaurant={restaurant} onRegenerated={replace} compact />
      )}
    </div>
  )
}

/** Alla bords QR-kort: utskriftsark (fyra per A4), PDF med alla och ett kort per bord. */
export function TableQrModal({
  locationId,
  mockTables,
  onClose,
}: {
  locationId: string
  mockTables: MockTable[]
  onClose: () => void
}) {
  const restaurant = useCardName()
  const { codes, error, replace } = useTableCodes(locationId, mockTables)
  const printable = (codes ?? []).filter((c) => c.url)
  const cards = printable.map((c) => toCard(c, restaurant))
  const sheetTitle = `QR-koder ${restaurant}`.trim()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <ModalOverlay role="dialog" aria-modal="true" aria-labelledby="tqr-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tqr-modal">
        <div className="tqr-modal-head">
          <h2 id="tqr-title" className="card-title">QR-koder för borden</h2>
          <button type="button" className="btn outline square" aria-label="Stäng" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="cell-muted">
          Ett kort per bord i den publicerade layouten. Gästen skannar, ser sitt bord och beställer; personalen
          ser bordet på varje beställning. Byter ett bord namn eller plats gäller samma dekal.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!codes && !error && <Loading label="Hämtar QR-koderna" />}
        {codes && codes.length === 0 && (
          <p className="cell-muted">Publicera en layout med bord först, så får varje bord en QR-kod.</p>
        )}
        {codes && codes.length > 0 && printable.length === 0 && <p className="form-error">{NO_SITE}</p>}
        {cards.length > 0 && (
          <span className="row-actions">
            <button type="button" className="btn primary square" onClick={() => printCards(cards, sheetTitle)}>
              <Icon name="printer" size={16} /> Skriv ut alla ({cards.length})
            </button>
            <button type="button" className="btn outline square" onClick={() => download(sheetPdf(cards, sheetTitle), 'qr-koder-alla-bord.pdf')}>
              <Icon name="download" size={16} /> PDF med alla
            </button>
          </span>
        )}
        {codes && codes.length > 0 && (
          <div className="tqr-grid">
            {codes.map((c) => (
              <CodeCard key={c.tableId} locationId={locationId} code={c} restaurant={restaurant} onRegenerated={replace} />
            ))}
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
