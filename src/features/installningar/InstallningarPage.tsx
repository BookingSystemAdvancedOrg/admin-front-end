import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import { dedupe, sameData, useLiveRefresh } from '../../shared/live'
import { ChangedNote } from '../../shared/ChangedNote'
import { CtaButton } from '../../shared/CtaButton'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
import { DesktopAppCard } from './DesktopAppCard'
import { PlanCard } from './PlanCard'
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
import {
  clearLocationSummaryCache,
  resolveLocationId,
  useLocationId,
} from '../../shared/location'
import { hasFeature, useTenant } from '../../shared/tenant'
import { Slot } from '../../shared/slots'
import { PhoneInput } from '../../shared/PhoneInput'
import { ErrorNote } from '../../shared/ErrorNote'
import { Select } from '../../shared/Select'


/**
 * Figma: admin-installningar-page (43:2).
 *
 * Restaurangprofil är kopplad mot det riktiga /locations-API:t: första
 * "Spara ändringar" skapar platsen (POST /locations) och minns dess ID
 * lokalt, därefter uppdaterar den platsen (PUT /locations/{id}) med bara
 * de fält som faktiskt ändrats. Plats-ID:t är också det layout-editorn
 * behöver för att kunna spara.
 *
 * Personalen hanteras på egen sida (/personal, features/personal).
 *
 * Betalningar visar restaurangens riktiga Stripe-status (GET /tenant) och
 * öppnar Stripes onboarding. Avbokningspolicyn (kortgaranti, avgifter för
 * uteblivna gäster och sen avbokning) sparas per plats.
 *
 * Personal (staff_user) ser sin plats men kan inte ändra den eller hantera
 * andra användare - de rutterna är bara för ägare.
 */
/** Flikarna - en sektion i taget i stället för en lång sida. */
type SettingsTab = 'profil' | 'betalningar' | 'notiser' | 'avbokning' | 'bestallning' | 'skrivare' | 'dagar' | 'bord' | 'statistik' | 'bokforing' | 'integritet' | 'utseende'

