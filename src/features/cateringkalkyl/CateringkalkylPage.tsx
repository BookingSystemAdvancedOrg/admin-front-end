import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import type { Dish } from '../meny/data'
import { getPublicMenu, listMenuItems, publicToDish, toDish } from '../meny/menuApi'
import { DiscountTierModal } from './DiscountTierModal'
import type { DiscountTierFormValues } from './DiscountTierModal'
import { DISCOUNT_SCOPE_LABEL, nextTierAfter, settingsProblem, tierFor } from './data'
import type { DiscountTier, OrderRules } from './data'
import { CateringMenuCard } from './CateringMenuCard'
import { isApiConfigured } from '../../shared/api'
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

function numberIn(value: string): number {
  return Number(value.replace(/[^\d]/g, '')) || 0
}

type TierModalState = { mode: 'add' } | { mode: 'edit'; id: string } | null

const kr0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 })
const kr2 = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function krWhole(n: number): string {
  return `${kr0.format(Math.round(n))} kr`
}

function krPerUnit(n: number): string {
  return `${kr2.format(n)} kr/st`
}

/**
 * Figma: admin-catering-page. Reglerna, leveranspriserna, offert- och
 * notisinställningarna sparas på platsen (PUT .../catering/settings, knappen
 * uppe till höger); rabattnivåerna sparas direkt när de ändras
 * (.../catering/discount-tiers). Förhandsvisningen räknar på den riktiga
 * menyn med samma regler som servern använder för gästens förfrågan.
 */
