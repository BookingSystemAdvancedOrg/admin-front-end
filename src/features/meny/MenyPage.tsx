import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import { CATEGORY_LABEL } from './data'
import type { Dish } from './data'
import { DishModal } from './DishModal'
import type { DishFormValues } from './DishModal'
import {
  CATEGORY_TO_API,
  createMenuItem,
  deleteMenuItem,
  dishChanges,
  getPublicMenu,
  isMenuRoutesMissing,
  listMenuItems,
  MENU_ROUTES_MISSING_MESSAGE,
  publicToDish,
  toDish,
  updateMenuItem,
  uploadMenuImage,
} from './menuApi'
import type { MenuItemCreate } from './menuApi'
import './meny.css'

type ModalState = { mode: 'add' } | { mode: 'edit'; id: string } | null

/**
 * Figma: admin-meny-page (34:2). Kopplad mot det riktiga meny-API:t
 * (menuApi.ts) — rätterna hämtas från databasen per plats, och alla
 * ändringar (lägg till, redigera, aktiv-växel, radera) skrivs dit.
 *
 * Adminrutterna (/menu/items) är i skrivande stund inte deployade på API:t;
 * tills de är det faller sidan tillbaka på den publika menyn
 * (GET /locations/{id}/menu — deployad och fungerande) i skrivskyddat läge,
 * med en banner som förklarar varför.
 */
