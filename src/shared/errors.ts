import { ApiError } from './api'

/**
 * Felmeddelanden som visas för användaren. Alla sidor går hit till slut, så
 * texten följer samma regel överallt: varje fel säger vem som gör något.
 *
 * - Användaren kan åtgärda det själv: texten säger exakt vad, och felet har
 *   en länk till rätt ställe ("Godkänn det nya avtalet under Avtal." med
 *   knappen Öppna Avtal -> /avtal).
 * - Felet ligger hos Booqy (5xx, *_unavailable, internal_error,
 *   AccessDenied, okända koder): texten säger det, och felrutan får
 *   knapparna Försök igen och Rapportera till Booqy (shared/ErrorNote).
 *
 * Råtext från servern (engelska valideringsmeddelanden, Stripe, AWS) visas
 * aldrig: koden mappas, okända koder räknas som Booqys fel.
 *
 *   setError(errorText(err, 'Kunde inte spara.'))
 *   <ErrorNote text={error} />
 */

export type ErrorActor = 'user' | 'booqy'

/** En knapp i felrutan som leder dit användaren rättar felet. */
export interface ErrorLink {
  to: string
  label: string
}

export interface ErrorInfo {
  text: string
  actor: ErrorActor
  link?: ErrorLink
  code: string
  status: number
  requestId?: string
}

/** Läggs efter texten när felet ligger hos Booqy. */
export const BOOQY_FAULT = 'Felet ligger hos Booqy, inte hos er. Försök igen; kvarstår det, rapportera det till Booqy.'
/** För en tjänst vi använder (Stripe, Google, Meta) som inte svarar. */
export const NOT_YOUR_FAULT = 'Det är inte ert fel: försök igen, eller rapportera det till Booqy om det kvarstår.'

interface Mapped {
  text: string
  actor: ErrorActor
  link?: ErrorLink
}

const user = (text: string, link?: ErrorLink): Mapped => ({ text, actor: 'user', ...(link ? { link } : {}) })
const booqy = (text: string): Mapped => ({ text, actor: 'booqy' })

const LINK = {
  avtal: { to: '/avtal', label: 'Öppna Avtal' },
  plan: { to: '/installningar#profil', label: 'Se abonnemanget' },
  payments: { to: '/installningar#betalningar', label: 'Öppna Betalningar' },
  personal: { to: '/personal', label: 'Öppna Personal' },
  login: { to: '/logga-in', label: 'Logga in' },
} satisfies Record<string, ErrorLink>

