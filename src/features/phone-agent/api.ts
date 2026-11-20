import { apiFetch, isApiConfigured, ApiError } from '../../shared/api'
import { getLocation as getPlace, type BusinessHours } from '../installningar/locationApi'

/**
 * Telefonassistenten (CONTRACTS.md 6.L, L1-L12, L19). Utan API
 * (VITE_API_BASE_URL osatt) körs allt på mockdata längst ned.
 */

export type Mode = 'after_hours' | 'overflow' | 'always'
export type Operator = 'telia' | 'tele2' | 'telenor' | 'tre' | 'telia_fast' | 'vaxel' | 'other'
export interface ForwardingCode { label: string; on: string; off: string }
/** En kod som stänger av en äldre vidarekoppling; ringas före koderna. */
export interface ResetCode { label: string; on: string }
export interface Setup { operator: Operator | null; forwardedAt: string | null; testedAt: string | null }
export type Outcome = 'booked' | 'moved' | 'cancelled' | 'info' | 'transferred' | 'callback' | 'abandoned' | 'refused' | 'error'
export type CounterOffer = 'none' | 'other_time' | 'next_day' | 'nearby_table'
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface Span { from: string; to: string }
/** Samtalsspråk (ISO-kod): assistenten börjar på svenska och byter till uppringarens språk. */
export type Lang = string
const LANG_NAMES = new Intl.DisplayNames(['sv'], { type: 'language' })
/** "engelska" för "en"; koden själv om webbläsaren inte känner den. */
export function langLabel(code: string): string {
  try { return LANG_NAMES.of(code) ?? code } catch { return code }
}

export interface Config {
  agentName: string
  tone: 'formal' | 'friendly'
  languages: Lang[]
  recording: { enabled: boolean; purpose?: string; retentionDays?: number }
  minutesCapPerMonth: number
  version: number
}
export interface Overview {
  config: Config
  locations: { locationId: string; name: string; enabled: boolean; killSwitch: boolean; mode: Mode; number: string | null; minutesThisPeriod: number }[]
  usage: { minutes: number; cap: number; includedMinutes: number; periodEnd: string }
}
export interface LocationConfig {
  locationId: string
  enabled: boolean
  killSwitch: boolean
  mode: Mode
  agentHours: Partial<Record<Day, Span[]>>
  greetingExtraSv: string
  greetingExtraEn: string
  transferTo?: string | null
  maxCallSeconds: number
  counterOffers: { nearbyTables: boolean; phoneOnlyTables: boolean }
  /** Största sällskap assistenten bokar själv; null = samma gräns som online. */
  phoneMaxPartySize?: number | null
  number: string | null
  /** Platsen svarar på en annan plats nummer (assistenten frågar först vilken restaurang). */
  numberSharedWith?: string | null
  version: number
  /** Hur långt kom igång har kommit (POST .../setup). */
  setup?: Setup
  /** Telefonileverantören är simulatorn (dev utan riktig operatör). */
  simulated?: boolean
  /** Testlinjen i dev som går till platsen (aldrig i prod). */
  testNumber?: string
  forwarding?: { number: string | null; operator?: Operator; reset?: ResetCode[]; codes: ForwardingCode[] }
}
export interface CallRow {
  callId: string
  startedAt: string
  durationSec: number
  language: string
  outcome: Outcome | null
  counterOffer: CounterOffer
  reservationId: string | null
  callbackId: string | null
  summary: string
  refusedReason?: string | null
  from?: string | null
}
/** Översättningen av en tur, görs efter samtalet (phone-agent-translate). */
export type Translation = 'pending' | 'done' | 'failed' | 'skipped'
export interface Turn {
  role: 'agent' | 'caller' | 'tool' | 'system'
  /** Originalet, som det sades. Ändras aldrig. */
  text: string
  at: string
  toolName?: string
  toolOk?: boolean
  /** Samtalets språk när turen sades (ISO-kod). */
  lang?: Lang
  /** Uppringarens turer: taligenkänningens språk (Lex-locale), t.ex. sv_SE. */
  asrLocale?: string
  /** Översatt till svenska respektive engelska; saknas när turen redan var på det språket. */
  textSv?: string
  textEn?: string
  translation?: Translation
}
export interface CallDetail extends CallRow {
  billedMinutes: number
  disclosure: { text?: string; playedAt?: string | null; spoken?: string; verbatim?: boolean; repeats?: number; languages?: string[] }
  turns: Turn[]
  recordingUrl?: string
}
export interface Callback {
  callbackId: string
  callId: string
  name: string
  phone: string
  topic: string
  preferredTime: string | null
  status: 'open' | 'closed'
  createdAt: string
  closedAt: string | null
  note: string
  version: number
}
export interface SimReply { reply: string; language?: Lang; toolCalls: { name: string; ok: boolean }[]; state: { outcome?: string | null }; disclosure: boolean }

