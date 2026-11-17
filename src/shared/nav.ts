import type { FeatureKey } from './contracts'
import type { IconName } from './Icon'
import { hasFeature } from './tenant'
import { canOpen } from './access'
import type { Area } from './access'
import type { Tenant } from './tenant'
import { showDownloadNav } from './desktopDownloads'
import { showPhoneInstallNav } from './pwa'

// Sidomenyns länkar, i korta grupper i den ordning man behöver dem: överblicken,
// driften under passet, restaurangen själv, det som ger fler gäster.
// Inställningar och Hjälp står för sig längst ned. `end: true` gör att '/'
// bara markeras aktiv på exakt träff. `feature` som lista = minst en av dem
// ingår i planen. Samma lista ger kommandopaletten (⌘K) dess "Gå till".
export type NavItem = {
  to: string
  label: string
  icon: IconName
  tour: string
  end?: boolean
  feature?: FeatureKey | FeatureKey[]
  /** Området ägaren ger personalen behörighet till (access.ts); ägaren har alltid alla. */
  area?: Area
  /** Bara i en webbläsare på en dator: inte i skrivbordsappen, inte på mobil. */
  browserOnly?: boolean
  /** Bara på telefon och surfplatta i webbläsaren (inte redan installerad). */
  phoneOnly?: boolean
}

export type NavGroup = { id: string; label: string | null; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overblick',
    label: null,
    items: [
      { to: '/', label: 'Översikt', icon: 'home', tour: 'nav-oversikt', end: true },
      // Restaurangens siffror över tid; personalen utan belopp.
      { to: '/statistik', label: 'Statistik', icon: 'chart', tour: 'nav-statistik', area: 'statistik' },
    ],
  },
  {
    id: 'drift',
    label: 'Drift',
    items: [
      { to: '/bokningar', label: 'Bokningar', icon: 'calendar', tour: 'nav-bokningar', area: 'bokningar' },
      // Bara för restauranger vars plan har matbeställning.
      { to: '/bestallningar', label: 'Beställningar', icon: 'bag', tour: 'nav-bestallningar', feature: 'ordering', area: 'bestallningar' },
      // Förfrågningar; inställningar och rabatter nås därifrån (/cateringkalkyl).
      { to: '/catering', label: 'Catering', icon: 'tray', tour: 'nav-catering', feature: 'catering', area: 'catering' },
      // In- och utcheckning för personalen (personalliggaren).
      { to: '/personalliggare', label: 'Personalliggare', icon: 'badge', tour: 'nav-personalliggare', feature: 'personalliggare', area: 'personalliggare' },
      // Telefonassistenten: samtal, återuppringningar och avstängning; inställningarna är ägarens.
      { to: '/telefon', label: 'Telefon', icon: 'phone', tour: 'nav-telefon', feature: 'phoneAgent', area: 'telefon' },
    ],
  },
  {
    id: 'restaurang',
    label: 'Restaurang',
    items: [
      { to: '/meny', label: 'Meny', icon: 'book', tour: 'nav-meny', area: 'meny' },
      { to: '/layout', label: 'Layout', icon: 'tool-floor', tour: 'nav-layout', area: 'layout' },
      // Medarbetarnas inloggningar och behörigheter.
      { to: '/personal', label: 'Personal', icon: 'staff', tour: 'nav-personal', area: 'personal' },
    ],
  },
  {
    // Ordningen inom gruppen följer CONTRACTS.md 8.1.
    id: 'tillvaxt',
    label: 'Tillväxt',
    items: [
      { to: '/gaster', label: 'Gäster', icon: 'users', tour: 'nav-gaster', feature: 'guestCrm', area: 'gaster' },
      { to: '/presentkort', label: 'Presentkort', icon: 'gift', tour: 'nav-presentkort', feature: 'giftCards', area: 'presentkort' },
      // Biljetter till kvällar och middagar; personalen scannar vid dörren, ägaren redigerar.
      { to: '/evenemang', label: 'Evenemang', icon: 'ticket', tour: 'nav-evenemang', feature: 'events', area: 'evenemang' },
      // Utskick, annonser, omdömen och inlägg, när minst en av dem ingår i planen.
      {
        to: '/marknadsforing',
        label: 'Marknadsföring',
        icon: 'megaphone',
        tour: 'nav-marknadsforing',
        feature: ['marketing', 'metaAds', 'googleBusiness', 'socialPosting'],
        area: 'marknadsforing',
      },
    ],
  },
]

