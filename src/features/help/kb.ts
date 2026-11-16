import type { FeatureKey } from '../../shared/contracts'
import { NAV_FOOTER, NAV_GROUPS, navVisible, onItem } from '../../shared/nav'
import type { Tenant } from '../../shared/tenant'
import { isDesktopShell } from '../../shared/desktopDownloads'
import data from './helpKb.json'

/**
 * Hjälpassistentens kunskapsbas: en kurerad svensk hjälptext per sida och
 * uppgift (helpKb.json). Samma fil används av servern
 * (application/shared/help_kb.json, kopieras med `npm run help-kb:sync`).
 * routes.test.ts larmar när en route i App.tsx saknar hjälptext.
 *
 * Inga hemligheter, nycklar, infrastruktur eller andra restaurangers data
 * får stå här: filen skickas till webbläsaren och till språkmodellen.
 */

export type HelpAction = {
  id: string
  label: string
  /** En sökväg utan parametrar som finns i App.tsx, t.ex. "/meny". */
  to: string
  query?: Record<string, string>
  hash?: string
  /** Öppnar ett formulär på sidan (nav.ts requestPageAction). */
  pageAction?: string
  /** Lyser upp efter navigeringen: "help:<data-help-id>" eller "text:<synlig text>". */
  highlight?: string[]
}

/**
 * En levande siffra ur restaurangens egna data (live.ts), t.ex. gäster idag.
 * text: {value} är siffran (bara det, så läser äldre appar texten rätt).
 * countText: samma text där {en|flera} väljer ental eller flertal efter
 * siffran; den läses före text. rangeText: för en annan dag eller period
 * ({period} = "Imorgon, lördag 15 november"); servern sätter då range och
 * måttet utan period (guests).
 */
export type HelpLive = { metric: string; text: string; countText?: string; rangeText?: string; range?: { from: string; to: string } }

export type HelpEntry = {
  id: string
  /** Sidan texten handlar om (mönster ur App.tsx), eller null för hemsidan och Booqy. */
  route: string | null
  title: string
  audience: 'all' | 'owner'
  feature?: FeatureKey | FeatureKey[] | null
  /** Statistik: personalen ser den bara om ägaren tillåter det. */
  insights?: boolean
  keywords: string[]
  answer: string
  steps: string[]
  actions?: HelpAction[]
  /** Förslag på fråga när assistenten öppnas (högst tre visas). */
  suggestion?: string
  /** Var på sidan svaret pekar (lyses upp med knappen). */
  highlight?: string[]
  live?: HelpLive
}

/**
 * En del av kunskapsbasen som byggs ur koden (scripts/help-corpus.mjs):
 * de kurerade guiderna (kind "guide", samma fält som HelpEntry) och allt
 * som syns i appen: sidor, inställningar, rubriker, fält, knappar och
 * nyckeltal (kind "page" och "element").
 */
export type HelpDoc = Omit<HelpEntry, 'answer' | 'steps' | 'keywords' | 'route'> & {
  kind: 'guide' | 'page' | 'element'
  route: string | null
  hash?: string
  /** Var det finns, t.ex. "Inställningar, Utseende och ljud". */
  where?: string
  text?: string
  answer?: string
  steps?: string[]
  keywords?: string[]
}

export type HelpCorpus = { version: number; app: string; routes: string[]; docs: HelpDoc[] }

export type HelpAnswer = {
  known: boolean
  text: string
  steps: string[]
  actions: HelpAction[]
  sources: string[]
  live?: HelpLive
}

export const KB = data as { version: number; entries: HelpEntry[] }

/** Formulär som en sida kan öppna direkt (nav.ts onPageAction). */
export const PAGE_ACTIONS = ['new-dish', 'new-booking', 'invite-staff'] as const

/**
 * Alla sökvägar i App.tsx (routes.test.ts håller listan i takt med App.tsx).
 * Knappar får bara gå till de statiska, utan :parametrar.
 */
export const ROUTE_PATTERNS = [
  '/',
  '/ladda-ner',
  '/statistik',
  '/bokningar',
  '/bestallningar',
  '/meny',
  '/cateringkalkyl',
  '/catering',
  '/catering/:locationId/:requestId',
  '/personal',
  '/personalliggare',
  '/telefon',
  '/telefon/samtal/:callId',
  '/layout',
  '/gaster',
  '/presentkort',
  '/webbplats',
  '/evenemang',
  '/evenemang/:eventId',
  '/evenemang/:eventId/inslapp/:occurrenceId',
  '/marknadsforing',
  '/installningar',
  '/hjalp',
  '/avtal',
  '/settings/payments',
] as const

export type HelpView = {
  role: Tenant['role'] | null
  features: Record<string, boolean>
  staffInsights: boolean
}

export function viewOf(tenant: Tenant | null): HelpView {
  return {
    role: tenant?.role ?? null,
    features: tenant?.entitlements.features ?? {},
    staffInsights: (tenant?.insights?.staffAccess ?? 'operations') !== 'none',
  }
}

/** Hjälptexter om att ladda ner skrivbordsappen. */
export const DOWNLOAD_ENTRIES = ['ladda-ner-appen']

/** Får den inloggade se hjälptexten (roll, plan, statistik)? Samma regel som servern. */
export function entryVisible(entry: Pick<HelpEntry, 'id' | 'audience' | 'feature' | 'insights'>, view: HelpView): boolean {
  // Om att ladda ner appen: inte i skrivbordsappen själv.
  if (DOWNLOAD_ENTRIES.includes(entry.id) && isDesktopShell()) return false
  if (entry.audience === 'owner' && view.role !== 'owner_user') return false
  if (entry.feature) {
    const keys = Array.isArray(entry.feature) ? entry.feature : [entry.feature]
    if (!keys.some((k) => view.features[k])) return false
  }
  if (entry.insights && view.role !== 'owner_user' && !view.staffInsights) return false
  return true
}

const NAV_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER]
const SAFE = /^[a-z0-9-]{1,40}$/

/**
 * Får knappen visas? Bara statiska sökvägar som finns i App.tsx, sidor som
 * menyn visar för den här användaren (plan och roll), kända formulär och
 * enkla query- och hash-värden. Allt annat från servern kastas.
 */
export function actionAllowed(action: HelpAction, tenant: Tenant | null): boolean {
  if (typeof action?.to !== 'string' || typeof action.label !== 'string' || !action.label.trim()) return false
  if (!(ROUTE_PATTERNS as readonly string[]).includes(action.to) || action.to.includes(':')) return false
  if (action.to === '/settings/payments') return false
  if (isDesktopShell() && (action.to === '/ladda-ner' || action.hash === 'skrivbordsappen')) return false
  const item = NAV_ITEMS.find((n) => onItem(action.to, n))
  if (item && !navVisible(item, tenant)) return false
  if (action.to === '/avtal' && tenant?.role !== 'owner_user') return false
  if (action.pageAction !== undefined && !(PAGE_ACTIONS as readonly string[]).includes(action.pageAction)) return false
  if (action.hash !== undefined && !SAFE.test(action.hash)) return false
  if (action.query !== undefined) {
    if (typeof action.query !== 'object' || action.query === null) return false
    if (!Object.entries(action.query).every(([k, v]) => SAFE.test(k) && typeof v === 'string' && SAFE.test(v))) return false
  }
  return true
}

/** "/meny?flik=x#y" för en tillåten knapp. */
export function actionHref(action: HelpAction): string {
  const query = action.query ? new URLSearchParams(action.query).toString() : ''
  return `${action.to}${query ? `?${query}` : ''}${action.hash ? `#${action.hash}` : ''}`
}
