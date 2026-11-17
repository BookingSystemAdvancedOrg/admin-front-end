import type { Tenant } from '../../shared/tenant'
import { WEEKDAYS } from './locationApi'
import type { BusinessHours, Location } from './locationApi'
import { planLabel } from './PlanCard'
import type { BranchId, TreeId } from './settingsTree'

/**
 * Äpplena: det viktigaste per träd, ur det inställningssidan redan har
 * hämtat. Tonen säger vad pricken betyder: 'ok' (grön) bara när något är
 * igång och fungerar, 'warn' när något behöver göras, ingen ton för val och
 * för det som är avstängt (SMS av, ljust läge, faktura).
 */
export type AppleTone = 'ok' | 'warn'

/** Ett äpple: det viktigaste i ett träd (status), ett tryck leder till grenen. */
export interface Apple {
  text: string
  branch: BranchId
  tone?: AppleTone
}

export interface AppleInput {
  tenant: Tenant | null
  isOwner: boolean
  /** Platsen saknas och letas inte upp: ingen plats än. */
  noLocation: boolean
  /** Öppettiderna är hämtade (eller sparade). */
  hours: BusinessHours | null
  locExtra: Pick<Location, 'guarantee' | 'ordering'> | null
  theme: string
  sound: boolean
  /** Dagens veckodag (för tester); i dag annars. */
  now?: Date
}

const HOURS_BRANCH: BranchId = 'dagar'

export function buildApples(i: AppleInput): Partial<Record<TreeId, Apple[]>> {
  const { tenant, isOwner, locExtra } = i
  const stripeReady = Boolean(tenant?.stripe.chargesEnabled)
  return {
    restaurangen: [
      ...(i.noLocation ? [{ text: 'Ingen plats än', branch: 'profil' as const, tone: 'warn' as const }] : []),
      ...(i.hours ? [todayApple(i.hours, i.now ?? new Date())] : []),
    ],
    gaster: [
      ...(tenant ? [tenant.notifications.sms ? { text: 'SMS på', branch: 'notiser' as const, tone: 'ok' as const } : { text: 'SMS av', branch: 'notiser' as const }] : []),
      ...(locExtra?.guarantee
        ? [locExtra.guarantee.enabled
          ? { text: stripeReady ? 'Kortgaranti på' : 'Kortgaranti väntar på Stripe', branch: 'avbokning' as const, tone: stripeReady ? 'ok' as const : 'warn' as const }
          : { text: 'Kortgaranti av', branch: 'avbokning' as const }]
        : []),
    ],
    bestallningar: locExtra?.ordering
      ? [locExtra.ordering.enabled
        ? { text: stripeReady ? 'Tar emot beställningar' : 'Beställning väntar på Stripe', branch: 'bestallning' as const, tone: stripeReady ? 'ok' as const : 'warn' as const }
        : { text: 'Tar inte emot beställningar', branch: 'bestallning' as const }]
      : [],
    ekonomi: [
      ...(tenant && isOwner ? [{ text: planLabel(tenant), branch: 'abonnemang' as const, ...(tenant.planId ? {} : { tone: 'warn' as const }) }] : []),
      ...(isOwner && tenant?.billing ? billingApple(tenant.billing) : []),
      ...(tenant ? [{ text: stripeReady ? 'Stripe aktiv' : 'Stripe ej klar', branch: 'betalningar' as const, tone: stripeReady ? 'ok' as const : 'warn' as const }] : []),
    ],
    personalen: isOwner && tenant?.staffAccess
      ? [{ text: `${tenant.staffAccess.defaults.length} av ${tenant.staffAccess.areas.length} sidor`, branch: 'behorighet' as const }]
      : [],
    enheten: [
      { text: i.theme === 'dark' ? 'Mörkt läge' : 'Ljust läge', branch: 'utseende' },
      { text: i.sound ? 'Klickljud på' : 'Klickljud av', branch: 'utseende' },
    ],
  }
}

/** Dagens öppettider ("Öppet i dag 11:00-22:00", grön) eller "Stängt i dag". */
function todayApple(hours: BusinessHours, now: Date): Apple {
  const day = WEEKDAYS[(now.getDay() + 6) % 7]
  const spans = hours[day] ?? []
  return spans.length
    ? { text: `Öppet i dag ${spans.map((s) => `${s.opensAt}-${s.closesAt}`).join(', ')}`, branch: HOURS_BRANCH, tone: 'ok' }
    : { text: 'Stängt i dag', branch: HOURS_BRANCH }
}

/** Abonnemangets betalning: kortet (grön), faktura (val), eller det som behöver göras. */
function billingApple(billing: NonNullable<Tenant['billing']>): Apple[] {
  if (billing.pastDue) return [{ text: 'Obetald faktura', branch: 'abonnemang', tone: 'warn' }]
  if (billing.hasCard && billing.cardLast4) return [{ text: `Kort ••${billing.cardLast4}`, branch: 'abonnemang', tone: 'ok' }]
  if (billing.customer && billing.collection === 'card' && !billing.hasCard) return [{ text: 'Inget kort', branch: 'abonnemang', tone: 'warn' }]
  if (billing.collection === 'invoice') return [{ text: 'Faktura', branch: 'abonnemang' }]
  return []
}
