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
 *   setError(errorText(err, 'Menyn sparades inte.'))
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
export const BOOQY_FAULT = 'Felet ligger hos Booqy, inte hos er. Försök igen, eller tryck Rapportera till Booqy.'
/** För en tjänst vi använder (Stripe, Google, Meta) som inte svarar. */
export const NOT_YOUR_FAULT = 'Det är inte ert fel. Försök igen om en stund, eller rapportera det till Booqy.'

interface Mapped {
  text: string
  actor: ErrorActor
  link?: ErrorLink
}

const user = (text: string, link?: ErrorLink): Mapped => ({ text, actor: 'user', ...(link ? { link } : {}) })
const booqy = (text: string): Mapped => ({ text, actor: 'booqy' })

const LINK = {
  avtal: { to: '/avtal', label: 'Öppna Avtal' },
  plan: { to: '/installningar#abonnemang', label: 'Se abonnemanget' },
  payments: { to: '/installningar#betalningar', label: 'Öppna Betalningar' },
  personal: { to: '/personal', label: 'Öppna Personal' },
  login: { to: '/logga-in', label: 'Logga in' },
} satisfies Record<string, ErrorLink>

/** Ingen kontakt alls: anslutningen, inte Booqy. */
export const NETWORK = 'Vi når inte Booqy just nu. Kolla att wifi eller mobildata är på och försök igen.'
const SIGNED_OUT = 'Du har blivit utloggad. Logga in igen och gör om det du höll på med.'
const NO_ACCESS = 'Ditt konto får inte göra det här. Be ägaren ge dig tillgång under Personal.'
const CHANGED = 'Någon annan ändrade samma sak samtidigt. Nu syns det senaste. Gör din ändring igen om den behövs.'
const TOO_MANY = 'Det blev för många försök på kort tid. Vänta en minut och försök igen.'
const OLD_APP = 'Appen behöver uppdateras först. Ladda om sidan, eller starta om appen, och gör ändringen igen.'

/** Koder som betyder samma sak var de än kommer ifrån. */
const COMMON: Record<string, Mapped> = {
  network: user(NETWORK),
  unauthorized: user(SIGNED_OUT, LINK.login),
  not_signed_in: user(SIGNED_OUT, LINK.login),
  forbidden: user(NO_ACCESS),
  staff_no_access: user(NO_ACCESS),
  no_access: user(NO_ACCESS),
  owner_only: user('Bara restaurangens ägare kan göra det här. Be ägaren göra det åt dig.'),
  tenant_inactive: user('Restaurangens konto är pausat. Ägaren kan öppna det igen genom att kontakta Booqy.'),
  feature_not_in_plan: user('Det här ingår inte i ert abonnemang. Ägaren kan be Booqy lägga till det.', LINK.plan),
  plan_limit_reached: user('Ni har nått gränsen i ert abonnemang. Ägaren kan be Booqy om ett större abonnemang.', LINK.plan),
  dpa_version_outdated: user('Avtalet med Booqy har ändrats. Ägaren behöver godkänna det nya under Avtal först.', LINK.avtal),
  dpa_required: user('Ägaren behöver godkänna avtalet med Booqy först. Det görs under Avtal.', LINK.avtal),
  changed_retry: user(CHANGED),
  conflict: user(CHANGED),
  too_many_requests: user(TOO_MANY),
  too_many_attempts: user(TOO_MANY),
  rate_limited: user(TOO_MANY),
  too_large: user('Det du skickade är för stort. Korta texten eller välj en mindre bild, och försök igen.'),
  unsupported_fields: user(OLD_APP),
  method_not_allowed: user(OLD_APP),
  stripe_refused: user('Stripe sa nej. Kolla inställningarna under Betalningar och försök igen.', LINK.payments),
  no_stripe_account: user('Kortbetalning är inte påslaget än. Ägaren kopplar Stripe under Betalningar.', LINK.payments),
  no_tenant: booqy(`Ditt konto är inte kopplat till någon restaurang. Logga ut och in igen. ${BOOQY_FAULT}`),
  timeout: booqy(`Booqy svarade inte i tid. ${BOOQY_FAULT}`),
  route_not_found: booqy(`Den här delen av Booqy svarar inte. ${BOOQY_FAULT}`),
  invalid_json: booqy(`Booqy kunde inte läsa det appen skickade. ${BOOQY_FAULT}`),
  stripe_unavailable: booqy(`Stripe svarar inte just nu. ${NOT_YOUR_FAULT}`),
  payment_unavailable: booqy(`Betaltjänsten svarar inte just nu. ${NOT_YOUR_FAULT}`),
  internal_error: booqy(`Något gick snett. ${BOOQY_FAULT}`),
  service_unavailable: booqy(`Booqy svarar inte just nu. ${BOOQY_FAULT}`),
  access_denied: booqy(`Något gick snett. ${BOOQY_FAULT}`),
  accessdenied: booqy(`Något gick snett. ${BOOQY_FAULT}`),
  accessdeniedexception: booqy(`Något gick snett. ${BOOQY_FAULT}`),
}