const loc = (id: string) => `/locations/${encodeURIComponent(id)}/phone-agent`

export type LocationBody = Pick<LocationConfig, 'enabled' | 'mode' | 'agentHours' | 'greetingExtraSv' | 'greetingExtraEn'
  | 'transferTo' | 'maxCallSeconds' | 'counterOffers' | 'phoneMaxPartySize' | 'version'> & { shareNumberWith?: string | null }
export interface SetupBody { operator?: Operator; forwarded?: boolean; tested?: boolean; version: number }

export const getOverview = () => (isApiConfigured() ? apiFetch<Overview>('/tenant/phone-agent') : mock.overview())
export const saveConfig = (c: Omit<Config, 'version'> & { version: number }) => (isApiConfigured()
  ? apiFetch<Config>('/tenant/phone-agent/config', { method: 'PUT', body: JSON.stringify(c) }) : mock.saveConfig(c))
export const getLocation = (locationId: string) => (isApiConfigured() ? apiFetch<LocationConfig>(loc(locationId)) : mock.location())
export const saveLocation = (locationId: string, body: LocationBody) => (isApiConfigured()
  ? apiFetch<LocationConfig>(loc(locationId), { method: 'PUT', body: JSON.stringify(body) }) : mock.saveLocation(body))
/** Kom igång-steg (operatör, vidarekopplat, provsamtal): sparas utan att röra leverantörerna. */
export const postSetup = (locationId: string, body: SetupBody) => (isApiConfigured()
  ? apiFetch<LocationConfig>(`${loc(locationId)}/setup`, { method: 'POST', body: JSON.stringify(body) }) : mock.postSetup(body))
export const setKillSwitch = (locationId: string, on: boolean, version: number) => (isApiConfigured()
  ? apiFetch<LocationConfig>(`${loc(locationId)}/kill-switch`, { method: 'POST', body: JSON.stringify({ on, version }) })
  : mock.killSwitch(on, version))
export const simulate = (locationId: string, sessionId: string, text: string, language?: Lang) => (isApiConfigured()
  ? apiFetch<SimReply>(`${loc(locationId)}/simulate`, { method: 'POST', body: JSON.stringify({ sessionId, text, ...(language ? { language } : {}) }) })
  : mock.simulate(text))
export const listCalls = (locationId: string, from: string, to: string, cursor?: string | null) => {
  if (!isApiConfigured()) return mock.calls()
  const q = new URLSearchParams({ from, to })
  if (cursor) q.set('cursor', cursor)
  return apiFetch<{ calls: CallRow[]; cursor: string | null }>(`${loc(locationId)}/calls?${q}`)
}

/** Platsens öppettider och eget telefonnummer (Inställningar), för tiderna och provsamtalet. */
export async function getPlaceBasics(locationId: string): Promise<{ businessHours: BusinessHours | null; phoneNumber: string | null }> {
  if (!isApiConfigured()) return mock.place()
  const place = await getPlace(locationId)
  return { businessHours: place.businessHours ?? null, phoneNumber: place.phoneNumber ?? null }
}
export const getCall = (locationId: string, callId: string) => (isApiConfigured()
  ? apiFetch<CallDetail>(`${loc(locationId)}/calls/${encodeURIComponent(callId)}`) : mock.call(callId))
export const deleteRecording = (locationId: string, callId: string) =>
  apiFetch<void>(`${loc(locationId)}/calls/${encodeURIComponent(callId)}/recording`, { method: 'DELETE' })
export const listCallbacks = (locationId: string, status: 'open' | 'closed' | 'all' = 'open') =>
  apiFetch<{ callbacks: Callback[] }>(`${loc(locationId)}/callbacks?status=${status}`).then((r) => r.callbacks)
