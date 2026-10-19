import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { DESTINATION_LABEL, LINK_SOURCES, campaignSlug, trackedLink } from './marketingApi'
import type { Destination } from './marketingApi'

type Page = Exclude<Destination, 'custom'>
const PAGES: Page[] = ['home', 'book', 'menu', 'order', 'catering']

/**
 * Spårbara länkar: samma utm-taggar som utskicken använder, så att besök och
 * bokningar från t.ex. en Instagram-profil eller en affisch syns som en egen
 * rad i Översikt. QR-koden kan laddas ned och tryckas.
 */
export function LinksTab({ primaryDomain }: { primaryDomain: string | null }) {
  const [site, setSite] = useState(primaryDomain ? `https://${primaryDomain}` : '')
  const [page, setPage] = useState<Page>('book')
  const [source, setSource] = useState('instagram')
  const [campaign, setCampaign] = useState('')
  const [qrFor, setQrFor] = useState<{ link: string; image: string } | null>(null)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)

  const link = trackedLink(site, page, source, campaign)
  const qr = link && qrFor?.link === link ? qrFor.image : null
  const copied = Boolean(link) && copiedLink === link

  useEffect(() => {
    if (!link) return
    let cancelled = false
    QRCode.toDataURL(link, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
      .then((image) => !cancelled && setQrFor({ link, image }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [link])

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopiedLink(link)
    } catch {
      setCopiedLink(null)
    }
  }

  return (
    <div className="mk-stack">
      <section className="admin-card table-card">
        <div className="card-head">
          <h2 className="card-title">Skapa en spårbar länk</h2>
        </div>
        <div className="mk-link-grid">
          <div className="mk-fields">
            <div className="form-field">
              <label htmlFor="mk-l-site">Webbplatsens adress</label>
              <input id="mk-l-site" value={site} placeholder="https://www.er-restaurang.se" onChange={(e) => setSite(e.target.value)} />
              {!primaryDomain && <p className="field-hint">Restaurangen har ingen egen domän inlagd än, så skriv in adressen.</p>}
            </div>
            <div className="form-field">
              <label htmlFor="mk-l-page">Sida</label>
              <select id="mk-l-page" value={page} onChange={(e) => setPage(e.target.value as Page)}>
                {PAGES.map((p) => (
                  <option key={p} value={p}>{DESTINATION_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="mk-l-src">Var länken delas</label>
              <select id="mk-l-src" value={source} onChange={(e) => setSource(e.target.value)}>
                {LINK_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="mk-l-cmp">Kampanjnamn</label>
              <input id="mk-l-cmp" value={campaign} maxLength={60} placeholder="t.ex. affisch-entren" onChange={(e) => setCampaign(e.target.value)} />
              {campaign && <p className="field-hint">Syns som "{campaignSlug(campaign) || '-'}" i statistiken.</p>}
            </div>
          </div>

          <div className="mk-link-result">
            {link ? (
              <>
                <p className="form-section-label">Länken</p>
                <code className="mk-link-code">{link}</code>
                <div className="row-actions">
                  <button type="button" className="btn primary square" onClick={() => void copy()}>
                    {copied ? 'Kopierad' : 'Kopiera länken'}
                  </button>
                  {qr && (
                    <a className="btn outline square" href={qr} download={`qr-${campaignSlug(campaign) || 'lank'}.png`}>
                      Ladda ned QR-kod
                    </a>
                  )}
                </div>
                {qr && <img className="mk-qr" src={qr} alt="QR-kod för länken" width={200} height={200} />}
              </>
            ) : (
              <p className="cell-muted">
                Fyll i webbplatsens adress (https://) och ett kampanjnamn, så skapas länken och QR-koden här.
              </p>
            )}
          </div>
        </div>
      </section>
      <p className="mk-footnote cell-muted">
        Besök via länken räknas på kanalen och kampanjnamnet, och bokningar som görs under samma besök räknas till
        kampanjen. Inga cookies används.
      </p>
    </div>
  )
}
