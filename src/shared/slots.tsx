import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import { ADMIN_SLOTS } from './contracts'
import type { AdminSlotId, FeatureKey } from './contracts'
import { useTenant } from './tenant'
import type { Tenant } from './tenant'
import type { InsightsResponse } from '../features/statistik/insights'

/**
 * Platser i befintliga sidor där en planfunktion lägger in sin del
 * (CONTRACTS.md 8.2). Värdsidan ritar `<Slot id props />`; inget visas när
 * funktionen inte ingår i planen eller när delen bara är för ägare och den
 * inloggade är personal. Komponenten laddas först när den behövs.
 *
 * `statistik.signals` är en funktion, inte en komponent: den importeras
 * direkt i statistik/insights.ts och har därför ingen laddare här.
 */
type ComponentSlotId = Exclude<AdminSlotId, 'statistik.signals'>

// any: varje plats props kontrolleras av SlotProps hos värdsidan.
type Loader = () => Promise<{ default: ComponentType<any> }>

const SLOT_LOADERS: Record<ComponentSlotId, Loader> = {
  'marketing.tab.annonser': () => import('../features/meta-ads/AnnonserTab'),
  'marketing.tab.omdomen': () => import('../features/google-business/OmdomenTab'),
  'marketing.tab.inlagg': () => import('../features/social-posting/InlaggTab'),
  'marketing.oversikt.ads': () => import('../features/meta-ads/AdsOverviewTiles'),
  'marketing.mottagare.segments': () => import('../features/guest-crm/SegmentsPanel'),
  'marketing.kampanjer.audience': () => import('../features/guest-crm/SegmentAudienceOptions'),
  'installningar.verksamhet.google': () => import('../features/google-business/GoogleProfileCard'),
  'installningar.verksamhet.waitlist': () => import('../features/waitlist/WaitlistSettingsCard'),
  'installningar.bokforing.sync': () => import('../features/accounting-sync/DirektbokforingCard'),
  'bokningar.panel.waitlist': () => import('../features/waitlist/QueuePanel'),
  'bokningar.reservation.badge': () => import('../features/guest-crm/GuestBadge'),
  'kassa.payment.giftcard': () => import('../features/gift-cards/KassaGiftCardButton'),
  'meny.dish.cost': () => import('../features/dish-margin/DishCostField'),
  'meny.dish.share': () => import('../features/social-posting/ShareDishAction'),
  'statistik.dishes.margin': () => import('../features/dish-margin/MarginChart'),
  'bokningar.panel.callbacks': () => import('../features/phone-agent/CallbacksPanel'),
  'bokningar.reservation.call': () => import('../features/phone-agent/CallBadge'),
  'statistik.events': () => import('../features/events-tickets/EventsStats'),
}

/** Det värdsidan skickar in till varje plats (CONTRACTS.md 8.2, kolumnen Props). */
export interface SlotProps {
  'marketing.tab.annonser': Record<string, never>
  'marketing.tab.omdomen': Record<string, never>
  'marketing.tab.inlagg': Record<string, never>
  'marketing.oversikt.ads': { locationId: string | null; from: string; to: string }
  'marketing.mottagare.segments': Record<string, never>
  'marketing.kampanjer.audience': {
    value: { type: 'segment'; exportId: string } | null
    onChange: (v: { type: 'segment'; exportId: string } | null) => void
  }
  'installningar.verksamhet.google': { locationId: string }
  'installningar.verksamhet.waitlist': { locationId: string }
  'installningar.bokforing.sync': Record<string, never>
  'bokningar.panel.waitlist': { locationId: string; date: string }
  'bokningar.reservation.badge': { locationId: string; reservationId: string; email?: string; phone?: string }
  'kassa.payment.giftcard': {
    locationId: string
    billId: string
    remainingOre: number
    onPaid: (p: { paymentId: string; amountOre: number }) => void
  }
  'meny.dish.cost': { locationId: string; menuItemId: string; priceSek: number; alcohol: boolean }
  'meny.dish.share': { locationId: string; menuItemId: string }
  'statistik.dishes.margin': { insights: InsightsResponse; locationId: string; from: string; to: string }
  'bokningar.panel.callbacks': { locationId: string; date: string }
  'bokningar.reservation.call': { locationId: string; reservationId: string }
  'statistik.events': { insights: InsightsResponse; locationId: string; from: string; to: string }
}

const LAZY = Object.fromEntries(
  Object.entries(SLOT_LOADERS).map(([id, load]) => [id, lazy(load)]),
) as Record<string, ComponentType<any>>

/**
 * Syns platsen för den här restaurangen och användaren? Tål en ofullständig
 * restaurang (äldre API-svar, tester) och räknar då funktionen som av.
 */
export function slotVisible(
  tenant: Partial<Pick<Tenant, 'entitlements' | 'role'>> | null | undefined,
  id: AdminSlotId,
): boolean {
  const { feature, ownerOnly } = ADMIN_SLOTS[id]
  const keys: FeatureKey[] = Array.isArray(feature) ? feature : [feature]
  const features = tenant?.entitlements?.features
  if (!keys.some((k) => Boolean(features?.[k]))) return false
  return !ownerOnly || tenant?.role === 'owner_user'
}

export function Slot<K extends ComponentSlotId>({ id, props }: { id: K; props: SlotProps[K] }) {
  const { tenant } = useTenant()
  if (!slotVisible(tenant, id)) return null
  const Component = LAZY[id]
  return (
    <Suspense fallback={null}>
      <Component {...props} />
    </Suspense>
  )
}
