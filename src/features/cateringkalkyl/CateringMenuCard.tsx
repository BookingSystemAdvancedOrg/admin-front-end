import { useCallback, useEffect, useState } from 'react'
import { ApiError, isApiConfigured } from '../../shared/api'
import { getPublicMenu, listMenuItems } from '../meny/menuApi'
import {
  ALLERGENS,
  ALLERGEN_LABEL,
  DIETARY,
  DIETARY_LABEL,
  deleteCateringDish,
  deleteCateringPackage,
  errorText,
  getPublicCateringMenu,
  listCateringDishes,
  listCateringPackages,
  saveCateringDish,
  saveCateringPackage,
} from '../catering/cateringApi'
import type {
  Allergen,
  CateringDish,
  CateringDishInput,
  CateringPackage,
  CateringPackageInput,
  Dietary,
} from '../catering/cateringApi'
import { parseKronor } from './data'

const kr = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 })

function menuError(err: unknown): string {
  if (err instanceof ApiError && err.message === 'changed_retry') {
    return 'Någon annan sparade just en ändring. Listan är uppdaterad, försök igen.'
  }
  return errorText(err)
}

function dishInput(d: CateringDish): CateringDishInput {
  const { dishId: _id, version: _v, ...rest } = d
  return rest
}

type Modal =
  | { kind: 'dish'; dish: CateringDish | null }
  | { kind: 'package'; pkg: CateringPackage | null }
  | { kind: 'import' }
  | { kind: 'delete'; label: string; run: () => Promise<void> }
  | null

/**
 * Cateringmenyn: egna rätter (pris per portion, allergener, kost) och paket
 * (pris per gäst) i catering-menu-tabellen, skilda från den vanliga menyn.
 * "Hämta från menyn" kopierar rätter hit; ändringar i menyn följer inte med.
 * Bara ägaren ändrar; personalen ser det gästerna ser.
 */