/** Koder som betyder samma sak var de än kommer ifrån. */
const COMMON: Record<string, Mapped> = {
  network: user('Ingen kontakt med servern. Kontrollera internetanslutningen (wifi eller mobildata) och försök igen.'),
  unauthorized: user('Du har loggats ut. Logga in igen och gör om det du höll på med.', LINK.login),
  not_signed_in: user('Du har loggats ut. Logga in igen och gör om det du höll på med.', LINK.login),
  forbidden: user('Ditt konto har inte behörighet till det här. Be restaurangens ägare ge dig åtkomst under Personal.'),
  staff_no_access: user('Ditt konto har inte behörighet till det här. Be restaurangens ägare ge dig åtkomst under Personal.'),
  owner_only: user('Bara restaurangens ägare kan göra det här. Be ägaren göra det, eller logga in med ägarens konto.'),
  tenant_inactive: user('Restaurangens konto är pausat. Ägaren öppnar det igen genom att kontakta Booqy (svara på senaste fakturan eller mejlet från oss).'),
  feature_not_in_plan: user('Funktionen ingår inte i ert abonnemang. Ägaren kan se vad som ingår och be Booqy lägga till den.', LINK.plan),
  plan_limit_reached: user('Ni har nått gränsen i ert abonnemang. Ägaren kan se gränserna och be Booqy utöka abonnemanget.', LINK.plan),
  dpa_version_outdated: user('Biträdesavtalet har uppdaterats. Ägaren godkänner det nya avtalet under Avtal, sedan går det igen.', LINK.avtal),
  dpa_required: user('Biträdesavtalet behöver godkännas först. Ägaren godkänner det under Avtal.', LINK.avtal),
  changed_retry: user('Någon annan ändrade samtidigt. Det senaste visas nu; gör ändringen igen om den fortfarande behövs.'),
  conflict: user('Någon annan ändrade samtidigt. Det senaste visas nu; gör ändringen igen om den fortfarande behövs.'),
  too_many_requests: user('För många försök på kort tid. Vänta en minut och försök igen.'),
  too_many_attempts: user('För många försök på kort tid. Vänta en minut och försök igen.'),
  rate_limited: user('För många försök på kort tid. Vänta en minut och försök igen.'),
  too_large: user('Det du skickade är för stort. Gör det mindre (kortare text eller mindre bild) och försök igen.'),
  unsupported_fields: user('Den här versionen av appen är för gammal för ändringen. Tryck Ladda om i rutan om den nya versionen och gör ändringen igen.'),
  method_not_allowed: user('Den här versionen av appen är för gammal för ändringen. Tryck Ladda om i rutan om den nya versionen och gör ändringen igen.'),
  stripe_refused: user('Stripe avvisade begäran. Kontrollera betalinställningarna under Betalningar och försök igen.', LINK.payments),
  no_stripe_account: user('Kortbetalningar är inte aktiverade än. Ägaren slutför Stripe-kopplingen under Betalningar.', LINK.payments),
  no_tenant: booqy(`Ditt konto är inte kopplat till någon restaurang. Logga ut och in igen. ${BOOQY_FAULT}`),
  timeout: booqy(`Servern svarade inte i tid. ${BOOQY_FAULT}`),
  invalid_json: booqy(`Appen skickade något servern inte kunde läsa. ${BOOQY_FAULT}`),
  stripe_unavailable: booqy(`Stripe svarar inte just nu. ${NOT_YOUR_FAULT}`),
  payment_unavailable: booqy(`Betaltjänsten svarar inte just nu. ${NOT_YOUR_FAULT}`),
  internal_error: booqy(`Något gick fel hos oss. ${BOOQY_FAULT}`),
  service_unavailable: booqy(`Tjänsten är tillfälligt otillgänglig. ${BOOQY_FAULT}`),
  access_denied: booqy(`Något gick fel hos oss. ${BOOQY_FAULT}`),
  accessdenied: booqy(`Något gick fel hos oss. ${BOOQY_FAULT}`),
  accessdeniedexception: booqy(`Något gick fel hos oss. ${BOOQY_FAULT}`),
}

/** Koder vars betydelse vi känner igen på formen, när ingen text finns för just den. */
function byShape(status: number, code: string): Mapped | null {
  if (code === 'network') return COMMON.network
  if (status >= 500 || code.endsWith('_unavailable') || /access_?denied/i.test(code)) return booqy(BOOQY_FAULT)
  if (code === 'required') return user('Ett obligatoriskt fält saknas. Fyll i det markerade fältet och försök igen.')
  if (code === 'invalid_request') return user('Något av uppgifterna godtas inte. Kontrollera det du fyllt i och försök igen.')
  if (code === 'invalid_value') return user('Något av fälten har ett värde som inte godtas. Kontrollera uppgifterna och försök igen.')
  if (status === 404 || code === 'not_found' || code.endsWith('_not_found')) return user('Det har tagits bort på annat håll. Sidan visar nu det som finns kvar.')
  if (status === 409) return user('Läget ändrades på annat håll. Det senaste visas nu; gör ändringen igen om den fortfarande behövs.')
  if (status === 402) return user('Betalningen gick inte igenom. Försök igen eller använd ett annat kort.')
  if (status === 401) return COMMON.unauthorized
  if (status === 429) return COMMON.too_many_requests
  if (status === 413) return COMMON.too_large
  return null
}