export default function MenyPage() {
  const { sub } = useAuth()
  const { locationId, resolving: resolvingLocation } = useLocationId(sub)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  /** Sant när adminrutterna saknas och publika menyn visas i stället. */
  const [readOnly, setReadOnly] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listMenuItems(locationId)
      .then((items) => {
        if (cancelled) return
        setDishes(items.map(toDish))
        setReadOnly(false)
      })
      .catch(async (err) => {
        if (cancelled) return
        if (isMenuRoutesMissing(err)) {
          // Adminlistan finns inte än — publika menyn är deployad och ger
          // åtminstone de aktiva rätterna, i skrivskyddat läge.
          try {
            const items = await getPublicMenu(locationId)
            if (cancelled) return
            setDishes(items.map(publicToDish))
            setReadOnly(true)
          } catch (fallbackErr) {
            if (!cancelled) {
              setLoadError(
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : 'Kunde inte hämta menyn.',
              )
            }
          }
        } else {
          setLoadError(
            err instanceof Error ? err.message : 'Kunde inte hämta menyn.',
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

  // Härledd i stället för att sättas synkront i effekten: "hämtar" gäller
  // medan platsen letas upp eller medan menyn för en känd plats laddas.
  const fetching = resolvingLocation || (Boolean(locationId) && loading)
  const activeCount = dishes.filter((d) => d.active).length
  const editingDish =
    modal?.mode === 'edit' ? dishes.find((d) => d.id === modal.id) ?? null : null
  const canEdit = Boolean(locationId) && !readOnly

  function replaceDish(updated: Dish) {
    setDishes((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
  }

  async function toggleActive(dish: Dish) {
    if (!locationId) return
    setRowError(null)
    setBusyId(dish.id)
    try {
      const saved = await updateMenuItem(locationId, dish.id, {
        active: !dish.active,
      })
      replaceDish(toDish(saved))
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte spara.')
    } finally {
      setBusyId(null)
    }
  }

  async function removeDish(dish: Dish) {
    if (!locationId) return
    if (!window.confirm(`Ta bort ${dish.name} permanent?`)) return
    setRowError(null)
    setBusyId(dish.id)
    try {
      await deleteMenuItem(locationId, dish.id)
      setDishes((prev) => prev.filter((d) => d.id !== dish.id))
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte ta bort rätten.')
    } finally {
      setBusyId(null)
    }
  }

  /** Kastar vidare till DishModal, som visar felet i dialogen. */
  async function handleSave(values: DishFormValues) {
    if (!locationId) {
      throw new Error(
        'Ingen restaurangplats är sparad än — spara restaurangprofilen under Inställningar först.',
      )
    }
    // Ny bild laddas upp till S3 först; rätten sparas med nyckeln vi får
    // tillbaka. Utan ny fil behålls den befintliga nyckeln.
    let imageKey = editingDish?.imageKey ?? ''
    if (values.imageFile) {
      imageKey = await uploadMenuImage(locationId, values.imageFile)
    }
    const desired: MenuItemCreate = {
      name: values.name,
      description: values.description,
      price: values.price,
      category: CATEGORY_TO_API[values.category],
      imageKey,
      active: values.active,
    }

    if (modal?.mode === 'edit' && editingDish) {
      // API:t kräver minst ett fält — en tom diff skickas aldrig.
      const updates = dishChanges(editingDish, desired)
      if (Object.keys(updates).length > 0) {
        const saved = await updateMenuItem(locationId, editingDish.id, updates)
        replaceDish(toDish(saved))
      }
    } else {
      const created = await createMenuItem(locationId, desired)
      setDishes((prev) => [...prev, toDish(created)])
    }
    setModal(null)
  }

  return (
    <>
      <AdminTopbar
        title="Meny"
        actions={
          <button
            type="button"
            className="btn primary"
            disabled={!canEdit}
            onClick={() => setModal({ mode: 'add' })}
          >
            + Lägg till rätt
          </button>
        }
      />
      <div className="admin-main">
        {!locationId && !resolvingLocation && (
          <p className="form-error" role="alert">
            Menyn kan inte hämtas: ingen restaurangplats är skapad än. Gå till
            Inställningar och spara restaurangprofilen först — menyn lagras per
            plats i API:t.
          </p>
        )}
        {readOnly && (
          <p className="form-error" role="alert">
            {MENU_ROUTES_MISSING_MESSAGE}
          </p>
        )}
        <section className="admin-card table-card">
          <div className="card-head">
            <h2 className="card-title">Menyrätter</h2>
            <span className="cell-muted">
              {fetching
                ? 'Hämtar meny…'
                : `${dishes.length} rätter · ${activeCount} aktiva`}
            </span>
          </div>
          {(loadError ?? rowError) && (
            <p className="form-error" role="alert">
              {loadError ?? rowError}
            </p>
          )}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th aria-label="Bild" />
                  <th>Rätt</th>
                  <th>Kategori</th>
                  <th>Pris</th>
                  <th>Aktiv</th>
                  <th>Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {Boolean(locationId) && !fetching && dishes.length === 0 && !loadError && (
                  <tr>
                    <td colSpan={6} className="cell-muted">
                      Inga rätter i menyn än.
                    </td>
                  </tr>
                )}
                {dishes.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.image ? (
                        <img className="dish-photo" src={d.image} alt={d.name} />
                      ) : (
                        <span className="dish-placeholder" aria-hidden="true">
                          🍽
                        </span>
                      )}
                    </td>
                    <td className="cell-strong">
                      {d.name}
                      {d.description && (
                        <div className="cell-muted">{d.description}</div>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge cat-${d.category}`}>
                        {CATEGORY_LABEL[d.category]}
                      </span>
                    </td>
                    <td className="cell-price">{d.price} kr</td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={d.active}
                        aria-label={`${d.name} aktiv`}
                        className="switch"
                        disabled={!canEdit || busyId === d.id}
                        onClick={() => toggleActive(d)}
                      />
                    </td>
                    <td>
                      <span className="row-actions">
                        <button
                          type="button"
                          className="link-action"
                          disabled={!canEdit || busyId === d.id}
                          onClick={() => setModal({ mode: 'edit', id: d.id })}
                        >
                          Redigera
                        </button>
                        <button
                          type="button"
                          className="link-action danger"
                          disabled={!canEdit || busyId === d.id}
                          onClick={() => removeDish(d)}
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
      </div>

      {modal && (
        <DishModal
          title={modal.mode === 'add' ? 'Lägg till rätt' : 'Redigera rätt'}
          initial={editingDish}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )
}
