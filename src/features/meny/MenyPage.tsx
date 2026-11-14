import { errorText } from '../../shared/errors'
import { useEffect, useRef, useState } from 'react'
import { useLiveRefresh } from '../../shared/live'
import { ConflictError, isConflict } from '../../shared/merge'
import { ApiError } from '../../shared/api'
import { onPageAction, takePageAction } from '../../shared/nav'
import { CtaButton } from '../../shared/CtaButton'
import { StatTile } from '../../shared/motion/StatTile'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import { currentLocation, useTenant } from '../../shared/tenant'
import { DEFAULT_TIMEZONE } from '../installningar/data'
import { categoryName, DEFAULT_CATEGORIES } from './data'
import type { Dish, DishCategory, MenuCategoryEntry } from './data'
import { DishModal } from './DishModal'
import type { DishFormValues } from './DishModal'
import { CategoriesModal } from './CategoriesModal'
import {
  createMenuItem,
  deleteMenuItem,
  dishAsCreate,
  dishChanges,
  getMenuCategories,
  getPublicMenu,
  isMenuRoutesMissing,
  listMenuItems,
  MENU_ROUTES_MISSING_MESSAGE,
  publicToDish,
  putMenuCategories,
  toDish,
  updateMenuItem,
  uploadMenuImage,
} from './menuApi'
import type { MenuItemCreate } from './menuApi'
import { dishStatus, matchesStatus } from './schedule'
import type { StatusFilter } from './schedule'
import './meny.css'
import { ImageLightbox } from '../../shared/ImageLightbox'
import { DishRow } from './DishRow'
import { isCentre } from './imageFocus'
import { SkelBlock, SkelTableRows } from '../../shared/Skeleton'
import { ErrorNote } from '../../shared/ErrorNote'

/**
 * `base` är rätten som dialogen öppnades med (dina ändringar räknas mot den,
 * även när listan hämtas om under tiden); `updatedAt` den version som skickas
 * med sparningen (byts när en krock har lagts ihop med det senaste).
 */
type ModalState = { mode: 'add' } | { mode: 'edit'; id: string; base: Dish; updatedAt: string | undefined } | null

/**
 * Figma: admin-meny-page (34:2). Kopplad mot det riktiga meny-API:t
 * (menuApi.ts) - rätterna hämtas från databasen per plats, och alla
 * ändringar (lägg till, redigera, aktiv-växel, radera) skrivs dit.
 *
 * Adminrutterna (/menu/items) är i skrivande stund inte deployade på API:t;
 * tills de är det faller sidan tillbaka på den publika menyn
 * (GET /locations/{id}/menu - deployad och fungerande) i skrivskyddat läge,
 * med en banner som förklarar varför.
 */
