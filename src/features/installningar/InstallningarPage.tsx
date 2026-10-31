import { errorText } from '../../shared/errors'
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
import { PrinterCard } from './PrinterCard'
import { PaymentsCard } from './PaymentsCard'
import { SpecialDaysCard } from './SpecialDaysCard'
import { TableRulesCard } from './TableRulesCard'
import { BookingTimeCard } from './BookingTimeCard'
import { BusinessHoursEditor } from './BusinessHoursEditor'
import { BokforingCard } from './BokforingCard'
import { AppearanceCard } from './AppearanceCard'
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
import { PhoneInput } from '../../shared/PhoneInput'
import { SkelBlock } from '../../shared/Skeleton'

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
type SettingsTab = 'profil' | 'personal' | 'betalningar' | 'notiser' | 'avbokning' | 'bestallning' | 'skrivare' | 'dagar' | 'bord' | 'statistik' | 'bokforing' | 'integritet' | 'utseende'

const TAB_LABEL: Record<SettingsTab, string> = {
  profil: 'Restaurang',
  personal: 'Personal',
  betalningar: 'Betalningar',
  notiser: 'Notiser',
  avbokning: 'Avbokning',
  bestallning: 'Beställning',
  skrivare: 'Skrivare',
  dagar: 'Avvikande dagar',
  bord: 'Bord',
  statistik: 'Statistik',
  bokforing: 'Bokföring',
  integritet: 'Integritet',
  utseende: 'Utseende och ljud',
}

/**
 * Inställningarna i fem grupper. Menyn visar först grupperna under varandra,
 * var och en med en rad om vad som finns där; ett klick öppnar gruppen och
 * dess delar, och "Alla inställningar" leder tillbaka. Texterna ska gå att
 * förstå utan att kunna systemet.
 */
const GROUPS: { id: string; label: string; hint: string; tabs: SettingsTab[] }[] = [
  { id: 'verksamhet', label: 'Verksamheten', hint: 'Namn, adress, öppettider, bord och personal', tabs: ['profil', 'dagar', 'bord', 'personal'] },
  { id: 'gaster', label: 'Gäster', hint: 'Sms och mejl till gästerna, avbokning och beställning', tabs: ['notiser', 'avbokning', 'bestallning', 'skrivare'] },
  { id: 'ekonomi', label: 'Ekonomi', hint: 'Ta betalt online och underlag till bokföringen', tabs: ['betalningar', 'bokforing'] },
  { id: 'data', label: 'Data och integritet', hint: 'Vad personalen ser i Statistik och gästernas uppgifter', tabs: ['statistik', 'integritet'] },
  { id: 'enhet', label: 'Den här enheten', hint: 'Ljust eller mörkt läge och klickljud på just den här skärmen', tabs: ['utseende'] },
]

/** En rad under varje del som säger vad man ställer in där. */
const TAB_HINT: Record<SettingsTab, string> = {
  profil: 'Namn, adress, telefon, e-post och öppettider',
  dagar: 'Helgdagar, stängt eller andra tider en viss dag',
  bord: 'Hur många gäster varje bord tar och vilka bord som kan ställas ihop',
  personal: 'Bjud in medarbetare och välj vad de får göra',
  notiser: 'Sms och mejl till gästerna, och mejl till er',
  avbokning: 'Kortgaranti och avgift om gästen inte kommer',
  bestallning: 'Avhämtning, beställning vid bordet och QR-koder',
  skrivare: 'Skrivaren i köket som skriver ut beställningarna',
  betalningar: 'Koppla Stripe så att gästerna kan betala online',
  bokforing: 'Exportera försäljningen till bokföringsprogrammet',
  statistik: 'Vad personalen får se och när lunchen slutar',
  integritet: 'Integritetspolicyn och gästernas uppgifter',
  utseende: 'Ljust eller mörkt läge och klickljud, bara på den här skärmen',
}