/** Koder vars betydelse vi känner igen på formen, när ingen text finns för just den. */
function byShape(status: number, code: string): Mapped | null {
  if (code === 'network') return COMMON.network
  if (status >= 500 || code.endsWith('_unavailable') || /access_?denied/i.test(code)) return booqy(BOOQY_FAULT)
  if (code === 'required') return user('Ett fält som måste fyllas i är tomt. Fyll i det markerade fältet och försök igen.')
  if (code === 'invalid_request') return user('Något av det du fyllt i ser inte rätt ut. Kolla fälten och försök igen.')
  if (code === 'invalid_value') return user('Ett av fälten ser inte rätt ut. Kolla fälten och försök igen.')
  if (code === 'route_not_found') return booqy(BOOQY_FAULT)
  if (status === 404 || code === 'not_found' || code.endsWith('_not_found')) return user('Det finns inte längre, någon har tagit bort det. Nu syns det som finns kvar.')
  if (status === 409) return user(CHANGED)
  if (status === 402) return user('Betalningen gick inte igenom. Försök igen eller använd ett annat kort.')
  if (status === 401) return COMMON.unauthorized
  if (status === 429) return COMMON.too_many_requests
  if (status === 413) return COMMON.too_large
  return null
}

/** Är felet Booqys enligt status och kod (för texter en sida redan har översatt)? */
export function isBooqyFault(status: number, code: string): boolean {
  return status >= 500 || code === 'timeout' || code.endsWith('_unavailable') || /access_?denied/i.test(code)
    || code === 'internal_error' || code === 'invalid_json' || code === 'route_not_found'
}

const ASKS_REPORT = /rapportera det till Booqy|Rapportera till Booqy/

const RAW = /^[a-z][a-z0-9_]*$|^(Failed to fetch|Load failed|NetworkError|Network request failed|Internal Server Error|Service Unavailable|Not Found|Forbidden|Unauthorized)/i

/** Engelska ord som aldrig finns i våra svenska texter (webbläsarens och biblioteks egna fel). */
const ENGLISH = /\b(the|was|were|failed|error|cannot|invalid|must|unexpected|undefined|exception|request|response|could not|unable)\b/i

/** Våra egna texter är hela meningar; "offline", "x" eller engelska fragment är det inte. */
function isSentence(text: string): boolean {
  return /^[A-ZÅÄÖ0-9].*[.!?)]$/s.test(text.trim()) && !RAW.test(text) && !ENGLISH.test(text)
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

  // En text som ber om en rapport får också knappen Rapportera till Booqy.
  if (known[code]) return info({ text: known[code], actor: isBooqyFault(status, code) || ASKS_REPORT.test(known[code]) ? 'booqy' : 'user' })
  const label = err instanceof ApiError && err.fromServer && err.field
    ? labels[err.field] ?? labels[err.field.split(/[.[]/)[0]]
    : undefined
  if (label) return info(user(`${action} Kolla ${label} och försök igen.`))
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
  // Rullistan (shared/Select) är en knapp med role="combobox".
  const combobox = el instanceof HTMLButtonElement && el.getAttribute('role') === 'combobox'
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || combobox)) return false
  el.setAttribute('aria-invalid', 'true')
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select()
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true })
  return true
}