const TAB_LABEL: Record<SettingsTab, string> = {
  profil: 'Restaurang',
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
 * Inställningarna i fem grupper. Menyn visar först grupperna under varandra;
 * ett klick öppnar gruppen och dess delar, och "Alla inställningar" leder
 * tillbaka. Bara namnen syns, så att menyn går att läsa med en blick.
 */
const GROUPS: { id: string; label: string; tabs: SettingsTab[] }[] = [
  { id: 'verksamhet', label: 'Verksamheten', tabs: ['profil', 'dagar', 'bord'] },
  { id: 'gaster', label: 'Gäster', tabs: ['notiser', 'avbokning', 'bestallning', 'skrivare'] },
  { id: 'ekonomi', label: 'Ekonomi', tabs: ['betalningar', 'bokforing'] },
  { id: 'data', label: 'Data och integritet', tabs: ['statistik', 'integritet'] },
  { id: 'enhet', label: 'Den här enheten', tabs: ['utseende'] },
]


/** En rad om vad varje del ställer in. Syns inte i menyn; hjälpassistenten läser den (scripts/help-corpus.mjs). */
export const TAB_HINT: Record<SettingsTab, string> = {
  profil: 'Namn, adress, telefon, e-post och öppettider',
  dagar: 'Helgdagar, stängt eller andra tider en viss dag',
  bord: 'Hur många gäster varje bord tar och vilka bord som kan ställas ihop',
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

/** Delar som har egen länk (#del) och fliken de ligger i. */
const SECTION_TAB: Record<string, SettingsTab> = { skrivbordsappen: 'utseende' }

/** #flik eller #del ur adressen, som flik; null om den inte finns. */
function tabFromHash(hash: string): SettingsTab | null {
  const id = hash.replace(/^#/, '')
  if (id in SECTION_TAB) return SECTION_TAB[id]
  return id in TAB_LABEL ? (id as SettingsTab) : null
}

function initialTab(stripeReturn: string | null): SettingsTab {
  if (stripeReturn) return 'betalningar'
  return tabFromHash(window.location.hash) ?? 'profil'
}

/** Grace period i 5-minuterssteg. Bokningslängden ställs in i kortet Bokningstid. */
const GRACE_MINUTES = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

/** Ett äldre värde utanför 15-60 min (t.ex. 0) visas som närmaste val och sparas så vid nästa spara. */
function clampGraceHours(hours: number): number {
  const minutes = Math.round((Number.isFinite(hours) ? hours : 0) * 12) * 5
  return Math.min(60, Math.max(15, minutes)) / 60
}

export default function InstallningarPage() {
  const { sub } = useAuth()
  const navigate = useNavigate()
  const { tenant, refresh: refreshTenant } = useTenant()
  const [searchParams] = useSearchParams()
  const stripeReturn = searchParams.get('stripe')
  const [tab, setTab] = useState<SettingsTab>(() => initialTab(stripeReturn))
  // Länkar (och guiden) kan öppna en flik via #flik i adressen.
  const { hash } = useLocation()
  useEffect(() => {
    // Personalen har flyttat till en egen sida; gamla länkar leds dit.
    if (hash === '#personal') navigate('/personal', { replace: true })
    else {
      const next = tabFromHash(hash)
      if (next) setTab(next)
    }
  }, [hash, navigate])
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

  const [saved, setSaved] = useState(false)

  // Rollen kommer från servern (GET /tenant), inte från klientens tolkning
  // av tokenens grupper.
  const isOwner = tenant?.role === 'owner_user'

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

  // Levande: ändrar en kollega eller en annan enhet platsen syns det av sig
  // självt. Fält du inte rört följer med; fält du ändrat står kvar och får en
  // rad med det andra värdet.
  const [drift, setDrift] = useState<Partial<LocationCreateRequest>>({})
  useLiveRefresh(async () => {
    if (!locationId || !savedLocation) return
    const loc = await dedupe(`location:${locationId}`, () => getLocation(locationId))
    const next: LocationCreateRequest = {
      name: loc.name, address: loc.address, email: loc.email ?? '', phoneNumber: loc.phoneNumber ?? '', timezone: loc.timezone,
      businessHours: loc.businessHours, bookingDurationHours: loc.bookingDurationHours, gracePeriodHours: loc.gracePeriodHours,
    }
    if (sameData(next, savedLocation)) return
    const current: LocationCreateRequest = {
      name: profile.name, address: profile.address, email: profile.email, phoneNumber: profile.phone, timezone,
      businessHours, bookingDurationHours, gracePeriodHours,
    }
    const notes: Partial<LocationCreateRequest> = {}
    for (const k of Object.keys(next) as (keyof LocationCreateRequest)[]) {
      if (sameData(next[k], savedLocation[k])) continue
      if (!sameData(current[k], savedLocation[k])) {
        if (!sameData(current[k], next[k])) (notes as Record<string, unknown>)[k] = next[k]
        continue
      }
      // Orört fält: ta det nya värdet.
      if (k === 'name' || k === 'address' || k === 'email') setProfile((p) => ({ ...p, [k]: next[k] }))
      else if (k === 'phoneNumber') setProfile((p) => ({ ...p, phone: next.phoneNumber ?? '' }))
      else if (k === 'timezone') setTimezone(next.timezone)
      else if (k === 'businessHours') setBusinessHours(next.businessHours)
      else if (k === 'bookingDurationHours') setBookingDurationHours(next.bookingDurationHours ?? DEFAULT_BOOKING_DURATION_HOURS)
      else if (k === 'gracePeriodHours') setGracePeriodHours(clampGraceHours(next.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS))
    }
    setSavedLocation(next)
    setDrift((d) => ({ ...d, ...notes }))
  }, { enabled: Boolean(locationId) && savedLocation !== null && !savingLocation })
  /** Raden under ett fält du ändrat som också ändrats på annat håll. */
  const driftNote = (k: 'name' | 'address' | 'email' | 'phoneNumber', mine: string, use: (v: string) => void) => {
    const v = drift[k]
    return typeof v === 'string' && v !== mine
      ? <ChangedNote value={v} onUse={() => { use(v); setDrift((d) => ({ ...d, [k]: undefined })) }} />
      : null
  }

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
            'Platsens sparade uppgifter kunde inte hämtas än. Sidan försöker igen av sig själv; spara igen om en stund.',
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
        setDrift({})
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


  const showTab = (t: SettingsTab) =>
    t === 'statistik' || t === 'bokforing' || t === 'integritet'
      ? isOwner
      : t === 'bestallning' || t === 'skrivare'
        ? Boolean(tenant?.entitlements.features.ordering)
        : true
  // Personalen som följer en länk till en ägarflik (#bokforing m.fl.) hamnar på Profil.
  useEffect(() => {
    if (tenant && !showTab(tab)) setTab('profil')
    // showTab beror bara på tenant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tenant])
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
            <CtaButton
              label={savingLocation ? 'Sparar…' : 'Spara ändringar'}
              win="Klart!"
              data-tour="settings-save"
              disabled={savingLocation || resolvingLocation || !isOwner}
              title={isOwner ? undefined : 'Bara ägaren kan ändra restaurangens uppgifter'}
              onClick={handleSaveAll}
            />
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
                    data-help={`settings-tab:${t}`}
                    aria-current={tab === t ? 'page' : undefined}
                    onClick={() => openTab(t)}
                  >
                    <span className="settings-tab-title">{TAB_LABEL[t]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>
        <div className="settings-body">
          {/* Flikar döljs (hidden) i stället för att tas bort - osparade ändringar ligger kvar. */}
          <section className="admin-card table-card" data-help="settings:profil:InstallningarPage" hidden={tab !== 'profil'}>
            <div className="card-head">
              <div>
                <h2 className="card-title">Restaurangprofil</h2>
                <p className="cell-muted">
                  {resolvingLocation
                    ? 'Letar efter restaurangens plats…'
                    : locationId
                      ? isOwner
                        ? null
                        : 'Bara ägaren kan ändra.'
                      : isOwner
                        ? 'Ingen plats än. Fyll i och spara.'
                        : 'Ingen plats än. Fråga ägaren.'}
                </p>
              </div>
            </div>
            {locationError && (
              <ErrorNote text={locationError} />
            )}
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="rp-name">Namn</label>
                <input
                  id="rp-name"
                  value={profile.name}
                  onChange={(e) => updateProfile('name', e.target.value)}
                />
                {driftNote('name', profile.name, (v) => updateProfile('name', v))}
              </div>
              <div className="form-field">
                <label htmlFor="rp-phone">Telefon</label>
                <PhoneInput id="rp-phone" value={profile.phone} onChange={(v) => updateProfile('phone', v)} />
                {driftNote('phoneNumber', profile.phone, (v) => updateProfile('phone', v))}
              </div>
              <div className="form-field">
                <label htmlFor="rp-address">Adress</label>
                <input
                  id="rp-address"
                  value={profile.address}
                  onChange={(e) => updateProfile('address', e.target.value)}
                />
                {driftNote('address', profile.address, (v) => updateProfile('address', v))}
              </div>
              <div className="form-field">
                <label htmlFor="rp-email">E-post</label>
                <input
                  id="rp-email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => updateProfile('email', e.target.value)}
                />
                {driftNote('email', profile.email, (v) => updateProfile('email', v))}
              </div>
              <div className="form-field">
                <span className="form-field-label-row">
                  <label htmlFor="rp-grace">Grace period (minuter)</label>
                  <InfoTooltip label="Grace period (minuter)">
                    Hur länge bordet hålls om gästen är sen. Därefter blir bordet
                    ledigt igen.
                  </InfoTooltip>
                </span>
                <Select
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
                </Select>
              </div>
            </div>
            <div style={{ height: 20 }} />
            <div className="title-info">
              <p className="form-section-label">Öppettider</p>
              <InfoTooltip label="Öppettider">
                Har ni öppet efter midnatt? Ange stängningstiden som vanligt, t.ex. lördag 18:00-02:00. Passet räknas då in på natten till söndag.
              </InfoTooltip>
            </div>
            {drift.businessHours && !sameData(drift.businessHours, businessHours) ? (
              <ChangedNote onUse={() => {
                setBusinessHours(drift.businessHours as BusinessHours)
                setDrift((d) => ({ ...d, businessHours: undefined }))
              }} />
            ) : null}
            <div style={{ height: 8 }} />
            <BusinessHoursEditor
              value={businessHours}
              onChange={(next) => {
                setSaved(false)
                setBusinessHours(next)
              }}
            />
          </section>

          {locationId && tab === 'profil' && (
            <Slot id="installningar.verksamhet.google" props={{ locationId }} />
          )}

          {tenant && isOwner && (
            <div className="settings-row" data-help="settings:profil:PlanCard" hidden={tab !== 'profil'}>
              <PlanCard tenant={tenant} />
            </div>
          )}

          <div data-help="settings:profil:BookingTimeCard" hidden={tab !== 'profil'}>
            <BookingTimeCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
          </div>

          <div className="settings-row" data-help="settings:betalningar:PaymentsCard" hidden={tab !== 'betalningar'}>
            {tenant && (
              <PaymentsCard
                tenant={tenant}
                isOwner={isOwner}
                stripeReturn={stripeReturn}
                onRefresh={refreshTenant}
              />
            )}
          </div>

          <div className="settings-row" data-help="settings:notiser:NotificationsCard" hidden={tab !== 'notiser'}>
            {tenant && (
              <NotificationsCard
                key={`${tenant.tenantId}:${JSON.stringify(tenant.notifications)}:${tenant.senderName ?? ''}`}
                tenant={tenant}
                isOwner={isOwner}
              />
            )}
          </div>

          <div className="settings-row" data-help="settings:avbokning:CancellationPolicyCard" hidden={tab !== 'avbokning'}>
            <CancellationPolicyCard
              key={locationId ?? 'none'}
              locationId={locationId}
              isOwner={isOwner}
              stripeReady={Boolean(tenant?.stripe.chargesEnabled)}
            />
          </div>

          {tenant?.entitlements.features.ordering && (
            <div className="settings-row" data-help="settings:bestallning:OrderingCard" hidden={tab !== 'bestallning'}>
              <OrderingCard
                key={locationId ?? 'none'}
                locationId={locationId}
                isOwner={isOwner}
                stripeReady={Boolean(tenant?.stripe.chargesEnabled)}
              />
            </div>
          )}

          {tenant?.entitlements.features.ordering && tab === 'skrivare' && (
            <div className="settings-row" data-help="settings:skrivare:PrinterCard">
              <PrinterCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
            </div>
          )}

          <div className="settings-row" data-help="settings:dagar:SpecialDaysCard" hidden={tab !== 'dagar'}>
            <SpecialDaysCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
          </div>

          <div className="settings-row" data-help="settings:bord:TableRulesCard" hidden={tab !== 'bord'}>
            <TableRulesCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
          </div>

          {locationId && tab === 'bord' && (
            <Slot id="installningar.verksamhet.waitlist" props={{ locationId }} />
          )}

          {isOwner && tenant && (
            <div className="settings-row" data-help="settings:statistik:InsightsSettingsCard" hidden={tab !== 'statistik'}>
              <InsightsSettingsCard
                key={`${locationId ?? 'none'}:${tenant.insights?.staffAccess ?? 'operations'}`}
                tenant={tenant}
                locationId={locationId}
              />
            </div>
          )}

          {isOwner && tab === 'bokforing' && (
            <div className="settings-row" data-help="settings:bokforing:BokforingCard">
              <Slot id="installningar.bokforing.sync" props={{}} />
              <BokforingCard
                key={locationId ?? 'none'}
                locationId={locationId}
                giftCards={hasFeature(tenant, 'giftCards')}
              />
            </div>
          )}

          {isOwner && tab === 'integritet' && (
            <div className="settings-row" data-help="settings:integritet:PrivacyCard">
              <PrivacyCard />
            </div>
          )}

          {tab === 'utseende' && (
            <>
              <div className="settings-row" data-help="settings:utseende:AppearanceCard">
                <AppearanceCard />
              </div>
              <div className="settings-row" data-help="settings:utseende:DesktopAppCard">
                <DesktopAppCard />
              </div>
            </>
          )}
        </div>
      </div>

    </>
  )
}