export const closeCallback = (locationId: string, cb: Callback, note?: string) =>
  apiFetch<Callback>(`${loc(locationId)}/callbacks/${encodeURIComponent(cb.callbackId)}/close`, {
    method: 'POST', body: JSON.stringify({ version: cb.version, ...(note ? { note } : {}) }),
  })

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/** Dagens datum i Stockholm, "2026-11-05". */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

export function daysAgo(n: number): string {
  const d = new Date(`${today()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short' })
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  booked: 'Bokade bord',
  moved: 'Flyttade bokning',
  cancelled: 'Avbokade',
  info: 'Svarade på frågor',
  transferred: 'Kopplad till er',
  callback: 'Vill bli uppringd',
  abandoned: 'Lade på',
  refused: 'Inte besvarat',
  error: 'Något gick fel',
}
export const COUNTER_LABEL: Record<CounterOffer, string> = {
  none: '',
  other_time: 'Erbjöd annan tid',
  next_day: 'Erbjöd dagen efter',
  nearby_table: 'Erbjöd bord bredvid',
}
export const REFUSED_LABEL: Record<string, string> = {
  cap: 'minuterna för perioden var slut',
  kill_switch: 'assistenten var avstängd',
  hours: 'utanför assistentens tider',
  paused: 'pausad av Booqy',
  entitlement: 'assistenten är inte på',
}
export const MODE_LABEL: Record<Mode, string> = {
  after_hours: 'När ni har stängt',
  overflow: 'När ni inte hinner svara',
  always: 'Alltid',
}
export const DAYS: { key: Day; label: string }[] = [
  { key: 'mon', label: 'Måndag' }, { key: 'tue', label: 'Tisdag' }, { key: 'wed', label: 'Onsdag' },
  { key: 'thu', label: 'Torsdag' }, { key: 'fri', label: 'Fredag' }, { key: 'sat', label: 'Lördag' }, { key: 'sun', label: 'Söndag' },
]
export const OPERATORS: Record<Operator, string> = {
  telia: 'Telia (mobil)', tele2: 'Tele2', telenor: 'Telenor', tre: 'Tre',
  telia_fast: 'Telia (fast telefon)', vaxel: 'Växel eller IP-telefoni', other: 'Annan',
}
/** Korten i steg 4: de fem vanliga stora, fast telefon och växel mindre under. */
export const OPERATOR_CARDS: { main: Operator[]; more: Operator[]; label: Record<Operator, string> } = {
  main: ['telia', 'tele2', 'telenor', 'tre', 'other'],
  more: ['telia_fast', 'vaxel'],
  label: {
    telia: 'Telia', tele2: 'Tele2', telenor: 'Telenor', tre: 'Tre', other: 'Annan',
    telia_fast: 'Telia fast telefon', vaxel: 'Växel eller IP-telefoni',
  },
}
/** Vad assistenten gör i varje läge, en rad under kortet. */
export const MODE_HINT: Record<Mode, string> = {
  after_hours: 'Ni har stängt och ingen svarar: assistenten tar samtalet.',
  overflow: 'Ni har öppet men hinner inte svara: assistenten tar samtalet.',
  always: 'Assistenten tar alla samtal, dygnet runt.',
}

/** Kom igångs texter (en fråga per skärm). */
export const SETUP = {
  STEP_LABEL: ['Namn', 'Tider', 'Booqy-nummer', 'Vidarekoppling', 'Provsamtal'],
  QUESTIONS: ['Vad ska assistenten heta?', 'När ska assistenten svara?', 'Skaffa ert Booqy-nummer', 'Koppla ert nummer till Booqy', 'Ring och prova'],
  /** En kort rad under frågan: vad man gör på skärmen. */
  LEADS: [
    'Skriv ett namn, eller behåll Booqy. Tryck sedan på Nästa.',
    'Tryck på det som passar er. Tryck sedan på Nästa.',
    'Tryck på Skaffa nummer. Det tar några sekunder.',
    'Samtal som ni inte svarar på går vidare till assistenten. Ert nummer är detsamma.',
    'Följ stegen. Det tar en minut.',
  ],
  progress: (n: number) => `Steg ${n} av 5`,
  buttons: {
    next: 'Nästa', back: 'Tillbaka', done: 'Klar', saving: 'Sparar…', start: 'Börja', cont: (l: string) => `Fortsätt: ${l}`,
    getNumber: 'Skaffa nummer', gettingNumber: 'Skaffar nummer…', copy: 'Kopiera', copied: 'Kopierad',
    called: 'Klart', doneSwitch: 'Klart', callNow: 'Ring från den här telefonen', callCode: 'Ring koden från den här telefonen',
    waitAgain: 'Vänta igen', skip: 'Hoppa över', retry: 'Försök igen',
    toList: 'Till checklistan',
  },
}

export const ERRORS: Record<string, string> = {
  agent_name_required: 'Skriv ett namn på assistenten, till exempel Booqy.',
  changed_retry: 'Någon annan ändrade samtidigt. Nu syns det senaste. Gör din ändring igen.',
  transfer_is_forwarded: 'Det numret går redan till Booqy. Välj ett annat, till exempel en mobil.',
  invalid_operator: 'Välj er telefonoperatör i listan.',
  purpose_required: 'Skriv varför samtalen spelas in, till exempel: Utbildning av personalen.',
  invalid_retention: 'Välj hur länge inspelningarna sparas: 7, 30 eller 90 dagar.',
  invalid_cap: 'Skriv minuttaket som ett helt tal, till exempel 300. Det får inte vara högre än Booqy tillåter.',
  invalid_hours: 'Tiderna går inte ihop. Varje period ska sluta efter att den börjar, till exempel 11:00-22:00.',
  invalid_phone: 'Numret ser fel ut. Skriv det så här: 070 123 45 67.',
  invalid_max_call: 'Ett samtal får vara 2 till 15 minuter. Skriv till exempel 5.',
  invalid_phone_max_party_size: 'Skriv ett helt tal från 1 till 50, till exempel 12. Lämna tomt för samma gräns som online.',
  text_too_long: 'Texten är för lång. Korta den och spara igen.',
  number_unavailable: 'Det finns inget ledigt nummer just nu. Det är Booqys fel, inte ert. Försök igen om en stund.',
  telephony_unavailable: 'Telefonbolaget svarar inte just nu. Det är inte ert fel. Försök igen om en stund.',
  voice_provider_unavailable: 'Rösttjänsten svarar inte just nu. Det är inte ert fel. Försök igen om en stund.',
  ai_unavailable: 'Assistenten svarar inte just nu. Det är inte ert fel. Försök igen om en stund.',
  invalid_state: 'Någon annan ändrade återuppringningen nyss. Listan visar nu det senaste.',
  share_unavailable: 'Den platsen har inget eget nummer att dela. Slå på assistenten där först.',
}

// --- Mockdata (inget API) ------------------------------------------------------------------
//
// En påhittad plats utan nummer, så kom igång går att prova lokalt. Används
// ALDRIG när API:t är konfigurerat.

function mockLoc(): LocationConfig {
  return {
    locationId: 'mock-location', enabled: false, killSwitch: false, mode: 'after_hours', agentHours: {},
    greetingExtraSv: '', greetingExtraEn: '', transferTo: null, maxCallSeconds: 480,
    counterOffers: { nearbyTables: true, phoneOnlyTables: true }, phoneMaxPartySize: null, number: null, numberSharedWith: null, version: 0,
    setup: { operator: null, forwardedAt: null, testedAt: null }, simulated: true,
    forwarding: { number: null, operator: 'other', codes: [] },
  }
}
const MOCK_HOURS: BusinessHours = {
  monday: [{ opensAt: '11:00', closesAt: '22:00' }], tuesday: [{ opensAt: '11:00', closesAt: '22:00' }],
  wednesday: [{ opensAt: '11:00', closesAt: '22:00' }], thursday: [{ opensAt: '11:00', closesAt: '22:00' }],
  friday: [{ opensAt: '11:00', closesAt: '23:00' }], saturday: [{ opensAt: '12:00', closesAt: '23:00' }], sunday: [],
}
interface MockState { config: Config; loc: LocationConfig; calls: CallRow[]; details: Record<string, CallDetail>; deTranslatedAt: number; place: { businessHours: BusinessHours | null; phoneNumber: string | null } }
let mockState: MockState = freshMock()
function freshMock(): MockState {
  return {
    config: { agentName: 'Booqy', tone: 'formal', languages: ['sv', 'en'], recording: { enabled: false }, minutesCapPerMonth: 300, version: 0 },
    loc: mockLoc(), ...mockCalls(), deTranslatedAt: Date.now() + 20_000, place: { businessHours: MOCK_HOURS, phoneNumber: '+46812345678' },
  }
}
/** Två påhittade samtal: ett på arabiska och ett på tyska, båda börjar på svenska. */
function mockCalls(): { calls: CallRow[]; details: Record<string, CallDetail> } {
  const ago = (min: number, sec = 0) => new Date(Date.now() - min * 60_000 + sec * 1000).toISOString()
  const greet = (sec: number, start: number): Turn => ({
    role: 'agent', lang: 'sv', at: ago(start, sec), translation: 'done',
    text: 'Hej och välkommen till Demo. Du talar med Booqy, restaurangens AI-assistent. Vad kan jag hjälpa dig med?',
    textEn: 'Hi and welcome to Demo. You are speaking with Booqy, the restaurant\'s AI assistant. How can I help you?',
  })
  const t = (role: Turn['role'], lang: Lang, text: string, textSv: string, textEn: string, at: string): Turn => ({
    role, lang, text, textSv, textEn, at, translation: 'done', ...(role === 'caller' ? { asrLocale: lang === 'ar' ? 'ar_AE' : 'de_DE' } : {}),
  })
  const ar: CallDetail = {
    callId: 'mock-call-ar', startedAt: ago(95), durationSec: 142, language: 'ar', outcome: 'booked', counterOffer: 'none',
    reservationId: 'mock-res-1', callbackId: null, summary: 'Bord för två i kväll 20:00', from: '+46701234567', billedMinutes: 3,
    disclosure: { playedAt: ago(95, 2), repeats: 1, languages: ['sv', 'ar'] },
    turns: [
      greet(1, 95),
      // Sagt innan bytet: den svenska taligenkänningen hör bara språkets namn.
      { role: 'caller', lang: 'sv', asrLocale: 'sv_SE', at: ago(95, 9), translation: 'done', text: 'Marhaba. Arabiska?', textEn: 'Marhaba. Arabic?' },
      t('agent', 'ar', 'أهلا بك. أنا Booqy، مساعد المطعم بالذكاء الاصطناعي. كيف يمكنني مساعدتك؟',
        'Välkommen. Jag är Booqy, restaurangens AI-assistent. Hur kan jag hjälpa dig?',
        'Welcome. I am Booqy, the restaurant\'s AI assistant. How can I help you?', ago(95, 14)),
      t('caller', 'ar', 'أريد حجز طاولة لشخصين الليلة الساعة الثامنة.',
        'Jag vill boka ett bord för två i kväll klockan åtta.', 'I would like to book a table for two tonight at eight.', ago(95, 24)),
      { role: 'tool', text: 'hold_table', toolName: 'hold_table', toolOk: true, at: ago(95, 26) },
      t('agent', 'ar', 'تم الحجز لشخصين الليلة الساعة الثامنة. شكرا لاتصالك.',
        'Bordet för två är bokat i kväll klockan åtta. Tack för att du ringde.',
        'The table for two is booked tonight at eight. Thank you for calling.', ago(95, 31)),
    ],
  }
  // Slutade för en minut sedan: översättningen pågår fortfarande (se `call`).
  const DE_AGO = 3
  const de: CallDetail = {
    callId: 'mock-call-de', startedAt: ago(DE_AGO), durationSec: 118, language: 'de', outcome: 'booked', counterOffer: 'other_time',
    reservationId: 'mock-res-2', callbackId: null, summary: 'Bord för fyra i morgon 19:30', from: '+4915112345678', billedMinutes: 2,
    disclosure: { playedAt: ago(DE_AGO, 2), repeats: 1, languages: ['sv', 'de'] },
    turns: [
      greet(1, 30),
      t('caller', 'de', 'Guten Abend, haben Sie morgen um sieben einen Tisch für vier Personen?',
        'God kväll, har ni ett bord för fyra personer i morgon klockan sju?', 'Good evening, do you have a table for four tomorrow at seven?', ago(DE_AGO, 10)),
      t('agent', 'de', 'Guten Abend. Morgen um 19 Uhr ist leider alles belegt. Ich kann Ihnen 19:30 Uhr anbieten.',
        'God kväll. I morgon klockan 19 är tyvärr allt fullt. Jag kan erbjuda 19:30.',
        'Good evening. Tomorrow at 7 pm we are unfortunately full. I can offer 7:30 pm.', ago(DE_AGO, 18)),
      t('caller', 'de', 'Ja, 19:30 passt gut.', 'Ja, 19:30 passar bra.', 'Yes, 7:30 works well.', ago(DE_AGO, 25)),
      t('agent', 'de', 'Sehr gerne. Der Tisch für vier ist morgen um 19:30 Uhr reserviert.',
        'Gärna. Bordet för fyra är bokat i morgon klockan 19:30.', 'Gladly. The table for four is booked tomorrow at 7:30 pm.', ago(DE_AGO, 33)),
    ],
  }
  const row = ({ billedMinutes: _b, disclosure: _d, turns: _t, recordingUrl: _r, ...r }: CallDetail): CallRow => r
  return { calls: [row(de), row(ar)], details: { [ar.callId]: ar, [de.callId]: de } }
}
/** Bara lokal utveckling och tester: börja om, eventuellt från ett givet läge. */
export function resetPhoneMock(over: Partial<MockState> = {}): void {
  mockState = { ...freshMock(), ...over }
}

function mockCodes(l: LocationConfig): LocationConfig['forwarding'] {
  const number = l.number
  const operator = l.setup?.operator ?? 'other'
  if (!number || operator === 'vaxel') return { number, operator, reset: [], codes: [] }
  const off = 'Stäng av gammal vidarekoppling'
  // Delad i två: brand-lint läser annars "#002" som en färg.
  const reset = operator === 'telia_fast' ? ['#21#', '#61#', '#67#'].map((on) => ({ label: off, on })) : [{ label: off, on: '##' + '002#' }]
  const always = l.mode === 'always'
  const conditional = '004'
  const codes = operator === 'telia_fast'
    ? (always ? [{ label: 'Vidarekoppla alla samtal', on: `*21*${number}#`, off: '#21#' }]
      : [{ label: 'Vidarekoppla vid ej svar', on: `*61*${number}#`, off: '#61#' }, { label: 'Vidarekoppla vid upptaget', on: `*67*${number}#`, off: '#67#' }])
    : [always ? { label: 'Vidarekoppla alla samtal', on: `**21*${number}#`, off: '##21#' }
      : { label: 'Vidarekoppla när ni inte svarar', on: `**${conditional}*${number}#`, off: `##${conditional}#` }]
  return { number, operator, reset, codes }
}
const later = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), 150))
const stale = () => Promise.reject(new ApiError(409, 'changed_retry', { code: 'changed_retry', fromServer: true }))

