import { ApiError } from './api'

/**
 * Felmeddelanden som visas för användaren. Alla sidor går hit till slut, så
 * texten följer samma mönster överallt: vad hände, varför (när vi vet) och
 * vad man kan göra. Råtext från servern (engelska valideringsmeddelanden,
 * Stripe, AWS) visas aldrig: koden mappas, okända koder får `action` plus en
 * text för statusen.
 *
 *   setError(errorText(err, 'Kunde inte spara.'))
 */

/** Koder som betyder samma sak var de än kommer ifrån. */
const COMMON: Record<string, string> = {
  network: 'Ingen kontakt med servern. Kontrollera internetanslutningen och försök igen.',
  timeout: 'Servern svarade inte i tid. Försök igen om en stund.',
  unauthorized: 'Du har loggats ut. Logga in igen och försök på nytt.',
  not_signed_in: 'Du har loggats ut. Logga in igen och försök på nytt.',
  forbidden: 'Ditt konto har inte behörighet till det här. Be ägaren om åtkomst.',
  owner_only: 'Bara restaurangens ägare kan göra det här.',
  staff_no_access: 'Ditt konto har inte behörighet till det här. Be ägaren om åtkomst.',
  no_tenant: 'Ditt konto är inte kopplat till någon restaurang. Logga ut och in igen, eller kontakta Booqy.',
  tenant_inactive: 'Restaurangens konto är pausat. Kontakta Booqy för att öppna det igen.',
  feature_not_in_plan: 'Funktionen ingår inte i ert abonnemang. Kontakta Booqy om ni vill lägga till den.',
  plan_limit_reached: 'Ni har nått gränsen i ert abonnemang. Kontakta Booqy för att utöka det.',
  dpa_version_outdated: 'Biträdesavtalet har uppdaterats. Godkänn det nya avtalet under Avtal först.',
  changed_retry: 'Någon annan ändrade samtidigt. Ladda om sidan och gör ändringen igen.',
  conflict: 'Någon annan ändrade samtidigt. Ladda om sidan och gör ändringen igen.',
  too_many_requests: 'För många försök på kort tid. Vänta en minut och försök igen.',
  too_many_attempts: 'För många försök på kort tid. Vänta en minut och försök igen.',
  too_large: 'Det du skickade är för stort. Gör det mindre och försök igen.',
  invalid_json: 'Uppgifterna kunde inte läsas. Ladda om sidan och försök igen.',
  unsupported_fields: 'Sidan är inaktuell. Ladda om den och försök igen.',
  method_not_allowed: 'Sidan är inaktuell. Ladda om den och försök igen.',
  stripe_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund.',
  stripe_refused: 'Stripe avvisade begäran. Kontrollera betalinställningarna och försök igen.',
  payment_unavailable: 'Betaltjänsten svarar inte just nu. Försök igen om en stund.',
  no_stripe_account: 'Kortbetalningar är inte aktiverade än. Slutför Stripe-kopplingen under Inställningar.',
  internal_error: 'Något gick fel hos oss. Försök igen om en stund; kvarstår det, kontakta Booqy.',
  service_unavailable: 'Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.',
}

/** Varför, för fel utan egen text: läggs efter `action`. */
function statusReason(status: number, code: string): string {
  if (code.endsWith('_unavailable') || code.endsWith('service_unavailable')) return 'Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.'
  if (code === 'required') return 'Ett obligatoriskt fält saknas. Fyll i det markerade och försök igen.'
  if (code === 'invalid_value' || code === 'invalid_request') return 'Något av fälten har ett värde som inte godtas. Kontrollera uppgifterna och försök igen.'
  if (status === 404 || code.endsWith('not_found')) return 'Det finns inte längre. Ladda om sidan.'
  if (status === 409) return 'Läget har ändrats sedan sidan laddades. Ladda om och försök igen.'
  if (status === 402) return 'Betalningen gick inte igenom. Försök igen eller använd ett annat kort.'
  if (status >= 500) return 'Servern svarar inte just nu. Försök igen om en stund; efter en ändring, ladda om först och se om den gick igenom.'
  return 'Kontrollera uppgifterna och försök igen.'
}

const RAW = /^[a-z][a-z0-9_]*$|^(Failed to fetch|Load failed|NetworkError|Network request failed|Internal Server Error|Service Unavailable|Not Found|Forbidden|Unauthorized)/i

/** Våra egna texter är hela meningar; "offline", "x" eller engelska fragment är det inte. */
function isSentence(text: string): boolean {
  return /^[A-ZÅÄÖ0-9].*[.!?)]$/s.test(text.trim()) && !RAW.test(text)
}

function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/** Felets kod: API:ts, eller 'network'/'timeout' för fel som aldrig nådde fram. */
export function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError) return err.code
  if (err instanceof TypeError) return 'network'
  if (isTimeout(err)) return 'timeout'
  return undefined
}

/**
 * Text att visa för ett fel. `action` säger vad som inte gick ("Kunde inte
 * spara."); `known` är sidans egna texter per kod, som går före de gemensamma;
 * `labels` namnger fälten ({ deliveryFee: 'leveransavgiften' }) så ett
 * valideringsfel kan peka ut vilket fält som inte godtogs.
 */
export function errorText(
  err: unknown,
  action = 'Det gick inte.',
  known: Record<string, string> = {},
  labels: Record<string, string> = {},
): string {
  const code = errorCode(err)
  if (code && known[code]) return known[code]
  const label = err instanceof ApiError && err.fromServer && err.field
    ? labels[err.field] ?? labels[err.field.split(/[.[]/)[0]]
    : undefined
  if (label) return `${action} Kontrollera ${label} och försök igen.`
  if (err instanceof ApiError && !err.fromServer && code !== 'network') {
    // redan översatt av en feature (new ApiError(409, 'Bordet är upptaget.'))
    return isSentence(err.message) ? err.message : `${action} ${statusReason(err.status, code ?? '')}`
  }
  if (code && COMMON[code]) return COMMON[code]
  if (err instanceof ApiError) return `${action} ${statusReason(err.status, err.code)}`
  if (err instanceof Error && isSentence(err.message)) return err.message
  return `${action} Försök igen om en stund.`
}

/**
 * Ett valideringsfel från servern som gäller ett visst fält: flytta fokus
 * dit (och markera texten), så användaren rättar och trycker Spara igen.
 * `ids` mappar API:ts fältnamn till inputens id. Returnerar true om ett fält
 * fick fokus.
 */
export function focusErrorField(err: unknown, ids: Record<string, string>): boolean {
  const field = (err as { field?: unknown } | null)?.field
  if (typeof field !== 'string') return false
  const id = ids[field] ?? ids[field.split(/[.[]/)[0]]
  const el = id ? document.getElementById(id) : null
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false
  el.setAttribute('aria-invalid', 'true')
  el.focus()
  if (!(el instanceof HTMLSelectElement)) el.select()
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true })
  return true
}
