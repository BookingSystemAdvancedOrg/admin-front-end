import { RowActions } from '../../shared/RowActions'
import { useEffect, useRef, useState } from 'react'
import { sameData, useLiveRefresh } from '../../shared/live'
import { ChangedNote } from '../../shared/ChangedNote'
import { useAuth } from '../auth/useAuth'
import { SaveBar } from '../../shared/SaveBar'
import { useDirtyForm } from '../../shared/dirtyForm'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import { DiscountTierModal } from './DiscountTierModal'
import type { DiscountTierFormValues } from './DiscountTierModal'
import { DISCOUNT_SCOPE_LABEL, settingsProblem } from './data'
import type { DiscountTier, OrderRules } from './data'
import { CateringMenuCard } from './CateringMenuCard'
import { ApiError, isApiConfigured } from '../../shared/api'
import { getLocation } from '../installningar/locationApi'
import { useTenant } from '../../shared/tenant'
import { PhoneInput } from '../../shared/PhoneInput'
import {
  DEFAULT_SETTINGS,
  createTier,
  deleteTier,
  errorText,
  listTiers,
  saveSettings,
  updateTier,
  withBands,
} from '../catering/cateringApi'
import type { CateringSettings, DeliveryBand, LeadTimeRule, Tier } from '../catering/cateringApi'
import './cateringkalkyl.css'
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { Select } from '../../shared/Select'
import { useConfirm } from '../../shared/ConfirmDialog'
import { NoLocation } from '../../shared/NoLocation'
import { SkelCard, SkelPage } from '../../shared/Skeleton'
import { focusErrorField } from '../../shared/errors'

function rulesOf(s: CateringSettings): OrderRules {
  return {
    minPortions: s.minPortions,
    maxPortions: s.maxPortions,
    advanceDays: s.advanceDays,
    discountScope: 'alla_ratter',
    visibleToCustomers: s.enabled,
  }
}

function tierOf(t: Tier): DiscountTier {
  return { id: t.tierId, name: t.name, fromPortions: t.fromPortions, toPortions: t.toPortions,
    discountPercent: t.discountPercent, active: t.active }
}

function tierInput(t: DiscountTier | DiscountTierFormValues) {
  return { name: t.name, fromPortions: t.fromPortions, toPortions: t.toPortions,
    discountPercent: t.discountPercent, active: t.active }
}

/**
 * Ett heltal ur ett sifferfält. Annat än siffror ("49,50", "1.5") godtas
 * inte: fältet står kvar på `prev`, så ett kommatecken aldrig blir en
 * tiopotens (servern tar bara hela kronor, dagar och gäster).
 */
function numberIn(value: string, prev: number): number {
  const t = value.replace(/\s/g, '')
  return /^\d*$/.test(t) ? Number(t) || 0 : prev
}

/** API:ts fältnamn i en rabattnivå -> fältets id, så ett fel flyttar fokus dit. */
const TIER_FIELD_IDS: Record<string, string> = {
  name: 'tier-name', fromPortions: 'tier-from', toPortions: 'tier-to', discountPercent: 'tier-discount',
}

type TierModalState = { mode: 'add' } | { mode: 'edit'; id: string } | null

/**
 * Figma: admin-catering-page. Reglerna, leveranspriserna, offert- och
 * notisinställningarna sparas på platsen (PUT .../catering/settings, knappen
 * uppe till höger); rabattnivåerna sparas direkt när de ändras
 * (.../catering/discount-tiers). Priserna räknas bara av servern (gästens
 * kalkyl på webbplatsen och offerten), så här finns ingen egen prisräkning.
 */
