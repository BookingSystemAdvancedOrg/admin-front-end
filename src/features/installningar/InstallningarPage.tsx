import { errorText } from '../../shared/errors'
import { useEffect, useRef, useState } from 'react'
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
import { StaffAccessCard } from './StaffAccessCard'
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
import { WEEKDAYS } from './locationApi'
import type { BusinessHours, Location, LocationCreateRequest } from './locationApi'
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
import { useTheme } from '../../shared/theme'
import { useSound } from '../../shared/press'
import { NAV_GROUPS, navVisible } from '../../shared/nav'
import type { NavItem } from '../../shared/nav'
import type { Tenant } from '../../shared/tenant'
import { planLabel } from './PlanCard'
import { BranchHead, BranchPager, SettingsField, SettingsTreeNav, SettingsTreePage } from './SettingsTreeView'
import type { Apple, VisibleTree } from './SettingsTreeView'
import { LEAVES, TREES, branchVisible, fold, isBranch, isTree, treeOf } from './settingsTree'
import type { BranchId, Leaf, TreeId } from './settingsTree'


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
/** Det sidan visar: fältet (alla träd), ett träd eller en gren. */
type View = { kind: 'field' } | { kind: 'tree'; tree: TreeId } | { kind: 'branch'; branch: BranchId }

