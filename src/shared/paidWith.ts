/**
 * Hur gästen betalade (API:ts `paidWith`, application shared/payment_methods.py):
 * beställningar, privat catering och kortgarantin på en bokning. Allt går via
 * Stripe på restaurangens eget konto; brand och last4 finns bara för kort och
 * plånböcker (Apple Pay, Google Pay). Gästen erbjuds bara kort, Swish och
 * Klarna; PayPal, Link, Amazon Pay, Revolut Pay och MobilePay finns kvar så
 * att äldre betalningar heter rätt i stället för "Stripe".
 */

export type PaidWithMethod =
  | 'card' | 'apple_pay' | 'google_pay' | 'swish' | 'klarna'
  | 'paypal' | 'link' | 'amazon_pay' | 'revolut_pay' | 'mobilepay' | 'other'

export interface PaidWith {
  method: PaidWithMethod
  /** Stripes namn på kortet ("visa", "mastercard"). */
  brand?: string
  last4?: string
}

/** En återbetalning som Stripe först tog emot men som inte kom fram (Swish). */
export interface RefundFailure {
  /** Öre. */
  amount: number
  at?: string
  refundId?: string
  /** Betalsättet återbetalningen skulle tillbaka till (`PaidWithMethod`). */
  method?: string
}

const METHOD_LABEL: Record<PaidWithMethod, string> = {
  card: 'Kort',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  swish: 'Swish',
  klarna: 'Klarna',
  paypal: 'PayPal',
  link: 'Link',
  amazon_pay: 'Amazon Pay',
  revolut_pay: 'Revolut Pay',
  mobilepay: 'MobilePay',
  other: 'Stripe',
}

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  cartes_bancaires: 'Cartes Bancaires',
}

/** "Swish", "Apple Pay"; ett okänt betalsätt heter "Stripe". */
export function methodLabel(method: string | null | undefined): string {
  return method && Object.hasOwn(METHOD_LABEL, method) ? METHOD_LABEL[method as PaidWithMethod] : METHOD_LABEL.other
}

/** Bara fyra siffror räknas som kortets slut. */
function last4Of(value: string | undefined): string | null {
  return value && /^\d{4}$/.test(value) ? value : null
}

/**
 * "Visa ****4242", "Kort ****4242", "Kort", "Apple Pay", "Swish" ... eller
 * null utan uppgift (äldre betalningar).
 */
export function paidWithLabel(paid: PaidWith | null | undefined): string | null {
  if (!paid?.method) return null
  if (paid.method !== 'card') return methodLabel(paid.method)
  const brand = (paid.brand && BRAND_LABEL[paid.brand.toLowerCase()]) || null
  const last4 = last4Of(paid.last4)
  if (last4) return `${brand ?? METHOD_LABEL.card} ****${last4}`
  return brand ?? METHOD_LABEL.card
}

/**
 * Delarna av en beställnings betalning: presentkortet först, sedan resten
 * ("Presentkort ****1234", "Visa ****4242"). Tom lista utan uppgift.
 */
export function orderPaidParts(order: {
  paidWith?: PaidWith | null
  giftCard?: { last4?: string; debitedOre?: number } | null
}): string[] {
  const parts: string[] = []
  if ((order.giftCard?.debitedOre ?? 0) > 0) {
    const last4 = last4Of(order.giftCard?.last4)
    parts.push(last4 ? `Presentkort ****${last4}` : 'Presentkort')
  }
  const rest = paidWithLabel(order.paidWith)
  if (rest) parts.push(rest)
  return parts
}

/**
 * Varningen när en återbetalning inte kom fram: pengarna är tillbaka på
 * restaurangens Stripe-saldo och restaurangen betalar tillbaka själv.
 * `kronor` formaterar öre som sidan gör; `who` är "gästen" eller "kunden".
 * Null när inget har misslyckats.
 */
export function refundFailedText(
  failures: RefundFailure[] | null | undefined,
  kronor: (ore: number) => string,
  who: 'gästen' | 'kunden' = 'gästen',
): string | null {
  const list = (failures ?? []).filter((f) => f && f.amount > 0)
  if (!list.length) return null
  const total = list.reduce((sum, f) => sum + f.amount, 0)
  const methods = [...new Set(list.map((f) => f.method).filter((m): m is string => Boolean(m)).map(methodLabel))]
  const via = methods.length ? ` (${methods.join(', ')})` : ''
  const what = list.length === 1
    ? `Återbetalningen på ${kronor(total)} kom inte fram${via}.`
    : `${list.length} återbetalningar på totalt ${kronor(total)} kom inte fram${via}.`
  return `${what} Pengarna är tillbaka på ert Stripe-saldo: betala tillbaka till ${who} på annat sätt.`
}
