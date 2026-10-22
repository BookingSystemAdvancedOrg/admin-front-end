/**
 * MOCKDATA för Cateringkalkyl - precis som avbokningspolicyn i Inställningar
 * (installningar/data.ts) finns ingen backend-rutt för det här än. Rena
 * rätterna i förhandsvisningen kommer däremot från det RIKTIGA meny-API:t
 * (menuApi.ts) - bara reglerna/rabattnivåerna/leveranspriset är påhittade
 * tills en catering-rutt finns. Ersätts med riktiga anrop den dagen den
 * finns - se docs/BACKEND-KOPPLING.md.
 */

export interface OrderRules {
  /** Minsta antal portioner (totalt över alla rätter) för en beställning. */
  minPortions: number
  /** Högsta antal portioner (totalt) - även taket för sista rabattnivån. */
  maxPortions: number
  /** Hur många dagars framförhållning som krävs innan leveransdatumet. */
  advanceDays: number
  discountScope: DiscountScope
  /** Om cateringkalkylen visas för gäster på kundsajten. */
  visibleToCustomers: boolean
}

export type DiscountScope = 'alla_ratter'

export const DISCOUNT_SCOPE_LABEL: Record<DiscountScope, string> = {
  alla_ratter: 'Alla rätter i beställningen',
}

export interface DeliveryPricing {
  /** Fritextnamn på leveransområdet, t.ex. "Östergötland". */
  area: string
  /** Avstånd (km) som skiljer standardpriset från tilläggspriset. */
  maxDistanceKm: number
  /** Pris (kr) upp till och med `maxDistanceKm`. */
  priceWithinLimit: number
  /** Pris (kr) för leveranser längre än `maxDistanceKm`. */
  priceBeyondLimit: number
  /** Om leverans utanför området alls tillåts (till `priceBeyondLimit`). */
  allowOutsideArea: boolean
}

/**
 * En rabattnivå. Räknas på TOTALT antal portioner i beställningen (över alla
 * rätter), inte per rätt. `toPortions: null` betyder "och uppåt" - i praktiken
 * begränsat av `OrderRules.maxPortions` (visas som "{max} (max)" i tabellen
 * i stället för ett oändlighetstecken, eftersom en beställning aldrig kan
 * bli större än så ändå).
 */
export interface DiscountTier {
  id: string
  name: string
  fromPortions: number
  toPortions: number | null
  /** 0 = ingen rabatt (t.ex. bas-nivån). */
  discountPercent: number
  active: boolean
}

export const MOCK_ORDER_RULES: OrderRules = {
  minPortions: 10,
  maxPortions: 300,
  advanceDays: 5,
  discountScope: 'alla_ratter',
  visibleToCustomers: true,
}

export const MOCK_DELIVERY_PRICING: DeliveryPricing = {
  area: 'Östergötland',
  maxDistanceKm: 25,
  priceWithinLimit: 395,
  priceBeyondLimit: 795,
  allowOutsideArea: false,
}

export const MOCK_DISCOUNT_TIERS: DiscountTier[] = [
  { id: 'bas', name: 'Bas', fromPortions: 10, toPortions: 29, discountPercent: 0, active: true },
  { id: 'niva-1', name: 'Nivå 1', fromPortions: 30, toPortions: 59, discountPercent: 5, active: true },
  { id: 'niva-2', name: 'Nivå 2', fromPortions: 60, toPortions: 99, discountPercent: 10, active: true },
  { id: 'niva-3', name: 'Nivå 3', fromPortions: 100, toPortions: null, discountPercent: 15, active: true },
]

/** Den aktiva nivån vars intervall täcker `totalPortions`, om någon. */
export function tierFor(
  tiers: DiscountTier[],
  totalPortions: number,
): DiscountTier | null {
  return (
    tiers.find(
      (t) =>
        t.active &&
        totalPortions >= t.fromPortions &&
        (t.toPortions === null || totalPortions <= t.toPortions),
    ) ?? null
  )
}

/** Nästa (högre) aktiva nivå efter den som gäller nu, om någon finns kvar. */
export function nextTierAfter(
  tiers: DiscountTier[],
  current: DiscountTier | null,
): DiscountTier | null {
  const active = [...tiers].filter((t) => t.active).sort((a, b) => a.fromPortions - b.fromPortions)
  if (!current) return active[0] ?? null
  const i = active.findIndex((t) => t.id === current.id)
  return i >= 0 ? active[i + 1] ?? null : null
}

/**
 * Två intervall [aFrom, aTo] och [bFrom, bTo] (öppen övre gräns = null)
 * överlappar om de delar minst en portion. Används för att stoppa två
 * rabattnivåer från att gälla samma antal portioner samtidigt.
 */
export function rangesOverlap(
  aFrom: number,
  aTo: number | null,
  bFrom: number,
  bTo: number | null,
): boolean {
  const aEnd = aTo ?? Infinity
  const bEnd = bTo ?? Infinity
  return aFrom <= bEnd && bFrom <= aEnd
}

/** Samma regler som servern (shared/catering.py): fel på svenska innan något skickas. */
export function settingsProblem(s: {
  deliveryBands: { upToKm: number; price: number }[]
  leadTimeRules: { fromGuests: number; toGuests: number | null; days: number }[]
  minGuests: number
  requestExpiryHours: number
  ownerReminderHours: number
  offerValidDays: number
  signReminderDaysBefore: number
}): string | null {
  if (s.minGuests < 1) return 'Minsta antal gäster måste vara minst 1.'
  if (s.deliveryBands.length === 0) return 'Lägg till minst ett leveransintervall.'
  for (const [i, b] of s.deliveryBands.entries()) {
    if (b.upToKm < 1 || b.upToKm > 1000) return 'Avståndet i varje leveransintervall ska vara 1-1000 km.'
    if (i > 0 && b.upToKm <= s.deliveryBands[i - 1].upToKm) return 'Leveransintervallen ska ha stigande avstånd.'
  }
  const rules = [...s.leadTimeRules].sort((a, b) => a.fromGuests - b.fromGuests)
  for (const [i, r] of rules.entries()) {
    if (r.fromGuests < 1) return 'Förberedelsetid: "Från" ska vara minst 1 gäst.'
    if (r.toGuests !== null && r.toGuests < r.fromGuests) return 'Förberedelsetid: "Till" får inte vara mindre än "Från".'
    if (r.days > 90) return 'Förberedelsetid: högst 90 dagar.'
    const next = rules[i + 1]
    if (next && (r.toGuests === null || next.fromGuests !== r.toGuests + 1)) {
      return 'Förberedelsetid: intervallen får inte överlappa eller ha luckor (nästa ska börja direkt efter föregående).'
    }
  }
  if (s.ownerReminderHours > 0 && s.ownerReminderHours >= s.requestExpiryHours) {
    return 'Påminnelsen till restaurangen måste komma innan förfrågan går ut.'
  }
  if (s.signReminderDaysBefore > 0 && s.signReminderDaysBefore >= s.offerValidDays) {
    return 'Påminnelsen om signering måste komma inom offertens giltighetstid.'
  }
  return null
}

/** Kronor från ett textfält ("145,50" går också); null om det inte är ett pris med högst två decimaler. */
export function parseKronor(value: string): number | null {
  const v = value.replace(/\s|kr/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const n = Number(v)
  return n <= 10000 ? n : null
}