/** #gren eller #träd ur adressen; fältet utan (eller med okänd) hash. */
function viewFromHash(hash: string): View {
  const id = hash.replace(/^#/, '')
  if (isBranch(id)) return { kind: 'branch', branch: id }
  if (isTree(id)) return { kind: 'tree', tree: id }
  return { kind: 'field' }
}

/** Återkomster utifrån utan hash (Stripe, kortet, Google, ?flik=gren) öppnar sin gren. */
function branchFromQuery(params: URLSearchParams): BranchId | null {
  const flik = params.get('flik')
  if (flik && isBranch(flik)) return flik
  if (params.get('stripe')) return 'betalningar'
  if (params.get('kort')) return 'abonnemang'
  if (params.get('google') === '1') return 'google'
  return null
}

/** Grenar som ritas bara medan de är öppna; de andra ligger kvar (dolda) när de väl öppnats. */
const ONLY_WHILE_OPEN: BranchId[] = ['utseende', 'skrivbordsappen']

/** Fält i Spara ändringar och grenen där de står (för att leda dit vid fel). */
const HOURS_BRANCH: BranchId = 'dagar'

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
  // Stripe-återkomsten läses en gång: adressen byts när man går vidare på sidan.
  const [stripeReturn] = useState(() => searchParams.get('stripe'))
  // Länkar (och guiden) öppnar en gren via #gren i adressen; fältet utan.
  const { hash, search, state: navState } = useLocation()
  const view = viewFromHash(hash)
  const branch = view.kind === 'branch' ? view.branch : null
  useEffect(() => {
    // Personalen har flyttat till en egen sida; gamla länkar leds dit.
    if (hash === '#personal') navigate('/personal', { replace: true })
    else if (!hash) {
      const fromQuery = branchFromQuery(new URLSearchParams(search))
      if (fromQuery) navigate({ search, hash: `#${fromQuery}` }, { replace: true })
    }
  }, [hash, search, navigate])
  /** Till en gren, ett träd eller fältet (null). Bakåt i webbläsaren går tillbaka. */
  function go(to: BranchId | TreeId | null) {
    navigate(to ? { hash: `#${to}` } : { hash: '' })
    // Ny vy: börja överst, utan att rycka om den redan syns.
    const top = document.querySelector('.settings-main')?.getBoundingClientRect().top ?? 0
    if (top < 0) window.scrollTo({ top: window.scrollY + top - 16, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  // Grenar hämtar först när de öppnas och ligger sedan kvar (dolda), så
  // osparade ändringar inte försvinner när man går till en annan gren.
  const opened = useRef(new Set<BranchId>())
  if (branch) opened.current.add(branch)
  const mounted = (b: BranchId) => opened.current.has(b) && (!ONLY_WHILE_OPEN.includes(b) || branch === b)
  // Ett blad från sökningen: lyses upp när grenen har ritats.
  const [pendingLeaf, setPendingLeaf] = useState<Leaf | null>(null)
  // ⌘K kan peka på ett blad (state.leaf): samma upplysning som sökningen.
  useEffect(() => {
    const want = (navState as { leaf?: unknown } | null)?.leaf
    const leaf = typeof want === 'string' ? LEAVES.find((l) => l.label === want && l.branch === branch) : undefined
    if (leaf) setPendingLeaf(leaf)
  }, [navState, branch])
  useEffect(() => {
    if (!pendingLeaf || branch !== pendingLeaf.branch) return
    return highlightLeaf(pendingLeaf, () => setPendingLeaf(null))
  }, [pendingLeaf, branch])
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
  // Kortgarantin och beställningen ur samma hämtning: äpplena på fältet.
  const [locExtra, setLocExtra] = useState<Pick<Location, 'guarantee' | 'ordering'> | null>(null)

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
        setLocExtra({ guarantee: loc.guarantee, ordering: loc.ordering })
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
    setLocExtra((prev) => (sameData(prev, { guarantee: loc.guarantee, ordering: loc.ordering }) ? prev : { guarantee: loc.guarantee, ordering: loc.ordering }))
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

    const profileError =
      validateLocationName(profile.name) ??
      validateAddress(profile.address) ??
      validateEmail(profile.email) ??
      validatePhoneNumber(profile.phone) ??
      validateTimezone(timezone) ??
      validateBookingDuration(bookingDurationHours) ??
      validateGracePeriod(gracePeriodHours)
    const hoursError = profileError ? null : validateBusinessHours(businessHours)
    if (profileError || hoursError) {
      setLocationError(profileError ?? hoursError)
      // Felet står i grenen där fältet finns: dit, om du sparar från den andra.
      const at: BranchId = profileError ? 'profil' : HOURS_BRANCH
      if (branch !== at) go(at)
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


  const visible = (b: BranchId) => branchVisible(b, tenant)
  // Personalen som följer en länk till en ägargren (#bokforing m.fl.) hamnar på fältet.
  useEffect(() => {
    if (tenant && branch && !branchVisible(branch, tenant)) navigate({ hash: '' }, { replace: true })
  }, [branch, tenant, navigate])
  const showPersonal = navVisible(NAV_GROUPS.flatMap((g) => g.items).find((n) => n.to === '/personal') as NavItem, tenant)
  const trees: VisibleTree[] = TREES.map((t) => ({
    ...t,
    branches: t.branches.filter(visible),
    personalLink: t.id === 'personalen' && showPersonal,
  })).filter((t) => t.branches.length > 0 || t.personalLink)
  const order = trees.flatMap((t) => t.branches)
  const currentTree = branch ? treeOf(branch).id : view.kind === 'tree' ? view.tree : null
  const shownTree = view.kind === 'tree' ? trees.find((t) => t.id === view.tree) : undefined

  // Äpplena: det viktigaste per träd, ur det sidan redan har hämtat.
  const { theme } = useTheme()
  const [sound] = useSound()
  const stripeReady = Boolean(tenant?.stripe.chargesEnabled)
  const apples: Partial<Record<TreeId, Apple[]>> = {
    restaurangen: [
      ...(!locationId && !resolvingLocation ? [{ text: 'Ingen plats än', branch: 'profil' as const, warn: true }] : []),
      ...(savedLocation ? [todayApple(businessHours)] : []),
    ],
    gaster: [
      ...(tenant ? [{ text: tenant.notifications.sms ? 'SMS på' : 'SMS av', branch: 'notiser' as const }] : []),
      ...(locExtra?.guarantee
        ? [locExtra.guarantee.enabled
          ? { text: stripeReady ? 'Kortgaranti på' : 'Kortgaranti väntar på Stripe', branch: 'avbokning' as const, warn: !stripeReady }
          : { text: 'Kortgaranti av', branch: 'avbokning' as const }]
        : []),
    ],
    bestallningar: locExtra?.ordering
      ? [locExtra.ordering.enabled
        ? { text: stripeReady ? 'Tar emot beställningar' : 'Beställning väntar på Stripe', branch: 'bestallning' as const, warn: !stripeReady }
        : { text: 'Tar inte emot beställningar', branch: 'bestallning' as const }]
      : [],
    ekonomi: [
      ...(tenant && isOwner ? [{ text: planLabel(tenant), branch: 'abonnemang' as const }] : []),
      ...(isOwner && tenant?.billing ? billingApple(tenant.billing) : []),
      ...(tenant ? [{ text: stripeReady ? 'Stripe aktiv' : 'Stripe ej klar', branch: 'betalningar' as const, warn: !stripeReady }] : []),
    ],
    personalen: isOwner && tenant?.staffAccess
      ? [{ text: `${tenant.staffAccess.defaults.length} av ${tenant.staffAccess.areas.length} sidor`, branch: 'behorighet' as const }]
      : [],
    enheten: [
      { text: theme === 'dark' ? 'Mörkt läge' : 'Ljust läge', branch: 'utseende' },
      { text: sound ? 'Klickljud på' : 'Klickljud av', branch: 'utseende' },
    ],
  }

  const pane = (b: BranchId) => ({ className: 'settings-branch', 'data-branch': b, hidden: branch !== b })

  return (
    <>
      <AdminTopbar
        title="Inställningar"
        actions={
          (branch === 'profil' || branch === HOURS_BRANCH) && <span className="row-actions">
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
      <div className="admin-main settings-main" data-view={view.kind}>
        <SettingsTreeNav
          trees={trees}
          current={branch}
          currentTree={currentTree}
          onBranch={go}
          onPersonal={() => navigate('/personal')}
        />
        <div className="settings-body">
          {view.kind === 'field' && (
            <SettingsField
              trees={trees}
              apples={apples}
              visible={visible}
              onTree={go}
              onBranch={go}
              onLeaf={(leaf) => {
                setPendingLeaf(leaf)
                go(leaf.branch)
              }}
              onPersonal={() => navigate('/personal')}
            />
          )}
          {shownTree && (
            <SettingsTreePage
              tree={shownTree}
              apples={apples[shownTree.id] ?? []}
              onField={() => go(null)}
              onBranch={go}
              onPersonal={() => navigate('/personal')}
            />
          )}
          {branch && <BranchHead key={branch} branch={branch} onField={() => go(null)} onTree={go} />}

          {/* Grenar döljs (hidden) i stället för att tas bort - osparade ändringar ligger kvar. */}
          <div {...pane('profil')}>
            <section className="admin-card table-card" data-help="settings:profil:InstallningarPage">
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
                    <label htmlFor="rp-grace">Väntetid för sena gäster (minuter)</label>
                    <InfoTooltip label="Väntetid för sena gäster (minuter)">
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
            </section>
          </div>

          <div {...pane('dagar')}>
            <section className="admin-card table-card" data-help="settings:dagar:BusinessHoursEditor">
              <div className="card-head">
                <div className="title-info">
                  <h2 className="card-title">Öppettider</h2>
                  <InfoTooltip label="Öppettider">
                  Har ni öppet efter midnatt? Ange stängningstiden som vanligt, t.ex. lördag 18:00-02:00. Passet räknas då in på natten till söndag.
                  </InfoTooltip>
                </div>
              </div>
              {locationError && <ErrorNote text={locationError} />}
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
            <div className="settings-row" data-help="settings:dagar:SpecialDaysCard">
              <SpecialDaysCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
            </div>
          </div>

          {mounted('bord') && (
            <div {...pane('bord')}>
              <div data-help="settings:bord:BookingTimeCard">
                <BookingTimeCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
              </div>
              <div className="settings-row" data-help="settings:bord:TableRulesCard">
                <TableRulesCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
              </div>
              {locationId && <Slot id="installningar.verksamhet.waitlist" props={{ locationId }} />}
            </div>
          )}

          {mounted('google') && visible('google') && (
            <div {...pane('google')}>
              {locationId ? (
                <div className="settings-row" data-help="settings:google:GoogleProfileCard">
                  <Slot id="installningar.verksamhet.google" props={{ locationId }} />
                </div>
              ) : (
                <section className="admin-card table-card">
                  <h2 className="card-title">Google-profil</h2>
                  <p className="cell-muted">Spara restaurangens profil först.</p>
                </section>
              )}
            </div>
          )}

          {mounted('notiser') && (
            <div {...pane('notiser')}>
              <div className="settings-row" data-help="settings:notiser:NotificationsCard">
                {tenant && (
                  <NotificationsCard
                    key={`${tenant.tenantId}:${JSON.stringify(tenant.notifications)}:${tenant.senderName ?? ''}`}
                    tenant={tenant}
                    isOwner={isOwner}
                  />
                )}
              </div>
            </div>
          )}

          {mounted('avbokning') && (
            <div {...pane('avbokning')}>
              <div className="settings-row" data-help="settings:avbokning:CancellationPolicyCard">
                <CancellationPolicyCard
                  key={locationId ?? 'none'}
                  locationId={locationId}
                  isOwner={isOwner}
                  stripeReady={stripeReady}
                />
              </div>
            </div>
          )}

          {isOwner && mounted('integritet') && (
            <div {...pane('integritet')}>
              <div className="settings-row" data-help="settings:integritet:PrivacyCard">
                <PrivacyCard />
              </div>
            </div>
          )}

          {visible('bestallning') && mounted('bestallning') && (
            <div {...pane('bestallning')}>
              <div className="settings-row" data-help="settings:bestallning:OrderingCard">
                <OrderingCard
                  key={locationId ?? 'none'}
                  locationId={locationId}
                  isOwner={isOwner}
                  stripeReady={stripeReady}
                />
              </div>
            </div>
          )}

          {visible('skrivare') && mounted('skrivare') && (
            <div {...pane('skrivare')}>
              <div className="settings-row" data-help="settings:skrivare:PrinterCard">
                <PrinterCard key={locationId ?? 'none'} locationId={locationId} isOwner={isOwner} />
              </div>
            </div>
          )}

          {tenant && isOwner && mounted('abonnemang') && (
            <div {...pane('abonnemang')}>
              <div className="settings-row" data-help="settings:abonnemang:PlanCard">
                <PlanCard tenant={tenant} />
              </div>
            </div>
          )}

          {mounted('betalningar') && (
            <div {...pane('betalningar')}>
              <div className="settings-row" data-help="settings:betalningar:PaymentsCard">
                {tenant && (
                  <PaymentsCard
                    tenant={tenant}
                    isOwner={isOwner}
                    stripeReturn={stripeReturn}
                    onRefresh={refreshTenant}
                  />
                )}
              </div>
            </div>
          )}

          {isOwner && mounted('bokforing') && (
            <div {...pane('bokforing')}>
              <div className="settings-row" data-help="settings:bokforing:BokforingCard">
                <Slot id="installningar.bokforing.sync" props={{}} />
                <BokforingCard
                  key={locationId ?? 'none'}
                  locationId={locationId}
                  giftCards={hasFeature(tenant, 'giftCards')}
                />
              </div>
            </div>
          )}

          {isOwner && tenant && mounted('statistik') && (
            <div {...pane('statistik')}>
              <div className="settings-row" data-help="settings:statistik:InsightsSettingsCard">
                <InsightsSettingsCard key={locationId ?? 'none'} locationId={locationId} />
              </div>
            </div>
          )}

          {isOwner && tenant && mounted('behorighet') && (
            <div {...pane('behorighet')}>
              <div className="settings-row" data-help="settings:behorighet:StaffAccessCard">
                <StaffAccessCard tenant={tenant} />
              </div>
            </div>
          )}

          {mounted('utseende') && (
            <div {...pane('utseende')}>
              <div className="settings-row" data-help="settings:utseende:AppearanceCard">
                <AppearanceCard />
              </div>
            </div>
          )}

          {mounted('skrivbordsappen') && (
            <div {...pane('skrivbordsappen')}>
              <div className="settings-row" data-help="settings:skrivbordsappen:DesktopAppCard">
                <DesktopAppCard />
              </div>
            </div>
          )}

          {branch && <BranchPager order={order} branch={branch} onBranch={go} />}
        </div>
      </div>
    </>
  )
}

function reducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** Dagens öppettider som äpple ("Öppet i dag 11:00-22:00" eller "Stängt i dag"). */
function todayApple(hours: BusinessHours): Apple {
  const day = WEEKDAYS[(new Date().getDay() + 6) % 7]
  const spans = hours[day] ?? []
  return spans.length
    ? { text: `Öppet i dag ${spans.map((s) => `${s.opensAt}-${s.closesAt}`).join(', ')}`, branch: HOURS_BRANCH }
    : { text: 'Stängt i dag', branch: HOURS_BRANCH }
}

/** Abonnemangets betalning som äpple: kortet, eller det som behöver göras. */
function billingApple(billing: NonNullable<Tenant['billing']>): Apple[] {
  if (billing.pastDue) return [{ text: 'Obetald faktura', branch: 'abonnemang', warn: true }]
  if (billing.hasCard && billing.cardLast4) return [{ text: `Kort ••${billing.cardLast4}`, branch: 'abonnemang' }]
  if (billing.customer && billing.collection === 'card' && !billing.hasCard) return [{ text: 'Inget kort', branch: 'abonnemang', warn: true }]
  if (billing.collection === 'invoice') return [{ text: 'Faktura', branch: 'abonnemang' }]
  return []
}

/**
 * Lyser upp ett blad från sökningen: väntar tills grenen har ritat det
 * (kort som hämtar data), rullar dit och ger raden en ring en stund.
 */
function highlightLeaf(leaf: Leaf, done: () => void): () => void {
  const wants = (leaf.find ?? leaf.label).split('|').map(fold)
  const started = Date.now()
  let timer = 0
  let frame = 0
  const tick = () => {
    const root = document.querySelector(`.settings-branch[data-branch="${leaf.branch}"]`)
    const hit = root
      ? Array.from(root.querySelectorAll<HTMLElement>('h2, h3, h4, label, legend, .form-section-label, .appearance-title, .card-title, .switch-label, p, span, button'))
        .find((el) => {
          if (el.children.length >= 3) return false
          const text = fold((el.textContent ?? '').replace(/\s+/g, ' ').trim())
          return wants.some((w) => text.startsWith(w))
        })
      : undefined
    if (!hit) {
      if (Date.now() - started < 4000) frame = window.requestAnimationFrame(tick)
      else done()
      return
    }
    // Raden bladet står på; en kortrubrik lyser upp hela kortet.
    const card = hit.closest<HTMLElement>('.admin-card')
    const row = hit.closest<HTMLElement>('.form-field, .appearance-row, .toggle-row, .switch-row')
      ?? (hit.matches('h2, h3, .card-title') || hit.parentElement === card ? card : hit.parentElement)
      ?? hit
    row.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
    row.classList.add('stree-leaf-flash')
    timer = window.setTimeout(() => {
      row.classList.remove('stree-leaf-flash')
      done()
    }, 2400)
  }
  frame = window.requestAnimationFrame(tick)
  return () => {
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timer)
  }
}