export default function CateringkalkylPage() {
  const { sub } = useAuth()
  const { locationId, resolving } = useLocationId(sub)
  const [confirmEl, ask] = useConfirm()
  const { tenant } = useTenant()
  const isOwner = tenant?.role === 'owner_user'
  const [settings, setSettings] = useState<CateringSettings>(DEFAULT_SETTINGS)
  const [orderRules, setOrderRules] = useState<OrderRules>(rulesOf(DEFAULT_SETTINGS))
  const [tiers, setTiers] = useState<DiscountTier[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [tierError, setTierError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadTry, setLoadTry] = useState(0)

  const [tierModal, setTierModal] = useState<TierModalState>(null)
  /** Fältet där ett kommatecken eller annat än siffror senast nekades. */
  const [wholeOnly, setWholeOnly] = useState<string | null>(null)

  /** numberIn som också visar "Hela tal." under fältet när något nekas. */
  function whole(key: string, value: string, prev: number): number {
    const refused = !/^\d*$/.test(value.replace(/\s/g, ''))
    setWholeOnly((w) => (refused ? key : w === key ? null : w))
    return numberIn(value, prev)
  }

  /** Som whole, men ett tomt fält är null (ingen gräns, och uppåt). */
  function wholeOrNull(key: string, value: string, prev: number): number | null {
    if (value.trim()) return whole(key, value, prev)
    setWholeOnly((w) => (w === key ? null : w))
    return null
  }

  function wholeHint(key: string, text = 'Skriv ett helt tal, till exempel 10.') {
    return wholeOnly === key ? <p className="field-hint error" role="alert">{text}</p> : null
  }

  // Sparade inställningar (platsens cateringSettings) och rabattnivåer.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    // Ny plats (eller nytt försök): skelettet tills just den platsen är läst,
    // så en annan plats inställningar aldrig kan sparas hit.
    setLoaded(false)
    setLoadError(null)
    setChangedThere(null)
    savedSettings.current = null
    // Utan API (mockläge) finns ingen plats att läsa: standardinställningarna.
    Promise.all([isApiConfigured() ? getLocation(locationId) : Promise.resolve({}), listTiers(locationId)])
      .then(([loc, loadedTiers]) => {
        if (cancelled) return
        const stored = (loc as { cateringSettings?: Partial<CateringSettings> }).cateringSettings ?? {}
        const saved = withBands({ ...DEFAULT_SETTINGS, ...stored })
        setSettings(saved)
        setOrderRules(rulesOf(saved))
        savedSettings.current = saved
        setTiers(loadedTiers.map(tierOf))
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => !cancelled && setLoadError(errorText(err, 'Cateringinställningarna kunde inte visas.')))
    return () => {
      cancelled = true
    }
  }, [locationId, loadTry])

  // Levande: rabatter och inställningar som en kollega sparar syns av sig själva.
  // Inställningar du har börjat ändra skrivs inte över (bara orörda följer med).
  const savedSettings = useRef<CateringSettings | null>(null)
  const [changedThere, setChangedThere] = useState<CateringSettings | null>(null)
  useLiveRefresh(async () => {
    if (!locationId) return
    const [loc, loadedTiers] = await Promise.all([getLocation(locationId), listTiers(locationId)])
    setTiers(loadedTiers.map(tierOf))
    const stored = (loc as { cateringSettings?: Partial<CateringSettings> }).cateringSettings ?? {}
    const next = withBands({ ...DEFAULT_SETTINGS, ...stored })
    const base = savedSettings.current
    if (!base || sameData(next, base)) return
    if (sameData(settings, base) && sameData(orderRules, rulesOf(base))) {
      setSettings(next)
      setOrderRules(rulesOf(next))
      savedSettings.current = next
      setChangedThere(null)
    } else {
      setChangedThere(next)
    }
  }, { enabled: Boolean(locationId) && loaded && isApiConfigured() && !saving })

  // Spara följer ändringarna mot det sparade.
  const [failed, setFailed] = useState(false)
  const savedNow = savedSettings.current
  const dirty = useDirtyForm({ settings, orderRules }, loaded && savedNow ? { settings: savedNow, orderRules: rulesOf(savedNow) } : null)
  function discard() {
    const s = savedSettings.current
    if (!s) return
    setSettings(s)
    setOrderRules(rulesOf(s))
    setSaveError(null)
    setFailed(false)
    setWholeOnly(null)
  }

  function takeTheirs() {
    if (!changedThere) return
    setSettings(changedThere)
    setOrderRules(rulesOf(changedThere))
    savedSettings.current = changedThere
    setChangedThere(null)
  }

  function updateOrderRules(patch: Partial<OrderRules>) {
    setOrderRules((prev) => ({ ...prev, ...patch }))
  }

  function updateSettings(patch: Partial<CateringSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
    setSaveNotice(null)
  }

  function setBand(i: number, patch: Partial<DeliveryBand>) {
    updateSettings({ deliveryBands: settings.deliveryBands.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  }

  function setRule(i: number, patch: Partial<LeadTimeRule>) {
    updateSettings({ leadTimeRules: settings.leadTimeRules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }

  // Ny rad börjar direkt efter den sista; en öppen sista rad ("och uppåt") stängs först.
  function addRule() {
    const rules = [...settings.leadTimeRules]
    const last = rules[rules.length - 1]
    if (last && last.toGuests === null) rules[rules.length - 1] = { ...last, toGuests: last.fromGuests + 49 }
    const tail = rules[rules.length - 1]
    const from = tail ? (tail.toGuests ?? tail.fromGuests) + 1 : settings.minGuests
    updateSettings({ leadTimeRules: [...rules, { fromGuests: from, toGuests: null, days: orderRules.advanceDays }] })
  }

  async function save() {
    if (!locationId) return
    const next = {
      ...settings,
      enabled: orderRules.visibleToCustomers,
      minPortions: orderRules.minPortions,
      maxPortions: orderRules.maxPortions,
      advanceDays: orderRules.advanceDays,
      maxDeliveryKm: settings.deliveryBands[settings.deliveryBands.length - 1]?.upToKm ?? null,
    }
    const problem = settingsProblem(next)
    if (problem) {
      setSaveError(problem)
      setSaveNotice(null)
      setFailed(true)
      return
    }
    setSaving(true)
    setFailed(false)
    setSaveError(null)
    setSaveNotice(null)
    try {
      const { originFound, ...stored } = await saveSettings(locationId, next)
      const saved = withBands({ ...DEFAULT_SETTINGS, ...stored })
      setSettings(saved)
      setOrderRules(rulesOf(saved))
      savedSettings.current = saved
      setChangedThere(null)
      setSaveNotice(saved.enabled ? 'Sparat. Kalkylen visas på webbplatsen.' : 'Sparat. Kalkylen är dold för gäster.')
      if (originFound === false) {
        setSaveError('Startadressen för leveranser hittades inte på kartan. Kolla adressen. Tills dess sätter du leveranspriset för hand i varje offert.')
      }
    } catch (err) {
      setFailed(true)
      setSaveError(errorText(err, 'Inställningarna sparades inte.'))
    } finally {
      setSaving(false)
    }
  }

  async function tierCall(action: () => Promise<unknown>) {
    if (!locationId) return
    setTierError(null)
    try {
      await action()
      setTiers((await listTiers(locationId)).map(tierOf))
    } catch (err) {
      setTierError(errorText(err, 'Rabattnivåerna ändrades inte.'))
    }
  }

  function toggleTierActive(id: string) {
    const tier = tiers.find((t) => t.id === id)
    if (!tier || !locationId) return
    void tierCall(() => updateTier(locationId, id, tierInput({ ...tier, active: !tier.active })))
  }

  async function removeTier(tier: DiscountTier): Promise<boolean> {
    if (!locationId) return false
    if (!(await ask({ title: `Radera ${tier.name}?`, confirmLabel: 'Radera', danger: true }))) return false
    void tierCall(() => deleteTier(locationId, tier.id))
    return true
  }

  /** Sparar nivån; rutan stängs bara när det gick, annars står den kvar med felet. */
  async function handleSaveTier(values: DiscountTierFormValues): Promise<string | null> {
    if (!locationId) return null
    const id = tierModal?.mode === 'edit' ? tierModal.id : null
    try {
      await (id ? updateTier(locationId, id, tierInput(values)) : createTier(locationId, tierInput(values)))
    } catch (err) {
      if (id && err instanceof ApiError && err.status === 404) {
        // En kollega har raderat nivån: listan visar det som finns kvar.
        void tierCall(() => Promise.resolve())
        return 'Nivån finns inte längre, någon har tagit bort den. Stäng rutan för att se det som finns kvar.'
      }
      const text = errorText(err, 'Nivån sparades inte.')
      focusErrorField(err, TIER_FIELD_IDS)
      return text
    }
    setTierModal(null)
    void tierCall(() => Promise.resolve())
    return null
  }

  const editingTier =
    tierModal?.mode === 'edit' ? tiers.find((t) => t.id === tierModal.id) ?? null : null

  const bands = settings.deliveryBands

  return (
    <>
      <AdminTopbar
        title="Cateringkalkyl"
        actions={isOwner ? undefined : <span className="cell-muted">Bara ägaren kan ändra</span>}
      />

      {!locationId && !resolving ? (
        <main className="admin-main">
          <NoLocation />
        </main>
      ) : loadError ? (
        <main className="admin-main">
          <ErrorNote text={loadError} onRetry={() => { setLoadError(null); setLoadTry((n) => n + 1) }} />
        </main>
      ) : !loaded ? (
        <main className="admin-main">
          <SkelPage label="Hämtar cateringinställningarna">
            <SkelCard head={false} rows={1} cols={2} />
            <SkelCard rows={3} cols={2} />
            <div className="settings-row" aria-hidden="true">
              <SkelCard aside={false} lines={4} />
              <SkelCard aside={false} rows={3} cols={3} />
            </div>
            <SkelCard rows={3} cols={4} />
          </SkelPage>
        </main>
      ) : (
      <main className="admin-main cat-kalkyl">
        <ErrorNote text={saveError} />
        {changedThere && <ChangedNote onUse={takeTheirs} />}
        {/* Huvudreglaget först: syns catering på webbplatsen eller inte. */}
        <section className="admin-card table-card catering-visibility">
          <div className="toggle-row">
            <div>
              <h2 className="card-title">Catering på webbplatsen</h2>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={orderRules.visibleToCustomers}
              aria-label="Visa kalkylen för kunder på webbplatsen"
              className="switch"
              onClick={() =>
                updateOrderRules({ visibleToCustomers: !orderRules.visibleToCustomers })
              }
            />
          </div>
        </section>
        <CateringMenuCard locationId={locationId} isOwner={isOwner} />
        <div className="settings-row">
          <section className="admin-card table-card">
            <TitleInfo title="Beställningsregler" info="Förfrågningar med färre gäster än minsta antal går inte att skicka. Rabatt och förberedelsetid räknas på antal gäster." />
            <div style={{ height: 16 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="max-portions">Högsta antal portioner (totalt)</label>
                <input
                  id="max-portions"
                  inputMode="numeric"
                  value={orderRules.maxPortions}
                  onChange={(e) =>
                    updateOrderRules({ maxPortions: whole('maxPortions', e.target.value, orderRules.maxPortions) })
                  }
                />
                {wholeHint('maxPortions')}
              </div>
              <div className="form-field">
                <label htmlFor="min-guests">Minsta antal gäster</label>
                <input id="min-guests" inputMode="numeric" value={settings.minGuests}
                  onChange={(e) => updateSettings({ minGuests: whole('minGuests', e.target.value, settings.minGuests) })} />
                {wholeHint('minGuests')}
              </div>
              <div className="form-field">
                <label htmlFor="advance-days">Framförhållning (dagar)</label>
                <input
                  id="advance-days"
                  inputMode="numeric"
                  value={orderRules.advanceDays}
                  onChange={(e) =>
                    updateOrderRules({ advanceDays: whole('advanceDays', e.target.value, orderRules.advanceDays) })
                  }
                />
                {wholeHint('advanceDays')}
              </div>
              <div className="form-field">
                <label htmlFor="discount-scope">Rabatten gäller</label>
                <Select
                  id="discount-scope"
                  value={orderRules.discountScope}
                  onChange={(e) =>
                    updateOrderRules({
                      discountScope: e.target.value as OrderRules['discountScope'],
                    })
                  }
                >
                  {Object.entries(DISCOUNT_SCOPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </section>

          <section className="admin-card table-card">
            <TitleInfo title="Leveranspris per avstånd" info="Avstånd från restaurangen till leveransadressen, längs vägen. Längre bort än sista intervallet går det inte att beställa leverans." />
            <div style={{ height: 16 }} />
            <div className="form-field">
              <label htmlFor="delivery-origin">Leveranser utgår från</label>
              <input id="delivery-origin" value={settings.originAddress} autoComplete="street-address"
                placeholder="Restaurangens adress" aria-describedby="delivery-origin-hint"
                onChange={(e) => updateSettings({ originAddress: e.target.value })} />
              <p className="field-hint" id="delivery-origin-hint">Tomt = restaurangens adress</p>
            </div>
            <div style={{ height: 12 }} />
            <div className="form-field">
              <label htmlFor="delivery-area">Leveransområde (visas för gästen)</label>
              <input id="delivery-area" value={settings.deliveryArea}
                onChange={(e) => updateSettings({ deliveryArea: e.target.value })} />
            </div>
            <div style={{ height: 12 }} />
            <ul className="band-list" aria-label="Leveransintervall">
              {bands.map((b, i) => (
                <li key={i} className="band-row">
                  <span className="band-from">{i === 0 ? '0' : bands[i - 1].upToKm} till</span>
                  <label className="band-field">
                    <span className="sr-only">Intervall {i + 1}, upp till km</span>
                    <input inputMode="numeric" value={b.upToKm}
                      onChange={(e) => setBand(i, { upToKm: whole(`band-km-${i}`, e.target.value, b.upToKm) })} />
                    <span className="band-unit" aria-hidden="true">km</span>
                  </label>
                  <label className="band-field">
                    <span className="sr-only">Intervall {i + 1}, pris</span>
                    <input inputMode="numeric" value={b.price}
                      onChange={(e) => setBand(i, { price: whole(`band-kr-${i}`, e.target.value, b.price) })} />
                    <span className="band-unit" aria-hidden="true">kr</span>
                  </label>
                  <button type="button" className="link-action danger" disabled={bands.length === 1}
                    aria-label={`Ta bort intervall ${i + 1}`}
                    onClick={() => updateSettings({ deliveryBands: bands.filter((_, j) => j !== i) })}>
                    Ta bort
                  </button>
                  {(wholeOnly === `band-km-${i}` || wholeOnly === `band-kr-${i}`) && (
                    <p className="field-hint error band-hint" role="alert">
                      {wholeOnly === `band-kr-${i}` ? 'Skriv hela kronor, till exempel 250.' : 'Skriv hela km, till exempel 15.'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="btn outline band-add" disabled={bands.length >= 10}
              onClick={() => {
                const last = bands[bands.length - 1]
                updateSettings({ deliveryBands: [...bands, { upToKm: (last?.upToKm ?? 0) + 10, price: last?.price ?? 0 }] })
              }}>
              + Lägg till intervall
            </button>
            <div style={{ height: 16 }} />
            <p className="calc-hint">
              Max {bands[bands.length - 1]?.upToKm ?? 0} km
            </p>
          </section>
        </div>

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <TitleInfo
                title="Förberedelsetid per antal gäster"
                info={`Hur många dagar i förväg en beställning måste komma in, beroende på storleken. Intervallen ska följa direkt på varandra utan luckor. Lämna "Till" tomt på sista raden för "och uppåt". Beställningar utanför intervallen får ${orderRules.advanceDays} dagars framförhållning.`}
              />
            </div>
            <button type="button" className="btn outline" disabled={settings.leadTimeRules.length >= 10}
              onClick={addRule}>
              + Lägg till intervall
            </button>
          </div>
          {settings.leadTimeRules.length === 0 ? (
            <p className="cm-empty">
              Inga intervall. {orderRules.advanceDays} dagar gäller alla.
            </p>
          ) : (
            <div className="table-scroll" tabIndex={0}>
              <table className="data-table lead-table">
                <thead>
                  <tr>
                    <th>Från antal gäster</th>
                    <th>Till antal gäster</th>
                    <th>Dagar i förväg</th>
                    <th><span className="sr-only">Åtgärder</span></th>
                  </tr>
                </thead>
                <tbody>
                  {settings.leadTimeRules.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input aria-label={`Intervall ${i + 1}, från antal gäster`} inputMode="numeric"
                          value={r.fromGuests} onChange={(e) => setRule(i, { fromGuests: whole(`rule-from-${i}`, e.target.value, r.fromGuests) })} />
                        {wholeHint(`rule-from-${i}`)}
                      </td>
                      <td>
                        <input aria-label={`Intervall ${i + 1}, till antal gäster`} inputMode="numeric"
                          placeholder="och uppåt" value={r.toGuests ?? ''}
                          onChange={(e) => setRule(i, { toGuests: wholeOrNull(`rule-to-${i}`, e.target.value, r.toGuests ?? 0) })} />
                        {wholeHint(`rule-to-${i}`)}
                      </td>
                      <td>
                        <input aria-label={`Intervall ${i + 1}, dagar i förväg`} inputMode="numeric"
                          value={r.days} onChange={(e) => setRule(i, { days: whole(`rule-days-${i}`, e.target.value, r.days) })} />
                        {wholeHint(`rule-days-${i}`)}
                      </td>
                      <td>
                        <button type="button" className="link-action danger" aria-label={`Ta bort intervall ${i + 1}`}
                          onClick={() => updateSettings({ leadTimeRules: settings.leadTimeRules.filter((_, j) => j !== i) })}>
                          Ta bort
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="settings-row">
          <section className="admin-card table-card">
            <TitleInfo
              title="Moms och servering"
              info={`Vad en ny offert utgår från. Du kan ändra det per offert. ${settings.defaultServiceIncluded
                ? 'Med servering räknas catering som restaurangtjänst (12 % moms).'
                : 'Bara mat räknas som livsmedel (6 % moms 1 april 2026 till 31 december 2027, annars 12 %).'} Stäm av med er redovisningskonsult.`}
            />
            <div style={{ height: 16 }} />
            <div className="toggle-row">
              <span className="toggle-row-label" id="cat-service-label">Servering ingår som standard</span>
              <button type="button" role="switch" aria-checked={settings.defaultServiceIncluded}
                aria-labelledby="cat-service-label" className="switch"
                onClick={() => updateSettings({ defaultServiceIncluded: !settings.defaultServiceIncluded })} />
            </div>
          </section>

          <section className="admin-card table-card">
            <TitleInfo title="Påminnelser" info="Automatiska påminnelser per e-post. 0 = ingen påminnelse." />
            <div style={{ height: 16 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="cat-owner-reminder">Obesvarad förfrågan, påminn mig efter (timmar)</label>
                <input id="cat-owner-reminder" inputMode="numeric" value={settings.ownerReminderHours}
                  onChange={(e) => updateSettings({ ownerReminderHours: whole('ownerReminderHours', e.target.value, settings.ownerReminderHours) })} />
                {wholeHint('ownerReminderHours')}
              </div>
              <div className="form-field">
                <label htmlFor="cat-sign-reminder">Osignerad offert, påminn kunden (dagar innan den går ut)</label>
                <input id="cat-sign-reminder" inputMode="numeric" value={settings.signReminderDaysBefore}
                  onChange={(e) => updateSettings({ signReminderDaysBefore: whole('signReminderDaysBefore', e.target.value, settings.signReminderDaysBefore) })} />
                {wholeHint('signReminderDaysBefore')}
              </div>
            </div>
            <div style={{ height: 8 }} />
            <div className="toggle-row">
              <span className="toggle-row-label" id="cat-day-before-label">Påminn kunden dagen före leverans</span>
              <button type="button" role="switch" aria-checked={settings.dayBeforeReminder}
                aria-labelledby="cat-day-before-label" className="switch"
                onClick={() => updateSettings({ dayBeforeReminder: !settings.dayBeforeReminder })} />
            </div>
          </section>
        </div>

        <section className="admin-card table-card">
          <TitleInfo
            title="Retur av utrustning"
            info="Gästen väljer om fat och utrustning lämnas tillbaka rengjorda (ingen extra kostnad) eller ej rengjorda. Avgiften visas som egen rad i offerten. Ändrar du avgiften gäller den nya förfrågningar och nya offertversioner; redan skickade och signerade offerter behåller sitt pris."
          />
          <div style={{ height: 16 }} />
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="cat-cleaning-fee">Rengöringsavgift, ej rengjord utrustning (kr inkl. moms)</label>
              <input id="cat-cleaning-fee" inputMode="numeric" value={settings.cleaningFee}
                onChange={(e) => updateSettings({ cleaningFee: whole('cleaningFee', e.target.value, settings.cleaningFee) })} />
              {wholeHint('cleaningFee', 'Skriv hela kronor, till exempel 250.')}
            </div>
          </div>
        </section>

        <section className="admin-card table-card">
          <h2 className="card-title">Offert, betalning och notiser</h2>
          <div style={{ height: 16 }} />
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="cat-capacity">Max portioner per dag (tomt = ingen gräns)</label>
              <input id="cat-capacity" inputMode="numeric" value={settings.maxPortionsPerDay ?? ''}
                onChange={(e) => updateSettings({ maxPortionsPerDay: wholeOrNull('maxPortionsPerDay', e.target.value, settings.maxPortionsPerDay ?? 0) })} />
              {wholeHint('maxPortionsPerDay')}
            </div>
            <div className="form-field">
              <label htmlFor="cat-valid">Offert gäller (dagar)</label>
              <input id="cat-valid" inputMode="numeric" value={settings.offerValidDays}
                onChange={(e) => updateSettings({ offerValidDays: whole('offerValidDays', e.target.value, settings.offerValidDays) })} />
              {wholeHint('offerValidDays')}
            </div>
            <div className="form-field">
              <label htmlFor="cat-terms-days">Betalningsvillkor företag (dagar)</label>
              <input id="cat-terms-days" inputMode="numeric" value={settings.paymentTermsDays}
                onChange={(e) => updateSettings({ paymentTermsDays: whole('paymentTermsDays', e.target.value, settings.paymentTermsDays) })} />
              {wholeHint('paymentTermsDays')}
            </div>
            <div className="form-field">
              <label htmlFor="cat-expiry">Obesvarad förfrågan går ut efter (timmar)</label>
              <input id="cat-expiry" inputMode="numeric" value={settings.requestExpiryHours}
                onChange={(e) => updateSettings({ requestExpiryHours: whole('requestExpiryHours', e.target.value, settings.requestExpiryHours) })} />
              {wholeHint('requestExpiryHours')}
            </div>
            <div className="form-field">
              <label htmlFor="cat-notify-email">Nya förfrågningar till e-post</label>
              <input id="cat-notify-email" type="email" placeholder="Platsens e-post" value={settings.notifyEmail ?? ''}
                onChange={(e) => updateSettings({ notifyEmail: e.target.value.trim() || null })} />
            </div>
            <div className="form-field">
              <label htmlFor="cat-notify-phone">Nya förfrågningar till mobil (sms)</label>
              <PhoneInput id="cat-notify-phone" value={settings.notifyPhone ?? ''}
                onChange={(v) => updateSettings({ notifyPhone: v || null })} />
            </div>
          </div>
          <div className="toggle-stack">
          <div className="toggle-row">
            <span className="toggle-row-label" id="cat-pickup-label">Avhämtning</span>
            <button type="button" role="switch" aria-checked={settings.pickup} aria-labelledby="cat-pickup-label"
              className="switch" onClick={() => updateSettings({ pickup: !settings.pickup })} />
          </div>
          <div className="toggle-row">
            <span className="toggle-row-label" id="cat-delivery-label">Leverans</span>
            <button type="button" role="switch" aria-checked={settings.delivery} aria-labelledby="cat-delivery-label"
              className="switch" onClick={() => updateSettings({ delivery: !settings.delivery })} />
          </div>
          <div className="toggle-row">
            <span className="toggle-row-label" id="cat-simple-label">
              Kunden får godkänna offerten utan BankID (namn och kryssruta)
            </span>
            <button type="button" role="switch" aria-checked={settings.allowSimpleAcceptance}
              aria-labelledby="cat-simple-label" className="switch"
              onClick={() => updateSettings({ allowSimpleAcceptance: !settings.allowSimpleAcceptance })} />
          </div>
          </div>
          <div className="form-field">
            <label htmlFor="cat-terms">Villkor (visas i offerten och signeras av kunden)</label>
            <textarea id="cat-terms" rows={4} maxLength={4000} value={settings.terms}
              onChange={(e) => updateSettings({ terms: e.target.value })} />
          </div>
        </section>
        {isOwner && (
          <SaveBar dirty={dirty} busy={saving} label="Spara inställningar" onSave={() => void save()} onDiscard={discard}
            notice={saveNotice} failed={failed} disabled={!loaded} />
        )}

        <section className="admin-card table-card cat-tiers">
          <div className="card-head">
            <div>
              <TitleInfo title="Rabattnivåer" info="Räknas på antal gäster. När nivån nås rabatteras alla rätter." />
            </div>
            <button
              type="button"
              className="btn outline"
              onClick={() => setTierModal({ mode: 'add' })}
            >
              + Ny rabattnivå
            </button>
          </div>
          <ErrorNote text={tierError} />
          <div className="table-scroll" tabIndex={0}>
            <table className="data-table tier-table">
              <thead>
                <tr>
                  <th>Nivå</th>
                  <th>Från antal gäster</th>
                  <th>Till antal gäster</th>
                  <th>Rabatt</th>
                  <th>Status</th>
                  <th>Aktiv</th>
                  <th className="right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-strong">{t.name}</td>
                    <td data-label="Från">{t.fromPortions} gäster</td>
                    <td data-label={t.toPortions != null ? "Till" : undefined}>{t.toPortions != null ? `${t.toPortions} gäster` : 'och uppåt'}</td>
                    <td data-label="Rabatt">
                      {t.discountPercent > 0 ? (
                        <span className="cell-price">-{t.discountPercent} %</span>
                      ) : (
                        <span className="cell-muted">Ingen rabatt</span>
                      )}
                    </td>
                    <td className="tier-status">
                      <span className={`status-badge ${t.active ? 'reserved' : 'cancelled-free'}`}>
                        {t.active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>
                    <td className="tier-switch">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={t.active}
                        aria-label={`${t.name} aktiv`}
                        className="switch"
                        onClick={() => toggleTierActive(t.id)}
                      />
                    </td>
                    <td className="right tier-actions">
                      <RowActions label="Åtgärder">
                        <button
                          type="button"
                          className="link-action"
                          onClick={() => setTierModal({ mode: 'edit', id: t.id })}
                        >
                          Redigera
                        </button>
                        <button
                          type="button"
                          className="link-action danger"
                          onClick={() => void removeTier(t)}
                        >
                          Radera
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </main>
      )}

      {tierModal && (
        <DiscountTierModal
          title={tierModal.mode === 'add' ? 'Ny rabattnivå' : 'Redigera rabattnivå'}
          initial={editingTier}
          otherTiers={tiers.filter((t) => t.id !== editingTier?.id)}
          onSave={handleSaveTier}
          onCancel={() => setTierModal(null)}
          onDelete={
            editingTier
              ? () => {
                  void removeTier(editingTier).then((removed) => removed && setTierModal(null))
                }
              : undefined
          }
        />
      )}
      {confirmEl}
    </>
  )
}