function initialTab(stripeReturn: string | null): SettingsTab {
  if (stripeReturn) return 'betalningar'
  const fromHash = window.location.hash.replace(/^#/, '') as SettingsTab
  return fromHash in TAB_LABEL ? fromHash : 'profil'
}

/** Grace period i 5-minuterssteg. Bokningslängden ställs in i kortet Bokningstid. */
const GRACE_MINUTES = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

/** Ett äldre värde utanför 15-60 min (t.ex. 0) visas som närmaste val och sparas så vid nästa spara. */
function clampGraceHours(hours: number): number {
  const minutes = Math.round((Number.isFinite(hours) ? hours : 0) * 12) * 5
  return Math.min(60, Math.max(15, minutes)) / 60
}

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
  // Menyn: grupplistan eller den öppna gruppens delar. Grupplistan hör till
  // fliken den öppnades vid, så byts fliken (ett klick, en länk eller guiden
  // via #flik) visas gruppen igen. Sidan börjar på grupplistan, utom när en
  // länk pekar på en viss del.
  const [menuAt, setMenuAt] = useState<SettingsTab | null>(() =>
    stripeReturn || window.location.hash ? null : initialTab(stripeReturn),
  )
  const menuOpen = menuAt === tab
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
        setGracePeriodHours(clampGraceHours(loc.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS))
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
            errorText(err, 'Kunde inte hämta platsen.'),
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
            errorText(err, 'Kunde inte hämta användarna.'),
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
      setLocationError(errorText(err, 'Kunde inte spara platsen.'))
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
      setRowError(errorText(err, 'Kunde inte ändra status.'))
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
      setRowError(errorText(err, 'Kunde inte ta bort användaren.'))
    } finally {
      setBusySub(null)
    }
  }

  const showTab = (t: SettingsTab) =>
    t === 'personal' || t === 'statistik' || t === 'bokforing' || t === 'integritet'
      ? isOwner
      : t === 'bestallning' || t === 'skrivare'
        ? Boolean(tenant?.entitlements.features.ordering)
        : true
  const tabGroups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter(showTab) })).filter((g) => g.tabs.length > 0)
  const activeGroup = tabGroups.find((g) => g.tabs.includes(tab))?.id ?? tabGroups[0]?.id
  const openGroup = tabGroups.find((g) => g.id === activeGroup)

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
      <div className="admin-main settings-main">
        <nav className="settings-nav" aria-label="Inställningar">
          {menuOpen || !openGroup ? (
            <ul className="settings-menu">
              {tabGroups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className={g.id === activeGroup ? 'settings-menu-item current' : 'settings-menu-item'}
                    onClick={() => {
                      setMenuAt(null)
                      if (g.id !== activeGroup) openTab(g.tabs[0])
                    }}
                  >
                    <span className="settings-menu-text">
                      <span className="settings-menu-title">{g.label}</span>
                      <span className="settings-menu-hint">{g.hint}</span>
                    </span>
                    <span className="settings-menu-arrow" aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="settings-group-view">
              <button type="button" className="settings-back" onClick={() => setMenuAt(tab)}>
                <span aria-hidden="true">‹</span> Alla inställningar
              </button>
              <p className="settings-group-name">{openGroup.label}</p>
              <div className="settings-tabs">
                {openGroup.tabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={tab === t ? 'active' : ''}
                    data-tour={`settings-tab-${t}`}
                    aria-current={tab === t ? 'page' : undefined}
                    onClick={() => openTab(t)}
                  >
                    <span className="settings-tab-title">{TAB_LABEL[t]}</span>
                    <span className="settings-tab-hint">{TAB_HINT[t]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>
        <div className="settings-body">
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
                    ? <SkelBlock w={200} h={14} />
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

          {tenant?.entitlements.features.ordering && tab === 'skrivare' && (
            <div className="settings-row">
              <PrinterCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
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

          {isOwner && tab === 'bokforing' && (
            <div className="settings-row">
              <BokforingCard key={locationId ?? 'none'} locationId={locationId} />
            </div>
          )}

          {isOwner && tab === 'integritet' && (
            <div className="settings-row">
              <PrivacyCard />
            </div>
          )}

          {tab === 'utseende' && (
            <div className="settings-row">
              <AppearanceCard />
            </div>
          )}
        </div>
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
