import { useState } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import {
  MOCK_HOURS,
  MOCK_POLICY,
  MOCK_PROFILE,
  MOCK_STAFF,
  MOCK_STRIPE,
} from './data'
import type { CancellationPolicy, RestaurantProfile } from './data'

/**
 * Figma: admin-installningar-page (43:2). Kör på mockdata (lokal state)
 * tills API:t kopplas — "Spara ändringar" sparar bara i webbläsarens minne.
 */
export default function InstallningarPage() {
  const [profile, setProfile] = useState<RestaurantProfile>(MOCK_PROFILE)
  const [policy, setPolicy] = useState<CancellationPolicy>(MOCK_POLICY)
  const [saved, setSaved] = useState(false)

  function updateProfile(field: keyof RestaurantProfile, value: string) {
    setSaved(false)
    setProfile((prev) => ({ ...prev, [field]: value }))
  }

  function updatePolicyNumber(
    field: 'lateFee' | 'noShowFee' | 'freeCancelHours',
    value: string,
  ) {
    setSaved(false)
    const n = Number(value.replace(/[^\d]/g, ''))
    setPolicy((prev) => ({ ...prev, [field]: Number.isNaN(n) ? 0 : n }))
  }

  return (
    <>
      <AdminTopbar
        title="Inställningar"
        actions={
          <span className="row-actions">
            {saved && <span className="save-notice">Sparat (mock)</span>}
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
      <div className="admin-main">
        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Restaurangprofil</h2>
              <p className="cell-muted">
                Grundläggande information om din restaurang
              </p>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="rp-name">Namn</label>
              <input
                id="rp-name"
                value={profile.name}
                onChange={(e) => updateProfile('name', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="rp-phone">Telefon</label>
              <input
                id="rp-phone"
                value={profile.phone}
                onChange={(e) => updateProfile('phone', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="rp-address">Adress</label>
              <input
                id="rp-address"
                value={profile.address}
                onChange={(e) => updateProfile('address', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="rp-email">E-post</label>
              <input
                id="rp-email"
                type="email"
                value={profile.email}
                onChange={(e) => updateProfile('email', e.target.value)}
              />
            </div>
          </div>
          <div style={{ height: 20 }} />
          <p className="form-section-label">Öppettider</p>
          <div style={{ height: 8 }} />
          <div className="hours-list">
            {MOCK_HOURS.map((h) => (
              <div key={h.days} className="hours-row">
                <strong>{h.days}</strong>
                <span>{h.hours}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Personal &amp; behörigheter</h2>
              <p className="cell-muted">
                {MOCK_STAFF.length} användare kopplade till KÄLLA
              </p>
            </div>
            <button type="button" className="btn primary square">
              + Bjud in personal
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Namn</th>
                  <th>Roll</th>
                  <th>E-post</th>
                  <th>Status</th>
                  <th>Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_STAFF.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-strong">{s.name}</td>
                    <td>{s.role}</td>
                    <td className="cell-muted">{s.email}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          s.status === 'active' ? 'reserved' : 'invited'
                        }`}
                      >
                        {s.status === 'active' ? 'Aktiv' : 'Inbjuden'}
                      </span>
                    </td>
                    <td>
                      <span className="row-actions">
                        <button type="button" className="link-action">
                          Redigera
                        </button>
                        <button type="button" className="link-action danger">
                          Ta bort
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="settings-row">
          <section className="admin-card table-card">
            <h2 className="card-title">Betalningar</h2>
            <div style={{ height: 16 }} />
            <div className="stripe-status">
              <span
                className={`stripe-dot ${MOCK_STRIPE.connected ? 'ok' : ''}`}
                aria-hidden="true"
              />
              <div>
                <p className="stripe-title">
                  {MOCK_STRIPE.connected
                    ? 'Ansluten till Stripe'
                    : 'Ej ansluten till Stripe'}
                </p>
                <p className="cell-muted">Konto: {MOCK_STRIPE.accountLabel}</p>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <button type="button" className="btn outline square stripe-manage">
              Hantera i Stripe →
            </button>
          </section>

          <section className="admin-card table-card">
            <h2 className="card-title">Avbokningspolicy</h2>
            <div style={{ height: 16 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="pol-late">Avgift, sen avbokning</label>
                <input
                  id="pol-late"
                  value={`${policy.lateFee} kr`}
                  onChange={(e) => updatePolicyNumber('lateFee', e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="pol-noshow">Avgift, uteblivande</label>
                <input
                  id="pol-noshow"
                  value={`${policy.noShowFee} kr`}
                  onChange={(e) =>
                    updatePolicyNumber('noShowFee', e.target.value)
                  }
                />
              </div>
            </div>
            <div style={{ height: 16 }} />
            <div className="form-field">
              <label htmlFor="pol-hours">
                Framförhållning för fri avbokning (timmar)
              </label>
              <input
                id="pol-hours"
                value={policy.freeCancelHours}
                onChange={(e) =>
                  updatePolicyNumber('freeCancelHours', e.target.value)
                }
              />
            </div>
            <div style={{ height: 16 }} />
            <div className="toggle-row">
              <span className="toggle-row-label">
                Aktivera automatisk debitering
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={policy.autoCharge}
                aria-label="Aktivera automatisk debitering"
                className="switch"
                onClick={() => {
                  setSaved(false)
                  setPolicy((prev) => ({ ...prev, autoCharge: !prev.autoCharge }))
                }}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
