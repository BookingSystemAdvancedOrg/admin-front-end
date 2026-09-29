import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import type { Dish } from '../meny/data'
import { getPublicMenu, listMenuItems, publicToDish, toDish } from '../meny/menuApi'
import { DiscountTierModal } from './DiscountTierModal'
import type { DiscountTierFormValues } from './DiscountTierModal'
import {
  DISCOUNT_SCOPE_LABEL,
  MOCK_DELIVERY_PRICING,
  MOCK_DISCOUNT_TIERS,
  MOCK_ORDER_RULES,
  nextTierAfter,
  tierFor,
} from './data'
import type { DeliveryPricing, DiscountTier, OrderRules } from './data'
import './cateringkalkyl.css'

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
 * Figma: admin-catering-page. Precis som avbokningspolicyn i Inställningar
 * (installningar/data.ts) finns ingen backend-rutt för reglerna, leverans-
 * priset eller rabattnivåerna än — allt är lokal mockdata som inte sparas
 * mellan sidladdningar. Rätterna i förhandsvisningen kommer däremot från det
 * RIKTIGA meny-API:t, så kalkylen räknar på riktiga priser.
 */
export default function CateringkalkylPage() {
  const { sub } = useAuth()
  const { locationId } = useLocationId(sub)

  const [dishes, setDishes] = useState<Dish[]>([])

  const [orderRules, setOrderRules] = useState<OrderRules>(MOCK_ORDER_RULES)
  const [delivery, setDelivery] = useState<DeliveryPricing>(MOCK_DELIVERY_PRICING)
  const [tiers, setTiers] = useState<DiscountTier[]>(MOCK_DISCOUNT_TIERS)
  const [saved, setSaved] = useState(false)

  const [tierModal, setTierModal] = useState<TierModalState>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [previewAddress, setPreviewAddress] = useState('Drottninggatan 52, Norrköping')
  const [sentNotice, setSentNotice] = useState(false)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listMenuItems(locationId)
      .then((items) => {
        if (!cancelled) setDishes(items.map(toDish).filter((d) => d.active))
      })
      .catch(async () => {
        // Adminrutten kanske inte är deployad — samma reservväg som MenyPage.
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
    setSaved(false)
    setOrderRules((prev) => ({ ...prev, ...patch }))
  }

  function updateDelivery(patch: Partial<DeliveryPricing>) {
    setSaved(false)
    setDelivery((prev) => ({ ...prev, ...patch }))
  }

  function qty(dishId: string): number {
    return quantities[dishId] ?? 0
  }

  function setQty(dishId: string, n: number) {
    setQuantities((prev) => ({ ...prev, [dishId]: Math.max(0, Math.round(n)) }))
  }

  function toggleTierActive(id: string) {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)))
  }

  function removeTier(tier: DiscountTier) {
    if (!window.confirm(`Ta bort ${tier.name}?`)) return
    setTiers((prev) => prev.filter((t) => t.id !== tier.id))
  }

  function handleSaveTier(values: DiscountTierFormValues) {
    if (tierModal?.mode === 'edit') {
      const id = tierModal.id
      setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...values } : t)))
    } else {
      setTiers((prev) => [...prev, { id: crypto.randomUUID(), ...values }])
    }
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

  // Illustrativa exempelavstånd — ingen riktig geokodning finns, så
  // förhandsvisningens "leveransadress" är bara en etikett, inte en riktig
  // beräkning. Skalat mot avståndsgränsen så exemplet alltid är rimligt.
  const previewDistanceKm = Math.max(1, Math.round(delivery.maxDistanceKm * 0.72))
  const withinDeliveryArea = previewDistanceKm <= delivery.maxDistanceKm
  const deliveryPrice =
    totalPortions === 0
      ? 0
      : withinDeliveryArea
        ? delivery.priceWithinLimit
        : delivery.priceBeyondLimit

  const total = subtotal - discountAmount + deliveryPrice

  const exampleNear = Math.max(1, Math.round(delivery.maxDistanceKm * 0.72))
  const exampleFar = Math.round(delivery.maxDistanceKm * 1.68)

  return (
    <>
      <AdminTopbar
        title="Cateringkalkyl"
        subtitle="Regler, rabattnivåer och leveranspriser för catering"
        actions={
          <span className="row-actions">
            {saved && <span className="save-notice">Sparat</span>}
            <button
              type="button"
              className="btn primary square"
              onClick={() => setSaved(true)}
            >
              Spara ändringar
            </button>
          </span>
        }
      />

      <main className="admin-main">
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
            <div className="toggle-row">
              <span className="toggle-row-label">Visa kalkylen för kunder på webbplatsen</span>
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
            <div style={{ height: 16 }} />
            <p className="calc-hint">
              Kunder kan inte skicka en beställning under minsta antal portioner.
            </p>
          </section>

          <section className="admin-card table-card">
            <h2 className="card-title">Leverans inom {delivery.area}</h2>
            <p className="cell-muted">Pris baseras på avstånd från restaurangen</p>
            <div style={{ height: 16 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="delivery-area">Leveransområde</label>
                <input
                  id="delivery-area"
                  value={delivery.area}
                  onChange={(e) => updateDelivery({ area: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label htmlFor="delivery-limit">Avståndsgräns</label>
                <input
                  id="delivery-limit"
                  inputMode="numeric"
                  value={`${delivery.maxDistanceKm} km`}
                  onChange={(e) =>
                    updateDelivery({
                      maxDistanceKm: Number(e.target.value.replace(/[^\d]/g, '')) || 0,
                    })
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="price-within">Pris upp till {delivery.maxDistanceKm} km</label>
                <input
                  id="price-within"
                  inputMode="numeric"
                  value={`${delivery.priceWithinLimit} kr`}
                  onChange={(e) =>
                    updateDelivery({
                      priceWithinLimit: Number(e.target.value.replace(/[^\d]/g, '')) || 0,
                    })
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="price-beyond">Pris över {delivery.maxDistanceKm} km</label>
                <input
                  id="price-beyond"
                  inputMode="numeric"
                  value={`${delivery.priceBeyondLimit} kr`}
                  onChange={(e) =>
                    updateDelivery({
                      priceBeyondLimit: Number(e.target.value.replace(/[^\d]/g, '')) || 0,
                    })
                  }
                />
              </div>
            </div>
            <div style={{ height: 16 }} />
            <div className="toggle-row">
              <span className="toggle-row-label">Tillåt leverans utanför {delivery.area}</span>
              <button
                type="button"
                role="switch"
                aria-checked={delivery.allowOutsideArea}
                aria-label={`Tillåt leverans utanför ${delivery.area}`}
                className="switch"
                onClick={() => updateDelivery({ allowOutsideArea: !delivery.allowOutsideArea })}
              />
            </div>
            <div style={{ height: 16 }} />
            <p className="calc-hint">
              Exempel: {exampleNear} km → {krWhole(delivery.priceWithinLimit)} · {exampleFar} km →{' '}
              {krWhole(delivery.priceBeyondLimit)}
            </p>
          </section>
        </div>

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Rabattnivåer</h2>
              <p className="cell-muted">
                Räknas på totalt antal portioner. När nivån nås rabatteras alla rätter.
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
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nivå</th>
                  <th>Från antal portioner</th>
                  <th>Till antal portioner</th>
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
                    <td>{t.fromPortions} st</td>
                    <td>
                      {t.toPortions != null
                        ? `${t.toPortions} st`
                        : `${orderRules.maxPortions} (max)`}
                    </td>
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

        <div className="catering-preview-row">
          <section className="admin-card table-card catering-preview-card">
            <h2 className="card-title">Förhandsvisning · så ser kunden kalkylen</h2>
            <p className="cell-muted">
              Kunden väljer antal portioner per rätt — rabatten gäller alla rätter när nivån nås
            </p>
            <div style={{ height: 16 }} />

            <div className="catering-preview-head">
              <div>
                <p className="catering-total-portions">{totalPortions} portioner totalt</p>
                <p className="cell-muted">
                  Minst {orderRules.minPortions} – max {orderRules.maxPortions} portioner
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
                        {q > 0 ? krWhole(discounted * q) : '–'}
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
              <span className={`status-badge ${withinDeliveryArea ? 'reserved' : 'waiting'}`}>
                {previewAddress ? `${previewDistanceKm} km · ` : ''}
                {withinDeliveryArea ? `Inom ${delivery.maxDistanceKm} km` : 'Utanför området'}
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
                    Leverans, {previewDistanceKm} km{' '}
                    {withinDeliveryArea ? `(inom ${delivery.maxDistanceKm} km)` : ''}
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

                <button
                  type="button"
                  className="catering-send-btn"
                  onClick={() => setSentNotice(true)}
                >
                  Skicka cateringförfrågan
                </button>
                {sentNotice && (
                  <p className="catering-summary-empty">
                    Det här är en förhandsvisning — riktiga beställningar tas emot när
                    kundsajtens cateringflöde är klart.
                  </p>
                )}
              </>
            )}
          </aside>
        </div>
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