const mock = {
  overview: () => later<Overview>({
    config: mockState.config,
    locations: [{ locationId: mockState.loc.locationId, name: 'Demo', enabled: mockState.loc.enabled, killSwitch: mockState.loc.killSwitch,
      mode: mockState.loc.mode, number: mockState.loc.number, minutesThisPeriod: 0 }],
    usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' },
  }),
  saveConfig: (c: Omit<Config, 'version'> & { version: number }) => {
    if (c.version !== mockState.config.version) return stale()
    mockState.config = { ...mockState.config, ...c, version: c.version + 1 }
    return later(mockState.config)
  },
  location: () => later(mockState.loc),
  saveLocation: (body: LocationBody) => {
    if (body.version !== mockState.loc.version) return stale()
    const { shareNumberWith: _share, ...rest } = body
    const number = body.enabled ? (mockState.loc.number ?? '+46100000001') : mockState.loc.number
    const next = { ...mockState.loc, ...rest, number, version: body.version + 1 }
    mockState.loc = { ...next, forwarding: mockCodes(next) }
    return later(mockState.loc)
  },
  postSetup: (body: SetupBody) => {
    if (body.version !== mockState.loc.version) return stale()
    const at = new Date().toISOString()
    const setup: Setup = { ...(mockState.loc.setup ?? { operator: null, forwardedAt: null, testedAt: null }) }
    if (body.operator) setup.operator = body.operator
    if (body.forwarded !== undefined) setup.forwardedAt = body.forwarded ? at : null
    if (body.tested !== undefined) setup.testedAt = body.tested ? at : null
    const next = { ...mockState.loc, setup, version: body.version + 1 }
    mockState.loc = { ...next, forwarding: mockCodes(next) }
    return later(mockState.loc)
  },
  killSwitch: (on: boolean, version: number) => {
    if (version !== mockState.loc.version) return stale()
    mockState.loc = { ...mockState.loc, killSwitch: on, version: version + 1 }
    return later(mockState.loc)
  },
  simulate: (text: string) => later<SimReply>({
    reply: `Hej och välkommen till Demo. Du talar med ${mockState.config.agentName}, restaurangens AI-assistent. Du sa: ${text}`, language: 'sv',
    toolCalls: [], state: {}, disclosure: true,
  }),
  calls: () => later({ calls: mockState.calls, cursor: null }),
  call: (callId: string) => {
    const call = mockState.details[callId]
    if (!call) return Promise.reject(new ApiError(404, 'not_found', { code: 'not_found', fromServer: true }))
    // Det tyska samtalet översätts fortfarande de första 20 sekunderna (sedan: klart vid nästa hämtning).
    if (call.language === 'de' && Date.now() < mockState.deTranslatedAt) {
      return later<CallDetail>({ ...call, turns: call.turns.map(({ textSv: _sv, textEn: _en, ...t }) => ({ ...t, translation: 'pending' })) })
    }
    return later(call)
  },
  place: () => later(mockState.place),
}

