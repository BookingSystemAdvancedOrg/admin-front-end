import { useState } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { CATEGORY_LABEL, MOCK_DISHES } from './data'
import type { Dish } from './data'
import { DishModal } from './DishModal'
import type { DishFormValues } from './DishModal'
import './meny.css'

type ModalState = { mode: 'add' } | { mode: 'edit'; id: string } | null

/**
 * Figma: admin-meny-page (34:2). Kör på mockdata (lokal state) tills API:t
 * kopplas. Rätter läggs till och redigeras i en popup med valfri bild,
 * kategori, pris och aktiv-status.
 */
export default function MenyPage() {
  const [dishes, setDishes] = useState<Dish[]>(MOCK_DISHES)
  const [modal, setModal] = useState<ModalState>(null)

  const activeCount = dishes.filter((d) => d.active).length
  const editingDish =
    modal?.mode === 'edit'
      ? dishes.find((d) => d.id === modal.id) ?? null
      : null

  function toggleActive(id: string) {
    setDishes((prev) =>
      prev.map((d) => (d.id === id ? { ...d, active: !d.active } : d)),
    )
  }

  function removeDish(id: string) {
    setDishes((prev) => prev.filter((d) => d.id !== id))
  }

  function handleSave(values: DishFormValues) {
    if (modal?.mode === 'edit') {
      setDishes((prev) =>
        prev.map((d) => (d.id === modal.id ? { ...d, ...values } : d)),
      )
    } else {
      setDishes((prev) => [...prev, { id: `d${Date.now()}`, ...values }])
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
            onClick={() => setModal({ mode: 'add' })}
          >
            + Lägg till rätt
          </button>
        }
      />
      <div className="admin-main">
        <section className="admin-card table-card">
          <div className="card-head">
            <h2 className="card-title">Menyrätter</h2>
            <span className="cell-muted">
              {dishes.length} rätter · {activeCount} aktiva
            </span>
          </div>
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
                {dishes.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.image ? (
                        <img
                          className="dish-photo"
                          src={d.image}
                          alt={d.name}
                        />
                      ) : (
                        <span className="dish-placeholder" aria-hidden="true">
                          🍽
                        </span>
                      )}
                    </td>
                    <td className="cell-strong">{d.name}</td>
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
                        onClick={() => toggleActive(d.id)}
                      />
                    </td>
                    <td>
                      <span className="row-actions">
                        <button
                          type="button"
                          className="link-action"
                          onClick={() => setModal({ mode: 'edit', id: d.id })}
                        >
                          Redigera
                        </button>
                        <button
                          type="button"
                          className="link-action danger"
                          onClick={() => removeDish(d.id)}
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