export function CateringMenuCard({ locationId, isOwner }: { locationId: string | null; isOwner: boolean }) {
  const [dishes, setDishes] = useState<CateringDish[]>([])
  const [packages, setPackages] = useState<CateringPackage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)

  const reload = useCallback(async () => {
    if (!locationId) return
    if (isOwner) {
      const [d, p] = await Promise.all([listCateringDishes(locationId), listCateringPackages(locationId)])
      setDishes(d)
      setPackages(p)
    } else {
      const m = await getPublicCateringMenu(locationId)
      setDishes(m.dishes)
      setPackages(m.packages)
    }
  }, [locationId, isOwner])

  useEffect(() => {
    reload().catch(() => setError('Kunde inte hämta cateringmenyn.'))
  }, [reload])

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await action()
      return true
    } catch (err) {
      setError(menuError(err))
      return false
    } finally {
      await reload().catch(() => undefined)
    }
  }

  const dishName = (id: string) => dishes.find((d) => d.dishId === id)?.name ?? 'Borttagen rätt'

  return (
    <section className="admin-card table-card">
      <div className="card-head">
        <div>
          <h2 className="card-title">Cateringmeny</h2>
          <p className="cell-muted">
            Rätter och paket som gästen kan välja i kalkylen. Skild från den vanliga menyn.
          </p>
        </div>
        {isOwner && locationId && (
          <span className="cm-head-actions">
            <button type="button" className="btn outline" onClick={() => setModal({ kind: 'import' })}>
              Hämta från menyn
            </button>
            <button type="button" className="btn outline" onClick={() => setModal({ kind: 'package', pkg: null })}
              disabled={dishes.length === 0}>
              + Nytt paket
            </button>
            <button type="button" className="btn primary" onClick={() => setModal({ kind: 'dish', dish: null })}>
              + Ny rätt
            </button>
          </span>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      <h3 className="cm-subtitle">Rätter</h3>
      {dishes.length === 0 ? (
        <p className="cm-empty">
          Inga cateringrätter än. Skapa en ny rätt eller hämta rätter från den vanliga menyn.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rätt</th>
                <th>Pris per portion</th>
                <th>Allergener</th>
                <th>Status</th>
                {isOwner && <th>Aktiv</th>}
                {isOwner && <th>Åtgärder</th>}
              </tr>
            </thead>
            <tbody>
              {dishes.map((d) => (
                <tr key={d.dishId}>
                  <td>
                    <span className="cell-strong">{d.name}</span>
                    {d.dietary.length > 0 && (
                      <span className="cm-tags">{d.dietary.map((x) => DIETARY_LABEL[x]).join(' · ')}</span>
                    )}
                  </td>
                  <td className="cell-price">{kr.format(d.pricePerPortion)} kr</td>
                  <td className="cm-allergens">
                    {d.allergens.length ? d.allergens.map((a) => ALLERGEN_LABEL[a]).join(', ') : <span className="cell-muted">Inga</span>}
                  </td>
                  <td>
                    <span className={`status-badge ${d.active ? 'reserved' : 'cancelled-free'}`}>
                      {d.active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  {isOwner && (
                    <td>
                      <button type="button" role="switch" aria-checked={d.active} aria-label={`${d.name} aktiv`}
                        className="switch"
                        onClick={() => void run(() => saveCateringDish(locationId!, { ...dishInput(d), active: !d.active }, d))} />
                    </td>
                  )}
                  {isOwner && (
                    <td>
                      <span className="row-actions">
                        <button type="button" className="link-action" onClick={() => setModal({ kind: 'dish', dish: d })}>
                          Redigera
                        </button>
                        <button type="button" className="link-action danger"
                          onClick={() => setModal({ kind: 'delete', label: d.name,
                            run: async () => { await deleteCateringDish(locationId!, d.dishId) } })}>
                          Radera
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="cm-subtitle">Paket</h3>
      {packages.length === 0 ? (
        <p className="cm-empty">Inga paket än. Ett paket är flera rätter till ett pris per gäst.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Paket</th>
                <th>Pris per gäst</th>
                <th>Rätter</th>
                <th>Minst</th>
                <th>Status</th>
                {isOwner && <th>Åtgärder</th>}
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.packageId}>
                  <td className="cell-strong">{p.name}</td>
                  <td className="cell-price">{kr.format(p.pricePerGuest)} kr</td>
                  <td className="cm-allergens">{p.dishIds.map(dishName).join(', ')}</td>
                  <td>{p.minGuests ? `${p.minGuests} gäster` : <span className="cell-muted">-</span>}</td>
                  <td>
                    <span className={`status-badge ${p.active ? 'reserved' : 'cancelled-free'}`}>
                      {p.active ? 'Aktivt' : 'Inaktivt'}
                    </span>
                  </td>
                  {isOwner && (
                    <td>
                      <span className="row-actions">
                        <button type="button" className="link-action" onClick={() => setModal({ kind: 'package', pkg: p })}>
                          Redigera
                        </button>
                        <button type="button" className="link-action danger"
                          onClick={() => setModal({ kind: 'delete', label: p.name,
                            run: async () => { await deleteCateringPackage(locationId!, p.packageId) } })}>
                          Radera
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'dish' && locationId && (
        <DishModal dish={modal.dish} nextSort={dishes.length} onCancel={() => setModal(null)}
          onSave={async (input) => {
            if (await run(() => saveCateringDish(locationId, input, modal.dish ?? undefined))) setModal(null)
          }} />
      )}
      {modal?.kind === 'package' && locationId && (
        <PackageModal pkg={modal.pkg} dishes={dishes} nextSort={packages.length} onCancel={() => setModal(null)}
          onSave={async (input) => {
            if (await run(() => saveCateringPackage(locationId, input, modal.pkg ?? undefined))) setModal(null)
          }} />
      )}
      {modal?.kind === 'import' && locationId && (
        <ImportModal locationId={locationId} dishes={dishes} onCancel={() => setModal(null)}
          onImport={async (inputs) => {
            const done = await run(async () => {
              // En i taget: varje rätt är en egen skrivning (fel på en stoppar resten).
              for (const [i, input] of inputs.entries()) {
                await saveCateringDish(locationId, { ...input, sort: dishes.length + i })
              }
            })
            if (done) setModal(null)
          }} />
      )}
      {modal?.kind === 'delete' && (
        <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label={`Radera ${modal.label}`}>
            <h2>Radera {modal.label}?</h2>
            <p className="modal-text">
              Redan skickade offerter påverkas inte. Det går inte att ångra.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn outline square" autoFocus onClick={() => setModal(null)}>Avbryt</button>
              <button type="button" className="btn danger-outline square"
                onClick={() => { const m = modal; setModal(null); void run(m.run) }}>
                Radera
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function useEscape(onCancel: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function ModalShell({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  useEscape(onCancel)
  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal cm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function DishModal({ dish, nextSort, onSave, onCancel }: {
  dish: CateringDish | null
  nextSort: number
  onSave: (input: CateringDishInput) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(dish?.name ?? '')
  const [description, setDescription] = useState(dish?.description ?? '')
  const [price, setPrice] = useState(dish ? String(dish.pricePerPortion).replace('.', ',') : '')
  const [allergens, setAllergens] = useState<Allergen[]>(dish?.allergens ?? [])
  const [dietary, setDietary] = useState<Dietary[]>(dish?.dietary ?? [])
  const [active, setActive] = useState(dish?.active ?? true)
  const [saving, setSaving] = useState(false)
  const parsed = parseKronor(price)
  const valid = name.trim() !== '' && parsed !== null

  async function save() {
    if (!valid || parsed === null) return
    setSaving(true)
    await onSave({ name: name.trim(), description: description.trim(), pricePerPortion: parsed,
      allergens: ALLERGENS.filter((a) => allergens.includes(a)), dietary: DIETARY.filter((d) => dietary.includes(d)),
      active, sort: dish?.sort ?? nextSort, ...(dish?.sourceMenuItemId ? { sourceMenuItemId: dish.sourceMenuItemId } : {}) })
    setSaving(false)
  }

  return (
    <ModalShell title={dish ? 'Redigera rätt' : 'Ny cateringrätt'} onCancel={onCancel}>
      <div className="form-field">
        <label htmlFor="cm-dish-name">Namn</label>
        <input id="cm-dish-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="cm-dish-desc">Beskrivning (valfri)</label>
        <textarea id="cm-dish-desc" rows={2} maxLength={500} value={description}
          onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="cm-dish-price">Pris per portion (kr inkl. moms)</label>
        <input id="cm-dish-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
          aria-invalid={price !== '' && parsed === null} />
        {price !== '' && parsed === null && <p className="field-hint">Ange 0-10 000 kr, högst två decimaler.</p>}
      </div>
      <fieldset className="cm-fieldset">
        <legend>Allergener</legend>
        <div className="cm-checks">
          {ALLERGENS.map((a) => (
            <label key={a} className="cm-check">
              <input type="checkbox" checked={allergens.includes(a)} onChange={() => setAllergens(toggle(allergens, a))} />
              {ALLERGEN_LABEL[a]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="cm-fieldset">
        <legend>Kost</legend>
        <div className="cm-checks">
          {DIETARY.map((d) => (
            <label key={d} className="cm-check">
              <input type="checkbox" checked={dietary.includes(d)} onChange={() => setDietary(toggle(dietary, d))} />
              {DIETARY_LABEL[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="toggle-row">
        <span className="toggle-row-label" id="cm-dish-active">Aktiv (gästerna kan välja rätten)</span>
        <button type="button" role="switch" aria-checked={active} aria-labelledby="cm-dish-active" className="switch"
          onClick={() => setActive((a) => !a)} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn outline square" onClick={onCancel}>Avbryt</button>
        <button type="button" className="btn primary square" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? 'Sparar…' : 'Spara rätt'}
        </button>
      </div>
    </ModalShell>
  )
}

function PackageModal({ pkg, dishes, nextSort, onSave, onCancel }: {
  pkg: CateringPackage | null
  dishes: CateringDish[]
  nextSort: number
  onSave: (input: CateringPackageInput) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(pkg?.name ?? '')
  const [description, setDescription] = useState(pkg?.description ?? '')
  const [price, setPrice] = useState(pkg ? String(pkg.pricePerGuest).replace('.', ',') : '')
  const [minGuests, setMinGuests] = useState(pkg?.minGuests ? String(pkg.minGuests) : '')
  const [dishIds, setDishIds] = useState<string[]>(pkg?.dishIds.filter((id) => dishes.some((d) => d.dishId === id)) ?? [])
  const [active, setActive] = useState(pkg?.active ?? true)
  const [saving, setSaving] = useState(false)
  const parsed = parseKronor(price)
  const min = minGuests.trim() === '' ? undefined : Number(minGuests.replace(/[^\d]/g, ''))
  const minValid = min === undefined || (min >= 1 && min <= 5000)
  const valid = name.trim() !== '' && parsed !== null && dishIds.length > 0 && dishIds.length <= 40 && minValid

  async function save() {
    if (!valid || parsed === null) return
    setSaving(true)
    await onSave({ name: name.trim(), description: description.trim(), pricePerGuest: parsed,
      dishIds: dishes.filter((d) => dishIds.includes(d.dishId)).map((d) => d.dishId),
      ...(min !== undefined ? { minGuests: min } : {}), active, sort: pkg?.sort ?? nextSort })
    setSaving(false)
  }

  return (
    <ModalShell title={pkg ? 'Redigera paket' : 'Nytt paket'} onCancel={onCancel}>
      <div className="form-field">
        <label htmlFor="cm-pkg-name">Namn</label>
        <input id="cm-pkg-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="cm-pkg-desc">Beskrivning (valfri)</label>
        <textarea id="cm-pkg-desc" rows={2} maxLength={500} value={description}
          onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="cm-pkg-price">Pris per gäst (kr inkl. moms)</label>
          <input id="cm-pkg-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            aria-invalid={price !== '' && parsed === null} />
        </div>
        <div className="form-field">
          <label htmlFor="cm-pkg-min">Minsta antal gäster (valfritt)</label>
          <input id="cm-pkg-min" inputMode="numeric" value={minGuests} onChange={(e) => setMinGuests(e.target.value)}
            aria-invalid={!minValid} />
        </div>
      </div>
      {price !== '' && parsed === null && <p className="field-hint">Ange 0-10 000 kr, högst två decimaler.</p>}
      <fieldset className="cm-fieldset">
        <legend>Rätter i paketet</legend>
        <div className="cm-checks cm-checks--wide">
          {dishes.map((d) => (
            <label key={d.dishId} className="cm-check">
              <input type="checkbox" checked={dishIds.includes(d.dishId)} onChange={() => setDishIds(toggle(dishIds, d.dishId))} />
              {d.name}{!d.active && <span className="cell-muted"> (inaktiv)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="toggle-row">
        <span className="toggle-row-label" id="cm-pkg-active">Aktivt (gästerna kan välja paketet)</span>
        <button type="button" role="switch" aria-checked={active} aria-labelledby="cm-pkg-active" className="switch"
          onClick={() => setActive((a) => !a)} />
      </div>
      <p className="field-note">Paketet visas bara för gäster när alla dess rätter är aktiva.</p>
      <div className="modal-actions">
        <button type="button" className="btn outline square" onClick={onCancel}>Avbryt</button>
        <button type="button" className="btn primary square" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? 'Sparar…' : 'Spara paket'}
        </button>
      </div>
    </ModalShell>
  )
}

interface MenuChoice {
  id: string
  name: string
  description: string
  price: number
}

// Utan API: några rätter att prova "Hämta från menyn" med.
const MOCK_MENU: MenuChoice[] = [
  { id: 'm1', name: 'Köttbullar med potatismos', description: 'Lingon och pressgurka', price: 135 },
  { id: 'm2', name: 'Caesarsallad', description: 'Kyckling, krutonger, parmesan', price: 125 },
  { id: 'm3', name: 'Vegetarisk lasagne', description: 'Spenat och ricotta', price: 120 },
]

function ImportModal({ locationId, dishes, onImport, onCancel }: {
  locationId: string
  dishes: CateringDish[]
  onImport: (inputs: CateringDishInput[]) => Promise<void>
  onCancel: () => void
}) {
  const [menu, setMenu] = useState<MenuChoice[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const copied = new Set(dishes.map((d) => d.sourceMenuItemId).filter(Boolean))

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<MenuChoice[]> {
      if (!isApiConfigured()) return MOCK_MENU
      try {
        // Alkohol hör inte till catering.
        return (await listMenuItems(locationId)).filter((m) => m.active && !m.alcohol)
          .map((m) => ({ id: m.menuItemId, name: m.name, description: m.description, price: Number(m.price) }))
      } catch {
        return (await getPublicMenu(locationId)).filter((m) => !m.alcohol)
          .map((m) => ({ id: m.menuItemId, name: m.name, description: m.description ?? '', price: Number(m.price) }))
      }
    }
    load().then((m) => !cancelled && setMenu(m)).catch(() => !cancelled && setMenu([]))
    return () => {
      cancelled = true
    }
  }, [locationId])

  async function save() {
    const chosen = (menu ?? []).filter((m) => picked.includes(m.id))
    setSaving(true)
    await onImport(chosen.map((m) => ({ name: m.name.slice(0, 120), description: m.description.slice(0, 500),
      pricePerPortion: m.price, allergens: [], dietary: [], active: true, sort: 0, sourceMenuItemId: m.id })))
    setSaving(false)
  }

  return (
    <ModalShell title="Hämta från menyn" onCancel={onCancel}>
      <p className="modal-subtitle">
        Rätterna kopieras med namn, beskrivning och pris. Ändringar i menyn följer inte med, och allergener lägger du
        till efteråt.
      </p>
      {menu === null ? (
        <p className="cell-muted">Hämtar menyn…</p>
      ) : menu.length === 0 ? (
        <p className="cm-empty">Menyn har inga aktiva rätter att hämta.</p>
      ) : (
        <div className="cm-checks cm-checks--wide">
          {menu.map((m) => (
            <label key={m.id} className="cm-check">
              <input type="checkbox" disabled={copied.has(m.id)} checked={copied.has(m.id) || picked.includes(m.id)}
                onChange={() => setPicked(toggle(picked, m.id))} />
              <span>
                {m.name} <span className="cell-muted">{copied.has(m.id) ? 'redan hämtad' : `${kr.format(m.price)} kr`}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn outline square" onClick={onCancel}>Avbryt</button>
        <button type="button" className="btn primary square" disabled={picked.length === 0 || saving}
          onClick={() => void save()}>
          {saving ? 'Hämtar…' : picked.length > 1 ? `Hämta ${picked.length} rätter` : picked.length === 1 ? 'Hämta rätten' : 'Hämta'}
        </button>
      </div>
    </ModalShell>
  )
}