// --- Spara med en ny chans ------------------------------------------------------------------
//
// Ändrade någon annan samtidigt (409 changed_retry) hämtas det senaste, den
// här ändringen läggs ovanpå och sparas en gång till. Ingen behöver ladda om.
// Går det inte heller får `onLatest` det senaste så sidan visar det.

const isStale = (err: unknown) => err instanceof ApiError && err.code === 'changed_retry'

async function withRetry<B, T>(base: B, attempt: (b: B) => Promise<T>, fresh: () => Promise<B>, onLatest?: (b: B) => void): Promise<T> {
  try {
    return await attempt(base)
  } catch (err) {
    if (!isStale(err)) throw err
    const latest = await fresh()
    onLatest?.(latest)
    return attempt(latest)
  }
}

export type LocationPatch = Partial<Omit<LocationBody, 'version'>>

/** Platsens fält som PUT tar, med ändringen ovanpå. */
export function locationBody(l: LocationConfig, patch: LocationPatch = {}): LocationBody {
  const share = patch.shareNumberWith !== undefined ? patch.shareNumberWith : l.numberSharedWith
  const next = {
    enabled: l.enabled, mode: l.mode, agentHours: l.agentHours, greetingExtraSv: l.greetingExtraSv, greetingExtraEn: l.greetingExtraEn,
    transferTo: l.transferTo || null, maxCallSeconds: l.maxCallSeconds, counterOffers: l.counterOffers,
    phoneMaxPartySize: l.phoneMaxPartySize ?? null, ...patch, version: l.version,
  }
  const { shareNumberWith: _drop, ...body } = next as LocationBody
  return next.enabled && share ? { ...body, shareNumberWith: share } : body
}

export function saveLocationPatch(locationId: string, current: LocationConfig, patch: LocationPatch, onLatest?: (l: LocationConfig) => void) {
  return withRetry(current, (l) => saveLocation(locationId, locationBody(l, patch)), () => getLocation(locationId), onLatest)
}

export function saveConfigPatch(current: Config, patch: Partial<Omit<Config, 'version'>>, onLatest?: (c: Config) => void) {
  return withRetry(current, (c) => saveConfig({ agentName: c.agentName, tone: c.tone, languages: c.languages, recording: c.recording,
    minutesCapPerMonth: c.minutesCapPerMonth, ...patch, version: c.version }), () => getOverview().then((o) => o.config), onLatest)
}

export function postSetupPatch(locationId: string, current: LocationConfig, patch: Omit<SetupBody, 'version'>, onLatest?: (l: LocationConfig) => void) {
  return withRetry(current, (l) => postSetup(locationId, { ...patch, version: l.version }), () => getLocation(locationId), onLatest)
}