export default function MenyPage() {
  const { sub } = useAuth()
  const { locationId, resolving: resolvingLocation } = useLocationId(sub)
  const timeZone = currentLocation(useTenant())?.timezone || DEFAULT_TIMEZONE
  // Schemats status räknas om varje minut, så badgen byter utan omladdning.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const [dishes, setDishes] = useState<Dish[]>([])
  /** Platsens kategorier i visningsordning; standard tills de hämtats. */
  const [categories, setCategories] = useState<MenuCategoryEntry[]>(DEFAULT_CATEGORIES)
  const [categoriesVersion, setCategoriesVersion] = useState(0)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  /** Sant när adminrutterna saknas och publika menyn visas i stället. */
  const [readOnly, setReadOnly] = useState(false)
  /** Rader med ett pågående anrop (reglage eller radering). */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const markBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  /** Rätten vars bild visas i stort (bildrutan). */
  const [preview, setPreview] = useState<Dish | null>(null)
  const [modal, setModal] = useState<ModalState>(() => (takePageAction('new-dish') ? { mode: 'add' } : null))
  // Kommandopaletten (⌘K) kan öppna formuläret direkt.
  useEffect(() => onPageAction('new-dish', () => setModal({ mode: 'add' })), [])

  const [filterName, setFilterName] = useState('')
  const [filterCategory, setFilterCategory] = useState<DishCategory | 'alla'>('alla')
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('alla')
  const [filterPriceMin, setFilterPriceMin] = useState('')
  const [filterPriceMax, setFilterPriceMax] = useState('')

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    // Kategorierna: utan svar (äldre API) gäller de fyra standard.
    getMenuCategories(locationId)
      .then((res) => {
        if (cancelled || !res.categories?.length) return
        setCategories(res.categories)
        setCategoriesVersion(res.version ?? 0)
      })
      .catch(() => undefined)
    listMenuItems(locationId)
      .then((items) => {
        if (cancelled) return
        setDishes(items.map(toDish))
        setReadOnly(false)
      })
      .catch(async (err) => {
        if (cancelled) return
        if (isMenuRoutesMissing(err)) {
          // Adminlistan finns inte än - publika menyn är deployad och ger
          // åtminstone de aktiva rätterna, i skrivskyddat läge.
          try {
            const items = await getPublicMenu(locationId)
            if (cancelled) return
            setDishes(items.map(publicToDish))
            setReadOnly(true)
          } catch (fallbackErr) {
            if (!cancelled) {
              setLoadError(
                errorText(fallbackErr, 'Kunde inte hämta menyn.'),
              )
            }
          }
        } else {
          setLoadError(
            errorText(err, 'Kunde inte hämta menyn.'),
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Levande: rätter och kategorier som en kollega eller en annan plats ändrar
  // syns av sig själva. Ett svar som hämtades före en egen ändring härifrån
  // (reglaget, en radering) skriver inte över den.
  const edits = useRef(0)
  useLiveRefresh(async () => {
    if (!locationId) return
    const at = edits.current
    const [items, cats] = await Promise.all([
      listMenuItems(locationId),
      getMenuCategories(locationId).catch(() => null),
    ])
    if (edits.current !== at) return
    setDishes(items.map(toDish))
    setLoadError(null)
    if (cats?.categories?.length) {
      setCategories(cats.categories)
      setCategoriesVersion(cats.version ?? 0)
    }
  }, { enabled: Boolean(locationId) && !readOnly && !loading })

  // Härledd i stället för att sättas synkront i effekten: "hämtar" gäller
  // medan platsen letas upp eller medan menyn för en känd plats laddas.
  const fetching = resolvingLocation || (Boolean(locationId) && loading)
  // "Aktiva" = syns för gäster just nu (växeln på och inom schemat).
  const visibleDishes = dishes.filter((d) => dishStatus(d, now) === 'active')
  const activeCount = visibleDishes.length
  const withImage = dishes.filter((d) => d.imageKey).length
  const avgPrice = activeCount
    ? Math.round(visibleDishes.reduce((sum, d) => sum + d.price, 0) / activeCount)
    : 0
  const tiles = [
    { label: 'Rätter på menyn', value: String(dishes.length), note: `${new Set(dishes.map((d) => d.category)).size} av ${categories.length} kategorier` },
    { label: 'Aktiva', value: String(activeCount), note: dishes.length ? `${dishes.length - activeCount} dolda` : undefined },
    { label: 'Med bild', value: String(withImage), note: dishes.length ? `${Math.round((withImage / dishes.length) * 100)} %` : undefined },
    { label: 'Snittpris', value: activeCount ? `${avgPrice} kr` : '-' },
  ]
  /** Rätten som den ser ut i listan nu (kan ha ändrats på annat håll sedan dialogen öppnades). */
  const editingDish =
    modal?.mode === 'edit' ? dishes.find((d) => d.id === modal.id) ?? null : null
  const editBase = modal?.mode === 'edit' ? modal.base : null
  const canEdit = Boolean(locationId) && !readOnly

  const dishCounts = dishes.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1
    return acc
  }, {})
  const toneOf = (id: string) => categories.findIndex((c) => c.categoryId === id)

  async function saveCategories(rows: { categoryId?: string; name: string }[], version: number) {
    if (!locationId) return
    const saved = await putMenuCategories(locationId, rows, version)
    edits.current += 1
    setCategories(saved.categories)
    setCategoriesVersion(saved.version)
    setCategoriesOpen(false)
  }

  /** Den senaste sparade kategorilistan (CategoriesModal lägger ihop vid 409). */
  async function latestCategories() {
    if (!locationId) throw new Error('Ingen plats vald.')
    const res = await getMenuCategories(locationId)
    const latest = { categories: res.categories?.length ? res.categories : DEFAULT_CATEGORIES, version: res.version ?? 0 }
    setCategories(latest.categories)
    setCategoriesVersion(latest.version)
    return latest
  }

  const priceMin = filterPriceMin.trim() ? Number(filterPriceMin) : null
  const priceMax = filterPriceMax.trim() ? Number(filterPriceMax) : null
  const hasActiveFilters =
    filterName.trim() !== '' ||
    filterCategory !== 'alla' ||
    filterStatus !== 'alla' ||
    priceMin !== null ||
    priceMax !== null
  const filteredDishes = dishes.filter((d) => {
    if (
      filterName.trim() &&
      !d.name.toLowerCase().includes(filterName.trim().toLowerCase())
    ) {
      return false
    }
    if (filterCategory !== 'alla' && d.category !== filterCategory) return false
    if (!matchesStatus(filterStatus, dishStatus(d, now))) return false
    if (priceMin !== null && Number.isFinite(priceMin) && d.price < priceMin) {
      return false
    }
    if (priceMax !== null && Number.isFinite(priceMax) && d.price > priceMax) {
      return false
    }
    return true
  })

  function clearFilters() {
    setFilterName('')
    setFilterCategory('alla')
    setFilterStatus('alla')
    setFilterPriceMin('')
    setFilterPriceMax('')
  }

  function replaceDish(updated: Dish) {
    edits.current += 1
    setDishes((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
  }

  /**
   * Reglaget byter direkt (optimistiskt); svarar API:t med fel går raden
   * tillbaka till hur den var och felet visas ovanför listan.
   */
  async function toggleActive(dish: Dish) {
    if (!locationId || busyIds.has(dish.id)) return
    const next = !dish.active
    setRowError(null)
    markBusy(dish.id, true)
    replaceDish({ ...dish, active: next })
    try {
      const saved = await updateMenuItem(locationId, dish.id, { active: next })
      replaceDish(toDish(saved))
    } catch (err) {
      setDishes((prev) => prev.map((d) => (d.id === dish.id && d.active === next ? { ...d, active: dish.active } : d)))
      setRowError(errorText(err, `Kunde inte ${next ? 'aktivera' : 'pausa'} ${dish.name}.`))
    } finally {
      markBusy(dish.id, false)
    }
  }

  async function removeDish(dish: Dish) {
    if (!locationId) return
    if (!window.confirm(`Ta bort ${dish.name} permanent?`)) return
    setRowError(null)
    markBusy(dish.id, true)
    try {
      await deleteMenuItem(locationId, dish.id)
      edits.current += 1
      setDishes((prev) => prev.filter((d) => d.id !== dish.id))
    } catch (err) {
      setRowError(errorText(err, 'Kunde inte ta bort rätten.'))
    } finally {
      markBusy(dish.id, false)
    }
  }

  /** Kastar vidare till DishModal, som visar felet i dialogen. */
  async function handleSave(values: DishFormValues) {
    if (!locationId) {
      throw new Error(
        'Ingen restaurangplats är sparad än - spara restaurangprofilen under Inställningar först.',
      )
    }
    // Ny bild laddas upp till S3 först; rätten sparas med nyckeln vi får
    // tillbaka. Utan ny fil behålls den befintliga nyckeln; bilden är
    // frivillig, så en ny rätt utan bild sparas utan nyckel.
    let imageKey: string | null = values.removeImage ? null : editBase?.imageKey || null
    if (values.imageFile) {
      imageKey = await uploadMenuImage(locationId, values.imageFile)
    }
    const desired: MenuItemCreate = {
      name: values.name,
      description: values.description,
      price: values.price,
      category: values.category,
      imageKey,
      active: values.active,
      alcohol: values.alcohol,
      availableFrom: values.availableFrom,
      availableUntil: values.availableUntil,
      station: values.station,
      components: values.components,
      allergens: values.allergens,
      options: values.options,
    }
    // Fokuspunkten skickas bara när den inte är mitten (ny rätt) eller när
    // den ändrats (dishChanges), så äldre API:er utan fältet inte påverkas.
    if (!isCentre(values.imageFocus) || editBase?.imageFocus) {
      desired.imageFocus = values.imageFocus
    }

    if (modal?.mode === 'edit') {
      const base = modal.base
      // Bara det du ändrat sedan dialogen öppnades; API:t kräver minst ett fält.
      const updates = dishChanges(base, desired)
      if (Object.keys(updates).length > 0) {
        try {
          // updatedAt som dialogen laddade: har någon annan sparat sedan dess blir det 409.
          replaceDish(toDish(await updateMenuItem(locationId, base.id, updates, modal.updatedAt)))
        } catch (err) {
          if (!isConflict(err)) throw err
          // Någon annan sparade rätten emellan: hämta den, lägg dina fält ovanpå och spara en gång till.
          const latest = (await listMenuItems(locationId)).map(toDish).find((d) => d.id === base.id)
          if (!latest) throw new ApiError(404, 'Rätten finns inte längre; den har tagits bort på en annan plats.')
          replaceDish(latest)
          const theirs = dishChanges(base, dishAsCreate(latest)) as Record<string, unknown>
          const clashes = Object.entries(updates)
            .filter(([field, mine]) => field in theirs && JSON.stringify(theirs[field]) !== JSON.stringify(mine))
            .map(([field, mine]) => ({ field, mine, theirs: theirs[field] }))
          if (clashes.length) {
            // Nästa sparning går mot den senaste versionen; ditt värde står kvar i fältet.
            setModal({ ...modal, updatedAt: latest.updatedAt })
            throw new ConflictError(clashes, latest)
          }
          replaceDish(toDish(await updateMenuItem(locationId, base.id, updates, latest.updatedAt)))
        }
      }
    } else {
      const { imageKey: key, ...rest } = desired
      const created = await createMenuItem(locationId, key ? desired : (rest as MenuItemCreate))
      edits.current += 1
      setDishes((prev) => [...prev, toDish(created)])
    }
    setModal(null)
  }

  return (
    <>
      <AdminTopbar
        title="Meny"
        actions={
          <>
          <button type="button" className="btn outline square" disabled={!canEdit} onClick={() => setCategoriesOpen(true)}>
            Kategorier
          </button>
          <CtaButton
            label="+ Lägg till rätt"
            win="Kör!"
            data-tour="menu-add"
            disabled={!canEdit}
            onClick={() => setModal({ mode: 'add' })}
          />
          </>
        }
      />
      <div className="admin-main">
        {!locationId && !resolvingLocation && (
          <p className="form-error" role="alert">
            Ingen plats än. Spara restaurangen under Inställningar först.
          </p>
        )}
        {readOnly && (
          <ErrorNote text={MENU_ROUTES_MISSING_MESSAGE} />
        )}
        <section className="stats-row" aria-label="Menyns siffror">
          {tiles.map((t, i) => (
            <StatTile key={t.label} {...t} loading={fetching} index={i} />
          ))}
        </section>
        <section className="admin-card table-card">
          <div className="card-head">
            <h2 className="card-title">Menyrätter</h2>
            <span className="cell-muted">
              {fetching
                ? <SkelBlock w={150} h={14} />
                : hasActiveFilters
                  ? `${filteredDishes.length} av ${dishes.length}`
                  : null}
            </span>
          </div>
          <div className="meny-filters">
            <div className="form-field">
              <label htmlFor="menu-filter-name">Sök</label>
              <input
                id="menu-filter-name"
                placeholder="Sök på namn…"
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="menu-filter-category">Kategori</label>
              <select
                id="menu-filter-category"
                value={filterCategory}
                onChange={(e) =>
                  setFilterCategory(e.target.value as DishCategory | 'alla')
                }
              >
                <option value="alla">Alla kategorier</option>
                {categories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="menu-filter-status">Status</label>
              <select
                id="menu-filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
              >
                <option value="alla">Alla</option>
                <option value="active">Aktiva</option>
                <option value="scheduled">Schemalagda</option>
                <option value="expired">Utgångna</option>
                <option value="inactive">Inaktiva</option>
              </select>
            </div>
            {hasActiveFilters && (
              <div className="form-field meny-filters-clear">
                <label aria-hidden="true">&nbsp;</label>
                <button type="button" className="btn outline square" onClick={clearFilters}>
                  Rensa filter
                </button>
              </div>
            )}
          </div>
          {(loadError ?? rowError) && (
            <ErrorNote text={loadError ?? rowError} />
          )}
          <div className="table-scroll">
            <table className="data-table meny-table">
              <thead>
                <tr>
                  <th aria-label="Bild" />
                  <th>Rätt</th>
                  <th>Kategori</th>
                  <th>Pris</th>
                  <th>Status</th>
                  <th className="right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {fetching && <SkelTableRows n={5} cols={6} />}
                {Boolean(locationId) && !fetching && dishes.length === 0 && !loadError && (
                  <tr>
                    <td colSpan={6} className="cell-muted">
                      Inga rätter än.
                    </td>
                  </tr>
                )}
                {Boolean(locationId) &&
                  !fetching &&
                  dishes.length > 0 &&
                  filteredDishes.length === 0 &&
                  !loadError && (
                    <tr>
                      <td colSpan={6} className="cell-muted">
                        Inga rätter matchar filtret.
                      </td>
                    </tr>
                  )}
                {filteredDishes.map((d, index) => (
                  <DishRow
                    key={d.id}
                    dish={d}
                    index={index}
                    now={now}
                    timeZone={timeZone}
                    canEdit={canEdit}
                    busy={busyIds.has(d.id)}
                    locationId={locationId}
                    onOpen={(dish) => setModal({ mode: 'edit', id: dish.id, base: dish, updatedAt: dish.updatedAt })}
                    onToggle={toggleActive}
                    onDelete={removeDish}
                    onPreview={setPreview}
                    categoryLabel={categoryName(categories, d.category)}
                    categoryTone={toneOf(d.category)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {modal && (
        <DishModal
          key={modal.mode === 'edit' ? modal.id : 'new'}
          title={modal.mode === 'add' ? 'Lägg till rätt' : 'Redigera rätt'}
          initial={editBase}
          latest={editingDish}
          timeZone={timeZone}
          locationId={locationId}
          categories={categories}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
      {categoriesOpen && (
        <CategoriesModal
          categories={categories}
          version={categoriesVersion}
          dishCounts={dishCounts}
          onSave={saveCategories}
          fetchLatest={latestCategories}
          onCancel={() => setCategoriesOpen(false)}
        />
      )}
      {preview?.image && (
        <ImageLightbox src={preview.image} alt={preview.name} onClose={() => setPreview(null)} />
      )}
    </>
  )
}
