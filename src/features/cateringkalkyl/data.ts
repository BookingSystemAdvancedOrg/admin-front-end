/**
 * MOCKDATA för Cateringkalkyl — precis som avbokningspolicyn i Inställningar
 * (installningar/data.ts) finns ingen backend-rutt för det här än. Rena
 * rätterna i förhandsvisningen kommer däremot från det RIKTIGA meny-API:t
 * (menuApi.ts) — bara reglerna/rabattnivåerna/leveranspriset är påhittade
 * tills en catering-rutt finns. Ersätts med riktiga anrop den dagen den
 * finns — se docs/BACKEND-KOPPLING.md.
 */

export interface OrderRules {
  /** Minsta antal portioner (totalt över alla rätter) för en beställning. */
  minPortions: number
  /** Högsta antal portioner (totalt) — även taket för sista rabattnivån. */
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
 * rätter), inte per rätt. `toPortions: null` betyder "och uppåt" — i praktiken
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