export default function CateringkalkylPage() {
  const { sub } = useAuth()
  const { locationId } = useLocationId(sub)

  const [dishes, setDishes] = useState<Dish[]>([])

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

  const [tierModal, setTierModal] = useState<TierModalState>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [previewAddress, setPreviewAddress] = useState('Drottninggatan 52, Norrköping')

  // Sparade inställningar (platsens cateringSettings) och rabattnivåer.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    // Utan API (mockläge) finns ingen plats att läsa: standardinställningarna.
    Promise.all([isApiConfigured() ? getLocation(locationId) : Promise.resolve({}), listTiers(locationId)])
      .then(([loc, loadedTiers]) => {
        if (cancelled) return
        const stored = (loc as { cateringSettings?: Partial<CateringSettings> }).cateringSettings ?? {}
        const saved = withBands({ ...DEFAULT_SETTINGS, ...stored })
        setSettings(saved)
        setOrderRules(rulesOf(saved))
        setTiers(loadedTiers.map(tierOf))
        setLoaded(true)
      })
      .catch(() => !cancelled && setSaveError('Kunde inte hämta cateringinställningarna.'))
    return () => {
      cancelled = true
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listMenuItems(locationId)
      .then((items) => {
        if (!cancelled) setDishes(items.map(toDish).filter((d) => d.active))
      })
      .catch(async () => {
        // Adminrutten kanske inte är deployad - samma reservväg som MenyPage.
        try {
          const items = await getPublicMenu(locationId)
          if (!cancelled) setDishes(items.map(publicToDish))
        } catch {
          if (!cancelled) setDishes([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  function updateOrderRules(patch: Partial<OrderRules>) {
    setOrderRules((prev) => ({ ...prev, ...patch }))
  }

  function qty(dishId: string): number {
    return quantities[dishId] ?? 0
  }

  function setQty(dishId: string, n: number) {
    setQuantities((prev) => ({ ...prev, [dishId]: Math.max(0, Math.round(n)) }))
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
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveNotice(null)
    try {
      const saved = withBands({ ...DEFAULT_SETTINGS, ...(await saveSettings(locationId, next)) })
      setSettings(saved)
      setSaveNotice(saved.enabled ? 'Sparat. Kalkylen visas på webbplatsen.' : 'Sparat. Kalkylen är dold för gäster.')
    } catch (err) {
      setSaveError(errorText(err))
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
      setTierError(errorText(err))
    }
  }

  function toggleTierActive(id: string) {
    const tier = tiers.find((t) => t.id === id)
    if (!tier || !locationId) return
    void tierCall(() => updateTier(locationId, id, tierInput({ ...tier, active: !tier.active })))
  }

  function removeTier(tier: DiscountTier) {
    if (!locationId || !window.confirm(`Ta bort ${tier.name}?`)) return
    void tierCall(() => deleteTier(locationId, tier.id))
  }

  function handleSaveTier(values: DiscountTierFormValues) {
    if (!locationId) return
    const id = tierModal?.mode === 'edit' ? tierModal.id : null
    void tierCall(() =>
      id ? updateTier(locationId, id, tierInput(values)) : createTier(locationId, tierInput(values)),
    )
    setTierModal(null)
  }

  const editingTier =
    tierModal?.mode === 'edit' ? tiers.find((t) => t.id === tierModal.id) ?? null : null

  // --- Kalkylen -------------------------------------------------------

  const totalPortions = Object.values(quantities).reduce((sum, n) => sum + n, 0)
  const currentTier = tierFor(tiers, totalPortions)
  const upcomingTier = nextTierAfter(tiers, currentTier)
  const portionsToUpcoming = upcomingTier ? upcomingTier.fromPortions - totalPortions : 0

  const subtotal = dishes.reduce((sum, d) => sum + d.price * qty(d.id), 0)
  const discountPercent = currentTier?.discountPercent ?? 0
  const discountAmount = (subtotal * discountPercent) / 100

  // Illustrativt exempelavstånd - ingen riktig geokodning ännu, så
  // förhandsvisningens "leveransadress" är bara en etikett. Skalat mot det
  // första intervallet så exemplet alltid hamnar i ett intervall.
  const bands = settings.deliveryBands
  const previewDistanceKm = Math.max(1, Math.round((bands[0]?.upToKm ?? 10) * 0.72))
  const previewBand = bands.find((b) => previewDistanceKm <= b.upToKm) ?? null
  const deliveryPrice = totalPortions === 0 ? 0 : previewBand?.price ?? 0

  const total = subtotal - discountAmount + deliveryPrice

  return (
    <>
      <AdminTopbar
        title="Cateringkalkyl"
        subtitle="Regler, rabattnivåer och leveranspriser för catering"
        actions={
          isOwner ? (
            <button type="button" className="btn primary" disabled={!loaded || saving} onClick={() => void save()}>
              {saving ? 'Sparar…' : 'Spara inställningar'}
            </button>
          ) : (
            <span className="cell-muted">Bara ägaren kan ändra</span>
          )
        }
      />

      <main className="admin-main">
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        {saveNotice && <p className="save-notice" role="status">{saveNotice}</p>}
        {/* Huvudreglaget först: syns catering på webbplatsen eller inte. */}
        <section className="admin-card table-card catering-visibility">
          <div className="toggle-row">
            <div>
              <h2 className="card-title">Catering på webbplatsen</h2>
              <p className="cell-muted">
                {orderRules.visibleToCustomers
                  ? 'På - gästerna ser kalkylen och kan skicka förfrågningar. Spara efter ändringar.'
                  : 'Av - gästerna ser inte catering. Slå på och tryck Spara inställningar.'}
              </p>
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
            <h2 className="card-title">Beställningsregler</h2>
            <p className="cell-muted">Minsta och högsta tillåtna beställning</p>
            <div style={{ height: 16 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="min-portions">Minsta antal portioner (totalt)</label>
                <input
                  id="min-portions"
                  inputMode="numeric"
                  value={`${orderRules.minPortions} st`}
                  onChange={(e) =>
                    updateOrderRules({
                      minPortions: Number(e.target.value.replace(/[^\d]/g, '')) || 0,
                    })
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="max-portions">Högsta antal portioner (totalt)</label>
                <input
                  id="max-portions"
                  inputMode="numeric"
                  value={`${orderRules.maxPortions} st`}
                  onChange={(e) =>
                    updateOrderRules({
                      maxPortions: Number(e.target.value.replace(/[^\d]/g, '')) || 0,
                    })
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="min-guests">Minsta antal gäster</label>
                <input id="min-guests" inputMode="numeric" value={`${settings.minGuests} gäster`}
                  onChange={(e) => updateSettings({ minGuests: numberIn(e.target.value) })} />
              </div>
              <div className="form-field">
                <label htmlFor="advance-days">Framförhållning</label>
                <input
                  id="advance-days"
                  inputMode="numeric"
                  value={`${orderRules.advanceDays} dagar`}
                  onChange={(e) =>
                    updateOrderRules({
                      advanceDays: Number(e.target.value.replace(/[^\d]/g, '')) || 0,
                    })
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="discount-scope">Rabatten gäller</label>
                <select
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
                </select>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <p className="calc-hint">
              Kunder kan inte skicka en beställning under minsta antal portioner.
            </p>
          </section>

          <section className="admin-card table-card">
            <h2 className="card-title">Leveranspris per avstånd</h2>
            <p className="cell-muted">Avstånd från restaurangen till leveransadressen, längs vägen</p>
            <div style={{ height: 16 }} />
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
                    <input inputMode="numeric" value={`${b.upToKm} km`}
                      onChange={(e) => setBand(i, { upToKm: numberIn(e.target.value) })} />
                  </label>
                  <label className="band-field">
                    <span className="sr-only">Intervall {i + 1}, pris</span>
                    <input inputMode="numeric" value={`${b.price} kr`}
                      onChange={(e) => setBand(i, { price: numberIn(e.target.value) })} />
                  </label>
                  <button type="button" className="link-action danger" disabled={bands.length === 1}
                    aria-label={`Ta bort intervall ${i + 1}`}
                    onClick={() => updateSettings({ deliveryBands: bands.filter((_, j) => j !== i) })}>
                    Ta bort
                  </button>
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
              Längsta leveransavstånd: {bands[bands.length - 1]?.upToKm ?? 0} km. Längre bort än så går det inte att
              beställa leverans.
            </p>
          </section>
        </div>

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Förberedelsetid per antal gäster</h2>
              <p className="cell-muted">
                Hur många dagar i förväg en beställning måste komma in, beroende på storleken
              </p>
            </div>
            <button type="button" className="btn outline" disabled={settings.leadTimeRules.length >= 10}
              onClick={addRule}>
              + Lägg till intervall
            </button>
          </div>
          {settings.leadTimeRules.length === 0 ? (
            <p className="cm-empty">
              Inga intervall: framförhållningen {orderRules.advanceDays} dagar gäller alla beställningar.
            </p>
          ) : (
            <div className="table-scroll">
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
                          value={r.fromGuests} onChange={(e) => setRule(i, { fromGuests: numberIn(e.target.value) })} />
                      </td>
                      <td>
                        <input aria-label={`Intervall ${i + 1}, till antal gäster`} inputMode="numeric"
                          placeholder="och uppåt" value={r.toGuests ?? ''}
                          onChange={(e) => setRule(i, { toGuests: e.target.value.trim() ? numberIn(e.target.value) : null })} />
                      </td>
                      <td>
                        <input aria-label={`Intervall ${i + 1}, dagar i förväg`} inputMode="numeric"
                          value={r.days} onChange={(e) => setRule(i, { days: numberIn(e.target.value) })} />
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
          <div style={{ height: 12 }} />
          <p className="calc-hint">
            Intervallen ska följa direkt på varandra utan luckor. Lämna "Till" tomt på sista raden för "och uppåt".
            Beställningar utanför intervallen får {orderRules.advanceDays} dagars framförhållning.
          </p>
        </section>

        <div className="settings-row">
          <section className="admin-card table-card">
            <h2 className="card-title">Moms och servering</h2>
            <p className="cell-muted">Vad en ny offert utgår från. Du kan ändra det per offert.</p>
            <div style={{ height: 16 }} />
            <div className="toggle-row">
              <span className="toggle-row-label" id="cat-service-label">Servering ingår som standard</span>
              <button type="button" role="switch" aria-checked={settings.defaultServiceIncluded}
                aria-labelledby="cat-service-label" className="switch"
                onClick={() => updateSettings({ defaultServiceIncluded: !settings.defaultServiceIncluded })} />
            </div>
            <div style={{ height: 16 }} />
            <p className="calc-hint">
              {settings.defaultServiceIncluded
                ? 'Med servering räknas catering som restaurangtjänst (12 % moms).'
                : 'Bara mat räknas som livsmedel (6 % moms 1 april 2026 till 31 december 2027, annars 12 %).'}{' '}
              Stäm av med er redovisningskonsult.
            </p>
          </section>

          <section className="admin-card table-card">
            <h2 className="card-title">Påminnelser</h2>
            <p className="cell-muted">Automatiska påminnelser per e-post. 0 = ingen påminnelse.</p>
            <div style={{ height: 16 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="cat-owner-reminder">Obesvarad förfrågan, påminn mig efter (timmar)</label>
                <input id="cat-owner-reminder" inputMode="numeric" value={settings.ownerReminderHours}
                  onChange={(e) => updateSettings({ ownerReminderHours: numberIn(e.target.value) })} />
              </div>
              <div className="form-field">
                <label htmlFor="cat-sign-reminder">Osignerad offert, påminn kunden (dagar innan den går ut)</label>
                <input id="cat-sign-reminder" inputMode="numeric" value={settings.signReminderDaysBefore}
                  onChange={(e) => updateSettings({ signReminderDaysBefore: numberIn(e.target.value) })} />
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
          <h2 className="card-title">Retur av utrustning</h2>
          <p className="cell-muted">
            Gästen väljer om fat och utrustning lämnas tillbaka rengjorda (ingen extra kostnad) eller ej rengjorda
          </p>
          <div style={{ height: 16 }} />
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="cat-cleaning-fee">Rengöringsavgift, ej rengjord utrustning (inkl. moms)</label>
              <input id="cat-cleaning-fee" inputMode="numeric" value={`${settings.cleaningFee} kr`}
                onChange={(e) => updateSettings({ cleaningFee: numberIn(e.target.value) })} />
            </div>
          </div>
          <div style={{ height: 16 }} />
          <p className="calc-hint">
            Visas som egen rad i offerten. Ändrar du avgiften gäller den nya förfrågningar och nya
            offertversioner; redan skickade och signerade offerter behåller sitt pris.
          </p>
        </section>

        <section className="admin-card table-card">
          <h2 className="card-title">Offert, betalning och notiser</h2>
          <p className="cell-muted">
            Hur förfrågningar blir offerter, hur länge de gäller och vart du får besked om nya förfrågningar
          </p>
          <div style={{ height: 16 }} />
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="cat-capacity">Max portioner per dag (tomt = ingen gräns)</label>
              <input id="cat-capacity" inputMode="numeric" value={settings.maxPortionsPerDay ?? ''}
                onChange={(e) => updateSettings({ maxPortionsPerDay: e.target.value.trim() ? numberIn(e.target.value) : null })} />
            </div>
            <div className="form-field">
              <label htmlFor="cat-valid">Offert gäller (dagar)</label>
              <input id="cat-valid" inputMode="numeric" value={settings.offerValidDays}
                onChange={(e) => updateSettings({ offerValidDays: numberIn(e.target.value) })} />
            </div>
            <div className="form-field">
              <label htmlFor="cat-terms-days">Betalningsvillkor företag (dagar)</label>
              <input id="cat-terms-days" inputMode="numeric" value={settings.paymentTermsDays}
                onChange={(e) => updateSettings({ paymentTermsDays: numberIn(e.target.value) })} />
            </div>
            <div className="form-field">
              <label htmlFor="cat-expiry">Obesvarad förfrågan går ut efter (timmar)</label>
              <input id="cat-expiry" inputMode="numeric" value={settings.requestExpiryHours}
                onChange={(e) => updateSettings({ requestExpiryHours: numberIn(e.target.value) })} />
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

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Rabattnivåer</h2>
              <p className="cell-muted">
                Räknas på antal gäster. När nivån nås rabatteras alla rätter.
              </p>
            </div>
            <button
              type="button"
              className="btn primary"
              onClick={() => setTierModal({ mode: 'add' })}
            >
              + Ny rabattnivå
            </button>
          </div>
          {tierError && <p className="form-error" role="alert">{tierError}</p>}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nivå</th>
                  <th>Från antal gäster</th>
                  <th>Till antal gäster</th>
                  <th>Rabatt</th>
                  <th>Status</th>
                  <th>Aktiv</th>
                  <th>Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-strong">{t.name}</td>
                    <td>{t.fromPortions} gäster</td>
                    <td>{t.toPortions != null ? `${t.toPortions} gäster` : 'och uppåt'}</td>
                    <td>
                      {t.discountPercent > 0 ? (
                        <span className="cell-price">-{t.discountPercent} %</span>
                      ) : (
                        <span className="cell-muted">Ingen rabatt</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${t.active ? 'reserved' : 'cancelled-free'}`}>
                        {t.active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={t.active}
                        aria-label={`${t.name} aktiv`}
                        className="switch"
                        onClick={() => toggleTierActive(t.id)}
                      />
                    </td>
                    <td>
                      <span className="row-actions">
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
                          onClick={() => removeTier(t)}
                        >
                          Radera
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <details className="admin-card catering-preview-details">
          <summary>Förhandsvisning - så ser gästen kalkylen</summary>
        <div className="catering-preview-row">
          <section className="admin-card table-card catering-preview-card">
            <h2 className="card-title">Förhandsvisning · så ser kunden kalkylen</h2>
            <p className="cell-muted">
              Kunden väljer antal portioner per rätt - rabatten gäller alla rätter när nivån nås
            </p>
            <div style={{ height: 16 }} />

            <div className="catering-preview-head">
              <div>
                <p className="catering-total-portions">{totalPortions} portioner totalt</p>
                <p className="cell-muted">
                  Minst {orderRules.minPortions} - max {orderRules.maxPortions} portioner
                </p>
              </div>
              {currentTier && currentTier.discountPercent > 0 && (
                <span className="status-badge reserved">
                  {currentTier.name} · -{currentTier.discountPercent} % på alla rätter
                </span>
              )}
            </div>

            {dishes.length === 0 ? (
              <p className="cell-muted">Inga aktiva rätter i menyn ännu.</p>
            ) : (
              <ul className="catering-dish-list">
                {dishes.map((d) => {
                  const discounted = d.price * (1 - discountPercent / 100)
                  const q = qty(d.id)
                  return (
                    <li key={d.id} className="catering-dish-row">
                      <span className="catering-dish-swatch" aria-hidden="true">
                        {d.image ? (
                          <img src={d.image} alt="" />
                        ) : (
                          <span className="dish-placeholder">🍽</span>
                        )}
                      </span>
                      <div className="catering-dish-info">
                        <span className="cell-strong">{d.name}</span>
                        <span className="cell-muted">
                          {d.category === 'forratter'
                            ? 'Förrätter'
                            : d.category === 'varmratter'
                              ? 'Varmrätter'
                              : d.category === 'efterratter'
                                ? 'Efterrätter'
                                : 'Drycker'}
                        </span>
                      </div>
                      <div className="catering-dish-price">
                        {discountPercent > 0 ? (
                          <>
                            <span className="catering-price-original">
                              {krWhole(d.price)}
                            </span>
                            <span className="cell-price">{krPerUnit(discounted)}</span>
                          </>
                        ) : (
                          <span className="cell-price">{krPerUnit(d.price)}</span>
                        )}
                      </div>
                      <div className="catering-stepper">
                        <button
                          type="button"
                          className="catering-stepper-btn"
                          aria-label={`Ta bort en portion ${d.name}`}
                          disabled={q === 0}
                          onClick={() => setQty(d.id, q - 1)}
                        >
                          −
                        </button>
                        <span className="catering-stepper-value">{q}</span>
                        <button
                          type="button"
                          className="catering-stepper-btn"
                          aria-label={`Lägg till en portion ${d.name}`}
                          onClick={() => setQty(d.id, q + 1)}
                        >
                          +
                        </button>
                      </div>
                      <span className="catering-dish-total">
                        {q > 0 ? krWhole(discounted * q) : '-'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            <div style={{ height: 8 }} />
            <div className="catering-address-row">
              <div className="form-field">
                <label htmlFor="preview-address">Leveransadress</label>
                <input
                  id="preview-address"
                  value={previewAddress}
                  onChange={(e) => setPreviewAddress(e.target.value)}
                />
              </div>
              <span className={`status-badge ${previewBand ? 'reserved' : 'waiting'}`}>
                {previewAddress ? `${previewDistanceKm} km · ` : ''}
                {previewBand ? `Upp till ${previewBand.upToKm} km` : 'Utanför området'}
              </span>
            </div>
          </section>

          <aside className="catering-summary-panel">
            <p className="catering-summary-kicker">Kalkyl</p>
            <h2 className="catering-summary-title">
              Cateringbeställning · {totalPortions} portioner
            </h2>

            {totalPortions === 0 ? (
              <p className="catering-summary-empty">
                Lägg till portioner i förhandsvisningen för att se kalkylen.
              </p>
            ) : (
              <>
                <div className="catering-summary-lines">
                  {dishes
                    .filter((d) => qty(d.id) > 0)
                    .map((d) => (
                      <div key={d.id} className="catering-summary-line">
                        <span>
                          {d.name} ×{qty(d.id)}
                        </span>
                        <span>{krWhole(d.price * qty(d.id))}</span>
                      </div>
                    ))}
                </div>

                <div className="catering-summary-line catering-summary-subtotal">
                  <span>Delsumma</span>
                  <span>{krWhole(subtotal)}</span>
                </div>

                {discountAmount > 0 && currentTier && (
                  <div className="catering-summary-line catering-summary-discount">
                    <span>
                      Rabatt {currentTier.name} · -{currentTier.discountPercent} % på alla rätter
                    </span>
                    <span>-{krWhole(discountAmount)}</span>
                  </div>
                )}

                <div className="catering-summary-line">
                  <span>
                    Leverans, {previewDistanceKm} km
                  </span>
                  <span>{krWhole(deliveryPrice)}</span>
                </div>

                <div className="catering-summary-total">
                  <span>Totalt</span>
                  <span>{krWhole(total)}</span>
                </div>
                <p className="catering-summary-vat">Inkl. moms</p>

                {upcomingTier && portionsToUpcoming > 0 && (
                  <p className="catering-summary-upsell">
                    {portionsToUpcoming} portioner till ger {upcomingTier.name} (-
                    {upcomingTier.discountPercent} % på alla rätter)
                  </p>
                )}

                <p className="catering-summary-empty">
                  Förhandsvisning - gästerna skickar förfrågan från kalkylen på webbplatsen.
                </p>
              </>
            )}
          </aside>
        </div>
        </details>
      </main>

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
                  removeTier(editingTier)
                  setTierModal(null)
                }
              : undefined
          }
        />
      )}
    </>
  )
}