/** Längst ned i menyn, utan rubrik. */
export const NAV_FOOTER: NavItem[] = [
  { to: '/installningar', label: 'Inställningar', icon: 'gear', tour: 'nav-installningar' },
  { to: '/hjalp', label: 'Hjälp', icon: 'help', tour: 'nav-hjalp' },
  // Leder till grenen Appen i Inställningar, Den här enheten.
  { to: '/installningar#skrivbordsappen', label: 'Ladda ner appen', icon: 'download', tour: 'nav-ladda-ner', browserOnly: true },
  // Samma kort på telefonen: där installeras appen på hemskärmen.
  { to: '/installningar#skrivbordsappen', label: 'Installera appen', icon: 'phone', tour: 'nav-installera-appen', phoneOnly: true },
]

/** Får användaren se länken (plan, behörighet)? */
export function navVisible(item: NavItem, tenant: Tenant | null): boolean {
  return (
    (!item.feature || hasFeature(tenant, item.feature)) &&
    (!item.area || canOpen(tenant, item.area)) &&
    (!item.browserOnly || showDownloadNav()) &&
    (!item.phoneOnly || showPhoneInstallNav())
  )
}

/**
 * Får den inloggade öppna sidan? Personalen bara de områden ägaren har gett
 * den. Menyn döljer länkarna; det här stoppar den som skriver adressen själv.
 * Servern svarar ändå 403 `no_access`.
 */
export function roleAllows(pathname: string, tenant: Tenant | null): boolean {
  if (!tenant) return true
  const area = areaOf(pathname)
  return !area || canOpen(tenant, area)
}

/** Området en sökväg hör till (även undersidor som /catering/... och /cateringkalkyl). */
export function areaOf(pathname: string): Area | null {
  if (pathname === '/cateringkalkyl' || pathname.startsWith('/cateringkalkyl/')) return 'catering'
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.area && onItem(pathname, i))
  return item?.area ?? null
}

/** Är sidan länkens? */
export function onItem(pathname: string, item: NavItem): boolean {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)
}

/** Alla länkar man får se, i menyns ordning. */
export function visibleNav(tenant: Tenant | null): NavItem[] {
  return [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].filter((item) => navVisible(item, tenant))
}

// Senast besökta sidor i den här fliken (bara i minnet, inget sparas):
// kommandopalettens "Senaste".
let recent: string[] = []
export function rememberPage(pathname: string) {
  recent = [pathname, ...recent.filter((p) => p !== pathname)].slice(0, 6)
}
export function recentPages(): string[] {
  return recent
}

// Åtgärder från paletten som en sida utför (t.ex. "Ny bokning"): sidan som
// öppnas tar emot den när den monteras, eller direkt om den redan är öppen.
const ACTION_EVENT = 'booqy:page-action'
let pendingAction: string | null = null
export function requestPageAction(key: string) {
  pendingAction = key
  window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: key }))
}
/** Väntar en åtgärd på sidan? Den tas bort när den har lästs. */
export function takePageAction(key: string): boolean {
  if (pendingAction !== key) return false
  pendingAction = null
  return true
}
export function onPageAction(key: string, run: () => void): () => void {
  const listener = (e: Event) => {
    if ((e as CustomEvent<string>).detail === key && takePageAction(key)) run()
  }
  window.addEventListener(ACTION_EVENT, listener)
  return () => window.removeEventListener(ACTION_EVENT, listener)
}