/** Är felet Booqys enligt status och kod (för texter en sida redan har översatt)? */
export function isBooqyFault(status: number, code: string): boolean {
  return status >= 500 || code === 'timeout' || code.endsWith('_unavailable') || /access_?denied/i.test(code)
    || code === 'internal_error' || code === 'invalid_json'
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

function joined(action: string, text: string): string {
  return action ? `${action} ${text}` : text
}

/**
 * Felet som text plus vem som gör något (och vart användaren ska).
 * `action` säger vad som inte gick ("Kunde inte spara."); `known` är sidans
 * egna texter per kod, som går före de gemensamma; `labels` namnger fälten
 * ({ deliveryFee: 'leveransavgiften' }) så ett valideringsfel kan peka ut
 * vilket fält som inte godtogs.
 */
export function describeError(
  err: unknown,
  action = 'Det gick inte.',
  known: Record<string, string> = {},
  labels: Record<string, string> = {},
): ErrorInfo {
  const code = errorCode(err) ?? 'unknown'
  const status = err instanceof ApiError ? err.status : 0
  const requestId = err instanceof ApiError ? err.requestId : undefined
  const info = (m: Mapped): ErrorInfo => ({ ...m, code, status, ...(requestId ? { requestId } : {}) })

  if (known[code]) return info({ text: known[code], actor: isBooqyFault(status, code) ? 'booqy' : 'user' })
  const label = err instanceof ApiError && err.fromServer && err.field
    ? labels[err.field] ?? labels[err.field.split(/[.[]/)[0]]
    : undefined
  if (label) return info(user(`${action} Kontrollera ${label} och försök igen.`))
  if (err instanceof ApiError && !err.fromServer && code !== 'network') {
    // redan översatt av en feature (new ApiError(409, 'Bordet är upptaget.'))
    if (isSentence(err.message)) return info({ text: err.message, actor: isBooqyFault(status, code) ? 'booqy' : 'user' })
  }
  const common = COMMON[code] ?? COMMON[code.toLowerCase()]
  if (common) return info(common)
  if (err instanceof ApiError || code === 'network' || code === 'timeout') {
    const shape = byShape(status, code)
    if (shape) return info({ ...shape, text: shape.actor === 'booqy' || code === 'invalid_value' || code === 'required' || code === 'invalid_request' ? joined(action, shape.text) : shape.text })
    // En kod appen inte känner till: räknas som Booqys fel.
    return info(booqy(joined(action, BOOQY_FAULT)))
  }
  if (err instanceof Error && isSentence(err.message)) return info(user(err.message))
  return info(booqy(joined(action, BOOQY_FAULT)))
}

/**
 * Senaste felen, så felrutan (ErrorNote) kan hitta vem som gör något
 * utifrån texten som sidan sparat i sitt state. Högst 50 åt gången.
 */
const registry = new Map<string, ErrorInfo>()
const REGISTRY_MAX = 50

export function rememberError(info: ErrorInfo): void {
  registry.delete(info.text)
  registry.set(info.text, info)
  while (registry.size > REGISTRY_MAX) registry.delete(registry.keys().next().value as string)
}

/** Vem som gör något för en text errorText gav, om den kom därifrån. */
export function errorInfo(text: string | null | undefined): ErrorInfo | undefined {
  return text ? registry.get(text) : undefined
}

/** Felet som text att visa (och felrutans knappar via errorInfo). */
export function errorText(
  err: unknown,
  action = 'Det gick inte.',
  known: Record<string, string> = {},
  labels: Record<string, string> = {},
): string {
  const info = describeError(err, action, known, labels)
  rememberError(info)
  return info.text
}

/**
 * Ett laddningsfel en sida skriver själv ("Kunde inte hämta siffrorna."):
 * Booqys fel, med samma knappar som alla andra.
 */
export function booqyFaultText(action: string, code = 'load_failed'): string {
  // Utan nät är det anslutningen, inte Booqy.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const text = joined(action, COMMON.network.text)
    rememberError({ text, actor: 'user', code: 'network', status: 0 })
    return text
  }
  const text = joined(action, BOOQY_FAULT)
  rememberError({ text, actor: 'booqy', code, status: 0 })
  return text
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
