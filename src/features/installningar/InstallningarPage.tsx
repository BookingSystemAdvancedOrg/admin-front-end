import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import {
  MOCK_BOOKING_DURATION_HOURS,
  MOCK_BUSINESS_HOURS,
  MOCK_GRACE_PERIOD_HOURS,
  MOCK_POLICY,
  MOCK_PROFILE,
  MOCK_STRIPE,
  MOCK_TIMEZONE,
} from './data'
import type { CancellationPolicy, RestaurantProfile } from './data'
import { BusinessHoursEditor } from './BusinessHoursEditor'
import {
  createLocation,
  getLocation,
  locationChanges,
  updateLocation,
  validateAddress,
  validateBookingDuration,
  validateBusinessHours,
  validateGracePeriod,
  validateName as validateLocationName,
  validateTimezone,
} from './locationApi'
import type { BusinessHours, LocationCreateRequest } from './locationApi'
import { StaffModal } from './StaffModal'
import type { StaffFormValues } from './StaffModal'
import {
  ROLE_TO_GROUP,
  canManageTarget,
  changeUserGroup,
  deactivateUser,
  deleteUser,
  inviteUser,
  listUsers,
  reactivateUser,
  updateUserProfile,
} from './usersApi'
import type { User } from './usersApi'

const ROLE_LABEL: Record<User['role'], string> = {
  staff: 'Personal',
  owner_user: 'Ägare',
  super_admin: 'Systemadmin',
}

// Det finns ingen "hämta min plats"-endpoint, bara GET /locations/{id} - så
// vi minns vilken plats som hör till den här restaurangen lokalt, i väntan
// på en riktigare koppling (t.ex. platsen på den inloggades User-post).
const LOCATION_ID_STORAGE_KEY = 'admin-location-id'

type ModalState = { mode: 'invite' } | { mode: 'edit'; user: User } | null

/**
 * Figma: admin-installningar-page (43:2).
 *
 * Restaurangprofil är kopplad mot det riktiga /locations-API:t: första
 * "Spara ändringar" skapar platsen (POST /locations) och minns dess ID
 * lokalt, därefter uppdaterar den platsen (PUT /locations/{id}) med bara
 * de fält som faktiskt ändrats. Plats-ID:t är också det layout-editorn
 * behöver för att kunna spara.
 *
 * Personal & behörigheter går mot det riktiga /users/*-API:t (usersApi.ts);
 * listan hämtas från GET /users vid sidladdning.
 *
 * Betalningar/Avbokningspolicy kör fortfarande på ren mockdata.
 */
