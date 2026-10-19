import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Loading } from '../../shared/Loading'
import { useTenant } from '../../shared/tenant'
import { listMenuItems, menuImageUrl } from '../meny/menuApi'
import type { MenuItem } from '../meny/menuApi'
import { errorText, getOfferSettings, kronorFromOre, offerErrors, percent, saveOfferSettings, withPercent } from './marketingApi'
import type { OfferSettings, OfferView } from './marketingApi'

const PERCENTS = [5, 10, 15, 20, 25, 30, 40, 50]
const VALID_DAYS = [7, 14, 30, 60, 90]
const DELAYS = [0, 5, 10, 20, 30, 45, 60, 90, 120]
const SCROLLS = [0, 25, 40, 60, 80]

function toSettings(v: OfferView): OfferSettings {
  return {
    enabled: v.enabled,
    percent: v.percent,
    minOrderOre: v.minOrderOre,
    validDays: v.validDays,
    headline: v.headline,
    text: v.text,
    buttonLabel: v.buttonLabel,
    imageMenuItemId: v.imageMenuItemId,
    imageLocationId: v.imageLocationId,
    delaySeconds: v.delaySeconds,
    scrollPercent: v.scrollPercent,
    pages: v.pages,
    frequency: v.frequency,
    showOnMobile: v.showOnMobile,
    activeFrom: v.activeFrom,
    activeTo: v.activeTo,
  }
}

