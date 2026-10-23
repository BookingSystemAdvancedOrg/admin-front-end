import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { InfoTooltip } from '../../shared/InfoTooltip'
import {
  DEFAULT_BOOKING_DURATION_HOURS,
  DEFAULT_GRACE_PERIOD_HOURS,
  DEFAULT_TIMEZONE,
  EMPTY_BUSINESS_HOURS,
  EMPTY_PROFILE,
} from './data'
import type { RestaurantProfile } from './data'
import { CancellationPolicyCard } from './CancellationPolicyCard'
import { InsightsSettingsCard } from './InsightsSettingsCard'
import { NotificationsCard } from './NotificationsCard'
import { OrderingCard } from './OrderingCard'
import { PrivacyCard } from './PrivacyCard'
import { PaymentsCard } from './PaymentsCard'
import { SpecialDaysCard } from './SpecialDaysCard'
import { TableRulesCard } from './TableRulesCard'
import { BookingTimeCard } from './BookingTimeCard'
import { BusinessHoursEditor } from './BusinessHoursEditor'
import {
  createLocation,
  getLocation,
  locationChanges,
  updateLocation,
  validateAddress,
  validateBookingDuration,
  validateBusinessHours,
  validateEmail,
  validateGracePeriod,
  validateName as validateLocationName,
  validatePhoneNumber,
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
import {
  clearLocationSummaryCache,
  resolveLocationId,
  useLocationId,
} from '../../shared/location'
import { useTenant } from '../../shared/tenant'
import { Loading } from '../../shared/Loading'
import { PhoneInput } from '../../shared/PhoneInput'

const ROLE_LABEL: Record<User['role'], string> = {
  staff: 'Personal',
  owner_user: 'Ägare',
}


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
 * listan hämtas från GET /list-users vid sidladdning. Ingen mockdata.
 *
 * Betalningar visar restaurangens riktiga Stripe-status (GET /tenant) och
 * öppnar Stripes onboarding. Avbokningspolicyn (kortgaranti, avgifter för
 * uteblivna gäster och sen avbokning) sparas per plats.
 *
 * Personal (staff_user) ser sin plats men kan inte ändra den eller hantera
 * andra användare - de rutterna är bara för ägare.
 */
/** Flikarna - en sektion i taget i stället för en lång sida. */
type SettingsTab = 'profil' | 'personal' | 'betalningar' | 'notiser' | 'avbokning' | 'bestallning' | 'dagar' | 'bord' | 'statistik' | 'integritet'

const TAB_LABEL: Record<SettingsTab, string> = {
  profil: 'Restaurang',
  personal: 'Personal',
  betalningar: 'Betalningar',
  notiser: 'Notiser',
  avbokning: 'Avbokning',
  bestallning: 'Beställning',
  dagar: 'Avvikande dagar',
  bord: 'Bord',
  statistik: 'Statistik',
  integritet: 'Integritet',
}

function initialTab(stripeReturn: string | null): SettingsTab {
  if (stripeReturn) return 'betalningar'
  const fromHash = window.location.hash.replace(/^#/, '') as SettingsTab
  return fromHash in TAB_LABEL ? fromHash : 'profil'
}

/** Grace period i 5-minuterssteg. Bokningslängden ställs in i kortet Bokningstid. */
const GRACE_MINUTES = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

export default function InstallningarPage() {
  const { sub, groups } = useAuth()
  const { tenant, refresh: refreshTenant } = useTenant()
  const [searchParams] = useSearchParams()
  const stripeReturn = searchParams.get('stripe')
  const [tab, setTab] = useState<SettingsTab>(() => initialTab(stripeReturn))
  // Länkar (och guiden) kan öppna en flik via #flik i adressen.
  const { hash } = useLocation()
  useEffect(() => {
    const fromHash = hash.replace(/^#/, '') as SettingsTab
    if (fromHash in TAB_LABEL) setTab(fromHash)
  }, [hash])
  function openTab(next: SettingsTab) {
    setTab(next)
    window.history.replaceState(null, '', `#${next}`)
  }
  const [profile, setProfile] = useState<RestaurantProfile>(EMPTY_PROFILE)
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [businessHours, setBusinessHours] =
    useState<BusinessHours>(EMPTY_BUSINESS_HOURS)
  const [bookingDurationHours, setBookingDurationHours] = useState(
    DEFAULT_BOOKING_DURATION_HOURS,
  )
  const [gracePeriodHours, setGracePeriodHours] = useState(
    DEFAULT_GRACE_PERIOD_HOURS,
  )
  // Lagras i timmar i API:t; väljs i minuter.
  const graceMinutes = Math.round(gracePeriodHours * 60)
  // Plats-ID:t kan saknas i den här webbläsaren även när platsen finns i
  // databasen - hooken letar då upp det via användarlistan.
  const { locationId, setLocationId, resolving: resolvingLocation } =
    useLocationId(sub)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [savingLocation, setSavingLocation] = useState(false)
  // Senast sparade värden, för att kunna skicka bara det som ändrats i PUT:en.
  const [savedLocation, setSavedLocation] = useState<LocationCreateRequest | null>(
    null,
  )

  const [staff, setStaff] = useState<User[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [modal, setModal] = useState<ModalState>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [busySub, setBusySub] = useState<string | null>(null)

  const caller = { sub, groups }
  // Rollen kommer från servern (GET /tenant), inte från klientens tolkning
  // av tokenens grupper.
  const isOwner = tenant?.role === 'owner_user'
  const canManageStaff = isOwner
  const locationOptions = (tenant?.locations ?? []).map((l) => ({
    locationId: l.locationId,
    name: l.name || 'Namnlös plats',
  }))

  // En plats är redan skapad - hämta den riktiga datan istället för att
  // visa kvarvarande mockvärden.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setProfile((prev) => ({
          ...prev,
          name: loc.name,
          address: loc.address,
          phone: loc.phoneNumber ?? '',
          email: loc.email ?? '',
        }))
        setTimezone(loc.timezone)
        setBusinessHours(loc.businessHours)
        setBookingDurationHours(loc.bookingDurationHours ?? DEFAULT_BOOKING_DURATION_HOURS)
        setGracePeriodHours(loc.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS)
        setSavedLocation({
          name: loc.name,
          address: loc.address,
          email: loc.email ?? '',
          phoneNumber: loc.phoneNumber ?? '',
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

  // Hämta restaurangens användare (bara ägare får lista dem).
  useEffect(() => {
    if (!isOwner) return
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
  }, [isOwner])

  function updateProfile(field: keyof RestaurantProfile, value: string) {
    setSaved(false)
    setProfile((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSaveAll() {
    setSaved(false)
    setLocationError(null)

    // Spara-knappen är spärrad medan platsen letas upp, men gardera ändå -
    // en sparning utan känt plats-id hade skapat en dubblettplats.
    if (resolvingLocation) return

    const firstError =
      validateLocationName(profile.name) ??
      validateAddress(profile.address) ??
      validateEmail(profile.email) ??
      validatePhoneNumber(profile.phone) ??
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
      email: profile.email.trim(),
      phoneNumber: profile.phone.trim(),
      timezone: timezone.trim(),
      businessHours,
      bookingDurationHours,
      gracePeriodHours,
    }

    setSavingLocation(true)
    try {
      if (locationId) {
        if (!savedLocation) {
          // Platsen finns men uppgifterna kunde inte hämtas - att ramla ner
          // i skapa-grenen här var det som gav dubblettplatser förr.
          setLocationError(
            'Platsens sparade uppgifter kunde inte hämtas - ladda om sidan och försök igen.',
          )
          return
        }
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
        // Sista koll mot servern innan något skapas: har restaurangen redan
        // en plats (t.ex. sparad från en annan enhet) ska den återanvändas,
        // aldrig dubbleras.
        const existing = await resolveLocationId(sub)
        if (existing) {
          setLocationId(existing)
          setLocationError(
            'Restaurangen har redan en sparad plats - uppgifterna hämtas nu. ' +
              'Kontrollera dem och spara igen.',
          )
          return
        }
        const created = await createLocation(values)
        setLocationId(created.locationId)
        setSavedLocation(values)
      }
      // Skalets namn/adress är cachade - töm så sidebar och topbar visar
      // de nya uppgifterna direkt i stället för de gamla.
      clearLocationSummaryCache()
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
      const roleChanged = values.group !== ROLE_TO_GROUP[original.role]

      const profileUpdates: Record<string, string> = {}
      if (values.name !== original.name) profileUpdates.name = values.name
      if (values.email !== original.email) profileUpdates.email = values.email
      if (values.phone !== original.phone) profileUpdates.phone = values.phone

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
          tab === 'profil' && <span className="row-actions">
            {saved && <span className="save-notice">Sparat</span>}
            <button
              type="button"
              className="btn primary square"
              data-tour="settings-save"
              disabled={savingLocation || resolvingLocation || !isOwner}
              title={isOwner ? undefined : 'Bara ägaren kan ändra restaurangens uppgifter'}
              onClick={handleSaveAll}
            >
              {savingLocation ? 'Sparar…' : 'Spara ändringar'}
            </button>
          </span>
        }
      />
      <div className="admin-main">
        <nav className="settings-tabs" aria-label="Inställningar">
          {(Object.keys(TAB_LABEL) as SettingsTab[])
            .filter((t) => (t === 'personal' || t === 'statistik' || t === 'integritet' ? isOwner : t === 'bestallning' ? Boolean(tenant?.entitlements.features.ordering) : true))
            .map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? 'active' : ''}
                data-tour={`settings-tab-${t}`}
                aria-current={tab === t ? 'page' : undefined}
                onClick={() => openTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
        </nav>
        {/* Flikar döljs (hidden) i stället för att tas bort - osparade ändringar ligger kvar. */}
        <section className="admin-card table-card" hidden={tab !== 'profil'}>
          <div className="card-head">
            <div>
              <h2 className="card-title">Restaurangprofil</h2>
              <p className="cell-muted">
                {resolvingLocation
                  ? 'Letar efter restaurangens plats…'
                  : locationId
                    ? isOwner
                      ? 'Namn, kontakt och öppettider. Spara med knappen uppe till höger.'
                      : 'Uppgifter för din plats. Bara ägaren kan ändra dem.'
                    : isOwner
                      ? 'Restaurangen har ingen plats än. Fyll i uppgifterna och spara för att skapa den första.'
                      : 'Du är inte kopplad till någon plats än. Be ägaren att koppla dig till en plats.'}
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
              <PhoneInput id="rp-phone" value={profile.phone} onChange={(v) => updateProfile('phone', v)} />
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
              <span className="form-field-label-row">
                <label htmlFor="rp-grace">Grace period (minuter)</label>
                <InfoTooltip label="Grace period (minuter)">
                  Hur länge bordet hålls om gästen är sen. Därefter blir bordet
                  ledigt igen.
                </InfoTooltip>
              </span>
              <select
                id="rp-grace"
                value={graceMinutes}
                onChange={(e) => {
                  setSaved(false)
                  setGracePeriodHours(Number(e.target.value) / 60)
                }}
              >
                {!GRACE_MINUTES.includes(graceMinutes) && (
                  <option value={graceMinutes}>{graceMinutes} min</option>
                )}
                {GRACE_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
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

        <div hidden={tab !== 'profil'}>
          <BookingTimeCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
        </div>

        {isOwner && (
        <section className="admin-card table-card" hidden={tab !== 'personal'}>
          <div className="card-head">
            <div>
              <h2 className="card-title">Personal &amp; behörigheter</h2>
              <p className="cell-muted">
                {staffLoading
                  ? <Loading variant="inline" label="Hämtar användare" />
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
                      <td>
                        {ROLE_LABEL[s.role] ?? s.role}
                        {s.role === 'staff' && (
                          <span className="cell-muted">
                            {' · '}
                            {locationOptions.find((l) => l.locationId === s.locationId)
                              ?.name ?? 'Ingen plats'}
                          </span>
                        )}
                      </td>
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
        )}

        <div className="settings-row" hidden={tab !== 'betalningar'}>
          {tenant && (
            <PaymentsCard
              tenant={tenant}
              isOwner={isOwner}
              stripeReturn={stripeReturn}
              onRefresh={refreshTenant}
            />
          )}
        </div>

        <div className="settings-row" hidden={tab !== 'notiser'}>
          {tenant && (
            <NotificationsCard
              key={`${tenant.tenantId}:${JSON.stringify(tenant.notifications)}:${tenant.senderName ?? ''}`}
              tenant={tenant}
              isOwner={isOwner}
            />
          )}
        </div>

        <div className="settings-row" hidden={tab !== 'avbokning'}>
          <CancellationPolicyCard
            key={locationId ?? 'none'}
            locationId={locationId}
            isOwner={isOwner}
            stripeReady={Boolean(tenant?.stripe.chargesEnabled)}
          />
        </div>

        {tenant?.entitlements.features.ordering && (
          <div className="settings-row" hidden={tab !== 'bestallning'}>
            <OrderingCard
              key={locationId ?? 'none'}
              locationId={locationId}
              isOwner={isOwner}
              stripeReady={Boolean(tenant?.stripe.chargesEnabled)}
            />
          </div>
        )}

        <div className="settings-row" hidden={tab !== 'dagar'}>
          <SpecialDaysCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
        </div>

        <div className="settings-row" hidden={tab !== 'bord'}>
          <TableRulesCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
        </div>

        {isOwner && tenant && (
          <div className="settings-row" hidden={tab !== 'statistik'}>
            <InsightsSettingsCard
              key={`${locationId ?? 'none'}:${tenant.insights?.staffAccess ?? 'operations'}`}
              tenant={tenant}
              locationId={locationId}
            />
          </div>
        )}

        {isOwner && tab === 'integritet' && (
          <div className="settings-row">
            <PrivacyCard />
          </div>
        )}
      </div>

      {modal && (
        <StaffModal
          title={modal.mode === 'invite' ? 'Bjud in personal' : 'Redigera användare'}
          initial={modal.mode === 'edit' ? modal.user : null}
          callerGroups={groups}
          lockRole={modal.mode === 'edit' && modal.user.cognitoSub === sub}
          locations={locationOptions}
          defaultLocationId={locationId ?? undefined}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )
}