export default function InstallningarPage() {
  const { sub, groups } = useAuth()
  const [profile, setProfile] = useState<RestaurantProfile>(MOCK_PROFILE)
  const [timezone, setTimezone] = useState(MOCK_TIMEZONE)
  const [businessHours, setBusinessHours] = useState<BusinessHours>(MOCK_BUSINESS_HOURS)
  const [bookingDurationHours, setBookingDurationHours] = useState(
    MOCK_BOOKING_DURATION_HOURS,
  )
  const [gracePeriodHours, setGracePeriodHours] = useState(MOCK_GRACE_PERIOD_HOURS)
  const [locationId, setLocationId] = useState<string | null>(() =>
    localStorage.getItem(LOCATION_ID_STORAGE_KEY),
  )
  const [locationError, setLocationError] = useState<string | null>(null)
  const [savingLocation, setSavingLocation] = useState(false)
  // Senast sparade värden, för att kunna skicka bara det som ändrats i PUT:en.
  const [savedLocation, setSavedLocation] = useState<LocationCreateRequest | null>(
    null,
  )

  const [policy, setPolicy] = useState<CancellationPolicy>(MOCK_POLICY)
  const [staff, setStaff] = useState<User[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [modal, setModal] = useState<ModalState>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [busySub, setBusySub] = useState<string | null>(null)

  const caller = { sub, groups }
  const canManageStaff = groups.includes('owner_user') || groups.includes('super_user')

  // En plats är redan skapad - hämta den riktiga datan istället för att
  // visa kvarvarande mockvärden.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setProfile((prev) => ({ ...prev, name: loc.name, address: loc.address }))
        setTimezone(loc.timezone)
        setBusinessHours(loc.businessHours)
        setBookingDurationHours(loc.bookingDurationHours)
        setGracePeriodHours(loc.gracePeriodHours)
        setSavedLocation({
          name: loc.name,
          address: loc.address,
          timezone: loc.timezone,
          businessHours: loc.businessHours,
          bookingDurationHours: loc.bookingDurationHours,
          gracePeriodHours: loc.gracePeriodHours,
        })
      })
      .catch((err) => {
        if (!cancelled) {
          setLocationError(
            err instanceof Error ? err.message : 'Kunde inte hämta platsen.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Hämta hela användarlistan från GET /users vid sidladdning.
  useEffect(() => {
    let cancelled = false
    listUsers()
      .then((users) => {
        if (!cancelled) setStaff(users)
      })
      .catch((err) => {
        if (!cancelled) {
          setStaffError(
            err instanceof Error ? err.message : 'Kunde inte hämta användarna.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setStaffLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  async function handleSaveAll() {
    setSaved(false)
    setLocationError(null)

    const firstError =
      validateLocationName(profile.name) ??
      validateAddress(profile.address) ??
      validateTimezone(timezone) ??
      validateBookingDuration(bookingDurationHours) ??
      validateGracePeriod(gracePeriodHours) ??
      validateBusinessHours(businessHours)
    if (firstError) {
      setLocationError(firstError)
      return
    }

    const values: LocationCreateRequest = {
      name: profile.name.trim(),
      address: profile.address.trim(),
      timezone: timezone.trim(),
      businessHours,
      bookingDurationHours,
      gracePeriodHours,
    }

    setSavingLocation(true)
    try {
      if (locationId && savedLocation) {
        // API:t kräver minst ett fält i uppdateringen, så en tom diff får
        // aldrig skickas iväg.
        const updates = locationChanges(savedLocation, values)
        if (Object.keys(updates).length === 0) {
          setSaved(true)
          return
        }
        await updateLocation(locationId, updates)
        setSavedLocation(values)
      } else {
        const created = await createLocation(values)
        setLocationId(created.locationId)
        localStorage.setItem(LOCATION_ID_STORAGE_KEY, created.locationId)
        setSavedLocation(values)
      }
      setSaved(true)
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Kunde inte spara platsen.')
    } finally {
      setSavingLocation(false)
    }
  }

  function replaceStaff(updated: User) {
    setStaff((prev) =>
      prev.map((s) => (s.cognitoSub === updated.cognitoSub ? updated : s)),
    )
  }

  async function handleSave(values: StaffFormValues) {
    if (modal?.mode === 'invite') {
      const created = await inviteUser(values)
      setStaff((prev) => [...prev, created])
      setModal(null)
      return
    }
    if (modal?.mode === 'edit') {
      const original = modal.user
      const profileUpdates: Record<string, string> = {}
      if (values.name !== original.name) profileUpdates.name = values.name
      if (values.email !== original.email) profileUpdates.email = values.email
      if (values.phone !== original.phone) profileUpdates.phone = values.phone

      const roleChanged = values.group !== ROLE_TO_GROUP[original.role]
      if (!roleChanged && values.locationId !== original.locationId) {
        profileUpdates.locationId = values.locationId
      }

      let updated = original
      if (Object.keys(profileUpdates).length > 0) {
        updated = await updateUserProfile(original.cognitoSub, profileUpdates)
      }
      if (roleChanged) {
        updated = await changeUserGroup(original.cognitoSub, {
          group: values.group,
          locationId: values.locationId,
        })
      }
      replaceStaff(updated)
      setModal(null)
    }
  }

  async function handleToggleStatus(user: User) {
    setRowError(null)
    setBusySub(user.cognitoSub)
    try {
      const updated =
        user.status === 'active'
          ? await deactivateUser(user.cognitoSub)
          : await reactivateUser(user.cognitoSub)
      replaceStaff(updated)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte ändra status.')
    } finally {
      setBusySub(null)
    }
  }

  async function handleDelete(user: User) {
    if (!window.confirm(`Ta bort ${user.name} permanent?`)) return
    setRowError(null)
    setBusySub(user.cognitoSub)
    try {
      await deleteUser(user.cognitoSub)
      setStaff((prev) => prev.filter((s) => s.cognitoSub !== user.cognitoSub))
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Kunde inte ta bort användaren.')
    } finally {
      setBusySub(null)
    }
  }

  return (
    <>
      <AdminTopbar
        title="Inställningar"
        actions={
          <span className="row-actions">
            {saved && <span className="save-notice">Sparat</span>}
            <button
              type="button"
              className="btn primary square"
              disabled={savingLocation}
              onClick={handleSaveAll}
            >
              {savingLocation ? 'Sparar…' : 'Spara ändringar'}
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
                {locationId
                  ? `Plats-ID: ${locationId} — ändringar sparas med "Spara ändringar".`
                  : 'Grundläggande information om din restaurang. Sparas som en ny plats i backend, och krävs innan layouten kan sparas.'}
              </p>
            </div>
          </div>
          {locationError && (
            <p className="form-error" role="alert">
              {locationError}
            </p>
          )}
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
            <div className="form-field">
              <label htmlFor="rp-timezone">Tidszon</label>
              <input
                id="rp-timezone"
                value={timezone}

                placeholder="Europe/Stockholm"
                onChange={(e) => {
                  setSaved(false)
                  setTimezone(e.target.value)
                }}
              />
            </div>
            <div className="form-field">
              <label htmlFor="rp-duration">Bokningslängd (timmar)</label>
              <input
                id="rp-duration"
                inputMode="decimal"
                value={bookingDurationHours}
                onChange={(e) => {
                  setSaved(false)
                  setBookingDurationHours(Number(e.target.value) || 0)
                }}
              />
            </div>
            <div className="form-field">
              <label htmlFor="rp-grace">Grace period (timmar)</label>
              <input
                id="rp-grace"
                inputMode="decimal"
                value={gracePeriodHours}
                onChange={(e) => {
                  setSaved(false)
                  setGracePeriodHours(Number(e.target.value) || 0)
                }}
              />
            </div>
          </div>
          <div style={{ height: 20 }} />
          <p className="form-section-label">Öppettider</p>
          <div style={{ height: 8 }} />
          <BusinessHoursEditor
            value={businessHours}
            onChange={(next) => {
              setSaved(false)
              setBusinessHours(next)
            }}
          />
        </section>

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Personal &amp; behörigheter</h2>
              <p className="cell-muted">
                {staffLoading
                  ? 'Hämtar användare…'
                  : `${staff.length} användare, varav ${
                      staff.filter((s) => s.status === 'active').length
                    } aktiva`}
              </p>
            </div>
            {canManageStaff && (
              <button
                type="button"
                className="btn primary square"
                onClick={() => setModal({ mode: 'invite' })}
              >
                + Bjud in personal
              </button>
            )}
          </div>
          {(staffError ?? rowError) && (
            <p className="form-error" role="alert">
              {staffError ?? rowError}
            </p>
          )}
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
                {!staffLoading && staff.length === 0 && !staffError && (
                  <tr>
                    <td colSpan={5} className="cell-muted">
                      Inga användare att visa än.
                    </td>
                  </tr>
                )}
                {staff.map((s) => {
                  const canEdit = canManageTarget(caller, s, 'profile')
                  const statusAction = s.status === 'active' ? 'deactivate' : 'reactivate'
                  const canToggleStatus = canManageTarget(caller, s, statusAction)
                  const canDelete = canManageTarget(caller, s, 'delete')
                  const busy = busySub === s.cognitoSub
                  return (
                    <tr key={s.cognitoSub}>
                      <td className="cell-strong">{s.name}</td>
                      <td>{ROLE_LABEL[s.role]}</td>
                      <td className="cell-muted">{s.email}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            s.status === 'active' ? 'reserved' : 'cancelled'
                          }`}
                        >
                          {s.status === 'active' ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      </td>
                      <td>
                        <span className="row-actions">
                          {canEdit && (
                            <button
                              type="button"
                              className="link-action"
                              disabled={busy}
                              onClick={() => setModal({ mode: 'edit', user: s })}
                            >
                              Redigera
                            </button>
                          )}
                          {canToggleStatus && (
                            <button
                              type="button"
                              className="link-action"
                              disabled={busy}
                              onClick={() => handleToggleStatus(s)}
                            >
                              {s.status === 'active' ? 'Inaktivera' : 'Aktivera'}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              className="link-action danger"
                              disabled={busy}
                              onClick={() => handleDelete(s)}
                            >
                              Ta bort
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
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

      {modal && (
        <StaffModal
          title={modal.mode === 'invite' ? 'Bjud in personal' : 'Redigera användare'}
          initial={modal.mode === 'edit' ? modal.user : null}
          callerGroups={groups}
          lockRole={modal.mode === 'edit' && modal.user.cognitoSub === sub}
          defaultLocationId={locationId ?? undefined}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )
}