/** En stillbild av kupongen som den ser ut på webbplatsen. */
function CardPreview({ s, image, restaurant }: { s: OfferSettings; image: string | null; restaurant: string }) {
  return (
    <div className="mk-offer-preview" aria-label="Förhandsvisning av erbjudandet">
      <div className="mk-offer-ticket">
        <div className="mk-offer-stub">
          <span className="mk-offer-percent">{s.percent}<small>%</small></span>
          <span className="mk-offer-label">rabatt</span>
        </div>
        <div className="mk-offer-body">
          {image && <img className="mk-offer-dish" src={image} alt="" width={56} height={56} />}
          <p className="mk-offer-headline">{withPercent(s.headline, s.percent) || 'Rubrik'}</p>
          <p className="mk-offer-text">{withPercent(s.text, s.percent) || 'Text'}</p>
          <span className="mk-offer-input">din@epost.se</span>
          <span className="mk-offer-consent">
            <i aria-hidden="true" /> Ja, skicka mig erbjudanden och nyheter från {restaurant} via e-post.
          </span>
          <span className="mk-offer-button">{withPercent(s.buttonLabel, s.percent) || 'Knapp'}</span>
          <span className="mk-offer-terms">
            Gäller en gång{s.minOrderOre ? `, vid beställning för minst ${kronorFromOre(s.minOrderOre)}` : ''}, koden gäller i{' '}
            {s.validDays} dagar.
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Välkomsterbjudandet: kupongen i hörnet på restaurangens webbplats där
 * gäster lämnar sin e-post och får en rabattkod. Här ställer ägaren in
 * rabatten, texten, bilden och när och hur ofta kortet visas, och ser
 * resultatet.
 */
export function OfferTab() {
  const { tenant, locationId } = useTenant()
  const [view, setView] = useState<OfferView | null>(null)
  const [draft, setDraft] = useState<OfferSettings | null>(null)
  const [dishes, setDishes] = useState<MenuItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const hasOrdering = Boolean(tenant?.entitlements.features.ordering)

  useEffect(() => {
    let cancelled = false
    getOfferSettings()
      .then((v) => {
        if (cancelled) return
        setView(v)
        setDraft(toSettings(v))
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta erbjudandet.')))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listMenuItems(locationId)
      .then((items) => !cancelled && setDishes(items.filter((d) => d.active && d.imageKey).sort((a, b) => a.name.localeCompare(b.name, 'sv'))))
      .catch(() => !cancelled && setDishes([]))
    return () => {
      cancelled = true
    }
  }, [locationId])

  if (!view || !draft) {
    return error ? <p className="form-error" role="alert">{error}</p> : <Loading label="Hämtar erbjudandet" />
  }

  const set = <K extends keyof OfferSettings>(key: K, value: OfferSettings[K]) => {
    setNotice(null)
    setDraft({ ...draft, [key]: value })
  }
  const problems = offerErrors(draft)
  const chosenDish = dishes?.find((d) => d.menuItemId === draft.imageMenuItemId)
  const image = chosenDish ? menuImageUrl(chosenDish.imageKey) : draft.imageMenuItemId === view.imageMenuItemId ? view.imageUrl : null
  const st = view.stats

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (problems.length) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveOfferSettings(draft)
      setView(saved)
      setDraft(toSettings(saved))
      setShowErrors(false)
      setNotice(saved.enabled ? 'Sparat. Erbjudandet visas nu på er webbplats.' : 'Sparat. Erbjudandet är avstängt.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara erbjudandet.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mk-stack">
      <section className="mk-tiles" aria-label="Resultat">
        {[
          { label: 'Visningar', value: st.views.toLocaleString('sv-SE'), note: 'Gånger kortet visats' },
          { label: 'Anmälningar', value: st.signups.toLocaleString('sv-SE'), note: `${percent(st.signups, st.views)} av visningarna` },
          { label: 'Använda koder', value: st.redeemed.toLocaleString('sv-SE'), note: `${percent(st.redeemed, st.signups)} av anmälningarna` },
          { label: 'Omsättning', value: kronorFromOre(st.revenueOre), note: `${kronorFromOre(st.discountOre)} i rabatt` },
        ].map((t) => (
          <div key={t.label} className="admin-card mk-tile">
            <p className="mk-tile-label">{t.label}</p>
            <p className="mk-tile-value">{t.value}</p>
            <p className="mk-tile-note">{t.note}</p>
          </div>
        ))}
      </section>

      {notice && <p className="save-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!hasOrdering && (
        <p className="form-error" role="alert">
          Koden används vid onlinebeställning, och beställning ingår inte i er plan. Gäster kan anmäla sig, men inte
          använda koden.
        </p>
      )}

      <form className="admin-card table-card mk-offer" onSubmit={(e) => void save(e)}>
        <div className="card-head">
          <h2 className="card-title">Välkomsterbjudande</h2>
          <button type="submit" className="btn primary square" disabled={saving}>
            {saving ? 'Sparar…' : 'Spara'}
          </button>
        </div>

        <div className="mk-editor-grid">
          <div className="mk-editor-form">
            <div className="toggle-row">
              <div>
                <p className="toggle-row-label" id="mk-o-on">Visa på webbplatsen</p>
                <p className="cell-muted">En rabattkupong i hörnet. Gäster lämnar e-post och får en kod som gäller en gång.</p>
              </div>
              <button type="button" role="switch" aria-checked={draft.enabled} aria-labelledby="mk-o-on" className="switch"
                onClick={() => set('enabled', !draft.enabled)} />
            </div>

            <p className="form-section-label">Rabatten</p>
            <div className="mk-field-row">
              <div className="form-field">
                <label htmlFor="mk-o-pct">Rabatt</label>
                <select id="mk-o-pct" value={draft.percent} onChange={(e) => set('percent', Number(e.target.value))}>
                  {PERCENTS.map((p) => <option key={p} value={p}>{p} %</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="mk-o-min">Minsta beställning (kr)</label>
                <input id="mk-o-min" type="number" min={0} max={5000} step={10} inputMode="numeric"
                  value={draft.minOrderOre / 100}
                  onChange={(e) => set('minOrderOre', Math.round(Number(e.target.value || 0) * 100))} />
              </div>
              <div className="form-field">
                <label htmlFor="mk-o-days">Koden gäller</label>
                <select id="mk-o-days" value={draft.validDays} onChange={(e) => set('validDays', Number(e.target.value))}>
                  {VALID_DAYS.map((d) => <option key={d} value={d}>{d} dagar</option>)}
                </select>
              </div>
            </div>

            <p className="form-section-label">Texten</p>
            <div className="form-field">
              <label htmlFor="mk-o-head">Rubrik</label>
              <input id="mk-o-head" value={draft.headline} maxLength={60} onChange={(e) => set('headline', e.target.value)} />
              <p className="field-hint">{'{procent}'} byts mot rabatten, så siffran stämmer även om ni ändrar den.</p>
            </div>
            <div className="form-field">
              <label htmlFor="mk-o-text">Text</label>
              <textarea id="mk-o-text" rows={3} value={draft.text} maxLength={180} onChange={(e) => set('text', e.target.value)} />
              <p className="field-hint">Säg vad gästen får och hur ofta ni hör av er. Lova inget ni inte håller.</p>
            </div>
            <div className="form-field">
              <label htmlFor="mk-o-btn">Knapptext</label>
              <input id="mk-o-btn" value={draft.buttonLabel} maxLength={30} onChange={(e) => set('buttonLabel', e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="mk-o-dish">Bild från menyn</label>
              <select
                id="mk-o-dish"
                value={draft.imageMenuItemId ?? ''}
                disabled={!dishes}
                onChange={(e) =>
                  setDraft({ ...draft, imageMenuItemId: e.target.value || null, imageLocationId: e.target.value ? locationId : null })
                }
              >
                <option value="">Ingen bild</option>
                {(dishes ?? []).map((d) => <option key={d.menuItemId} value={d.menuItemId}>{d.name}</option>)}
              </select>
            </div>

            <p className="form-section-label">När och hur ofta</p>
            <div className="mk-field-row">
              <div className="form-field">
                <label htmlFor="mk-o-delay">Visa efter</label>
                <select id="mk-o-delay" value={draft.delaySeconds} onChange={(e) => set('delaySeconds', Number(e.target.value))}>
                  {DELAYS.map((d) => <option key={d} value={d}>{d === 0 ? 'Direkt' : `${d} sekunder`}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="mk-o-scroll">Eller när besökaren scrollat</label>
                <select id="mk-o-scroll" value={draft.scrollPercent} onChange={(e) => set('scrollPercent', Number(e.target.value))}>
                  {SCROLLS.map((d) => <option key={d} value={d}>{d === 0 ? 'Används inte' : `${d} % av sidan`}</option>)}
                </select>
              </div>
            </div>
            <fieldset className="mk-radios">
              <legend>Var</legend>
              <label className="check-row">
                <input type="radio" name="mk-o-pages" checked={draft.pages === 'all'} onChange={() => set('pages', 'all')} />
                Alla sidor (aldrig vid bokning, beställning eller betalning)
              </label>
              <label className="check-row">
                <input type="radio" name="mk-o-pages" checked={draft.pages === 'menu'} onChange={() => set('pages', 'menu')} />
                Bara startsidan och menyn
              </label>
            </fieldset>
            <fieldset className="mk-radios">
              <legend>Hur ofta</legend>
              <label className="check-row">
                <input type="radio" name="mk-o-freq" checked={draft.frequency === 'visit'} onChange={() => set('frequency', 'visit')} />
                En gång (byter gästen sida blir kortet en liten flik i kanten)
              </label>
              <label className="check-row">
                <input type="radio" name="mk-o-freq" checked={draft.frequency === 'page'} onChange={() => set('frequency', 'page')} />
                På varje sida tills gästen stänger det
              </label>
            </fieldset>
            <div className="toggle-row">
              <div>
                <p className="toggle-row-label" id="mk-o-mobile">Visa i mobilen</p>
                <p className="cell-muted">Som en smal list längst ned som gästen trycker upp.</p>
              </div>
              <button type="button" role="switch" aria-checked={draft.showOnMobile} aria-labelledby="mk-o-mobile"
                className="switch" onClick={() => set('showOnMobile', !draft.showOnMobile)} />
            </div>
            <div className="mk-field-row">
              <div className="form-field">
                <label htmlFor="mk-o-from">Från (valfritt)</label>
                <input id="mk-o-from" type="date" value={draft.activeFrom ?? ''} onChange={(e) => set('activeFrom', e.target.value || null)} />
              </div>
              <div className="form-field">
                <label htmlFor="mk-o-to">Till (valfritt)</label>
                <input id="mk-o-to" type="date" value={draft.activeTo ?? ''} onChange={(e) => set('activeTo', e.target.value || null)} />
              </div>
            </div>
            <p className="field-hint">
              Stänger gästen kortet, eller tar erbjudandet, visas det inte igen under besöket. Ett nytt besök (ny flik)
              visar det igen, eftersom webbplatsen inte sparar något mellan besöken och därför inte behöver någon
              cookieruta. En person kan bara få en kod, och koden gäller bara med den e-postadressen.
            </p>

            {showErrors && problems.length > 0 && (
              <ul className="form-error mk-errors" role="alert">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>

          <div className="mk-preview">
            <p className="form-section-label">Så ser det ut</p>
            <CardPreview s={draft} image={image} restaurant={tenant?.name ?? 'restaurangen'} />
            <p className="field-hint">
              Gästen kryssar själv i att hen vill ha erbjudanden. Koden skickas med e-post och dras av i kassan. Gästen
              blir mottagare av era utskick först när hen bekräftat i mejlet eller använt koden (dubbel bekräftelse).
              Till dess står hen under Mottagare som "Väntar på bekräftelse".
            </p>
          </div>
        </div>
      </form>
    </div>
  )
}
