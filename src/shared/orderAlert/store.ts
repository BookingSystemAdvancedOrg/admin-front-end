import { useSyncExternalStore } from 'react'
import type { Order } from '../../features/bestallningar/ordersApi'
import type { RequestSummary } from '../../features/catering/cateringApi'
import { CATERING_ALERT_KEY, CATERING_PINGED_KEY_PREFIX, ORDER_ALERT_KEY } from '../storageRegistry'
import { onOrderAudioUnlocked, playOrderAlert } from './alertSound'
import type { ChimeResult } from './alertSound'
import { CATERING_KIND, EMPTY_ALERT, ORDER_KIND, acknowledge, fromStored, observeKind, toStored } from './queue'
import type { AlertKind, AlertState } from './queue'

/**
 * Larmets tillstånd för hela appen (utanför React): nya onlinebeställningar
 * och nya cateringförfrågningar, två slag i samma ruta med samma ljud. Varje
 * slag har egna sedda id:n, egen plats-facit och eget skal (behörighet och
 * plan skiljer sig åt). Flera hämtningar matar samma lista, så att larmet och
 * sidorna alltid är överens: skalets egen (OrderAlert.tsx), Beställningar och
 * Catering (de hämtar själva, då hämtar skalet inget) och Översikten. Ett svar
 * för en annan plats än den valda (ett sent svar efter ett platsbyte) räknas inte.
 */

export interface AlertSnapshot {
  /** Rutans beställningar, nyaste först. */
  open: readonly Order[]
  /** Rutans cateringförfrågningar, nyaste först. Båda tomma = ingen ruta. */
  requests: readonly RequestSummary[]
  /** Larmet kunde inte höras: webbläsaren väntar på ett tryck. */
  muted: boolean
  /** Räknas upp för varje omgång nya. */
  rev: number
  /** Id:n i den senaste omgången (rutan markerar och läser upp dem). */
  latest: readonly string[]
}

const EMPTY_SNAPSHOT: AlertSnapshot = { open: [], requests: [], muted: false, rev: 0, latest: [] }

/** Ett slag larm: sitt tillstånd, sin sparning och sitt skal. */
interface Track<T> {
  name: 'orders' | 'catering'
  kind: AlertKind<T>
  storageKey: string
  state: AlertState<T> | null
  /** När tillståndet senast sparades i fliken; sparas om minst varje minut även utan ändring. */
  savedAt: number
  /**
   * Platsen som larmar, satt av skalet (OrderAlert): null = inget larm (ingen
   * plats, ingen behörighet, planen saknar det). Utan skal (en sida i ett test) räknas allt.
   */
  scope: string | null | undefined
  /**
   * Flera flikar: id:n som en annan flik redan har larmat om (de larmar inte
   * igen här). Utan den larmar varje flik för sig.
   */
  claim?: (locationId: string, ids: readonly string[]) => Set<string>
}

/** Ett id som en annan flik larmade om för så här länge sedan larmar inte igen. */
const CLAIM_TTL_MS = 10 * 60_000
const CLAIM_MAX = 200

/**
 * Delad mellan flikarna (localStorage, per plats): vilka förfrågningar som
 * redan har larmat. De som en annan flik hunnit före returneras (ingen
 * ljud, ingen ruta här); resten läggs in som larmade. Utan lagring larmar
 * varje flik för sig.
 */
function claimAcrossTabs(locationId: string, ids: readonly string[]): Set<string> {
  const taken = new Set<string>()
  const key = `${CATERING_PINGED_KEY_PREFIX}${locationId}`
  const now = Date.now()
  try {
    let list: { id: string; at: number }[] = []
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
      if (Array.isArray(parsed)) {
        list = parsed.filter(
          (e): e is { id: string; at: number } =>
            Boolean(e) && typeof e.id === 'string' && typeof e.at === 'number' && now - e.at < CLAIM_TTL_MS && e.at - now < 60_000,
        )
      }
    } catch {
      list = []
    }
    const known = new Set(list.map((e) => e.id))
    for (const id of ids) {
      if (known.has(id)) taken.add(id)
      else list.push({ id, at: now })
    }
    localStorage.setItem(key, JSON.stringify(list.slice(-CLAIM_MAX)))
  } catch {
    /* ingen lagring: varje flik larmar för sig */
  }
  return taken
}

const orders: Track<Order> = {
  name: 'orders', kind: ORDER_KIND, storageKey: ORDER_ALERT_KEY, state: null, savedAt: 0, scope: undefined,
}
const catering: Track<RequestSummary> = {
  name: 'catering', kind: CATERING_KIND, storageKey: CATERING_ALERT_KEY, state: null, savedAt: 0, scope: undefined, claim: claimAcrossTabs,
}

let snapshot: AlertSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()
/** När en sida som hämtar minst lika ofta som skalet (Beställningar, Catering) senast matade listan. */
const fedAt = new Map<string, number>()
let audioWatch: (() => void) | null = null
/** Ett larm hördes inte (spärrat ljud): det spelas när ljudet går igen, om rutan står kvar. */
let owed = false
const SAVE_EVERY_MS = 60_000
/** Två slag som kommer i samma ögonblick ger ett ljud och en gemensam markering. */
let chimeTick: Track<never>['name'] | null = null

function current<T>(t: Track<T>): AlertState<T> {
  if (t.state === null) {
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(t.storageKey)
    } catch {
      /* ingen lagring */
    }
    t.state = fromStored<T>(raw, Date.now())
  }
  return t.state
}

function openCount(): number {
  return snapshot.open.length + snapshot.requests.length
}

/**
 * Sparar id:na i fliken. Tiden i sparningen är när en lista senast togs
 * emot (inte när något senast ändrades), så att en omladdning efter en lugn
 * stund fortsätter där fliken var och larmar det som kom under tiden.
 */
function persist<T>(t: Track<T>, next: AlertState<T>) {
  const now = Date.now()
  t.savedAt = now
  const raw = toStored(next, now, t.kind.id)
  try {
    if (raw) sessionStorage.setItem(t.storageKey, raw)
    else sessionStorage.removeItem(t.storageKey)
  } catch {
    /* privat läge utan lagring: en omladdning börjar om */
  }
}

function publish(next: Partial<AlertSnapshot>) {
  snapshot = { ...snapshot, ...next }
  for (const l of [...listeners]) l()
}

function setMuted(muted: boolean) {
  // Blir ljudet möjligt igen (ett tryck, eller Safari som vaknar efter ett
  // samtal) försvinner tipset och larmet som inte hördes spelas.
  if (muted && !audioWatch) {
    audioWatch = onOrderAudioUnlocked(audioBack)
  } else if (!muted && audioWatch) {
    audioWatch()
    audioWatch = null
  }
  if (snapshot.muted !== muted) publish({ muted })
}

function chime(from: Track<never>['name'] = 'orders') {
  // Det andra slaget i samma ögonblick (beställningar och förfrågningar i samma tick) delar ljudet.
  if (chimeTick !== null && chimeTick !== from) return
  chimeTick = from
  queueMicrotask(() => {
    chimeTick = null
  })
  void playOrderAlert().then(heard)
}

function heard(result: ChimeResult) {
  owed = result === 'locked' && openCount() > 0
  setMuted(owed)
}

function audioBack() {
  const replay = owed && openCount() > 0
  owed = false
  setMuted(false)
  if (replay) chime('orders')
}

/** Vem som hämtade: `page` = en sida som hämtar minst lika ofta som skalet (Beställningar, Catering), då väntar skalet. */
export type FeedSource = 'page' | 'other'

function openOf(t: Track<unknown>): Partial<AlertSnapshot> {
  return t === (orders as Track<unknown>)
    ? { open: orders.state?.open ?? [] }
    : { requests: catering.state?.open ?? [] }
}

function feed<T>(t: Track<T>, locationId: string, items: readonly T[], from: FeedSource): void {
  if (!locationId || t.scope === null || (t.scope !== undefined && t.scope !== locationId)) return
  if (from === 'page') fedAt.set(`${t.name}:${locationId}`, Date.now())
  const before = current(t)
  const observed = observeKind(t.kind, before, locationId, items)
  let next = observed.state
  let added = observed.added
  const taken = t.claim && added.length ? t.claim(locationId, added.map(t.kind.id)) : null
  if (taken?.size) {
    // En annan flik har redan larmat: sedd här, men varken ljud eller ruta.
    added = added.filter((i) => !taken.has(t.kind.id(i)))
    next = { ...next, open: next.open.filter((i) => !taken.has(t.kind.id(i))) }
  }
  if (next === before) {
    if (Date.now() - t.savedAt > SAVE_EVERY_MS) persist(t, before)
    return
  }
  t.state = next
  persist(t, next)
  const open = openOf(t as Track<unknown>)
  if (added.length) {
    const ids = added.map(t.kind.id)
    publish({ ...open, rev: snapshot.rev + 1, latest: chimeTick !== null ? [...ids, ...snapshot.latest] : ids })
    chime(t.name)
  } else {
    publish({ ...open })
    if (openCount() === 0) publish({ latest: [] })
  }
}

/**
 * Dagens beställningar för platsen, från vilken hämtning som helst.
 * Larmar (ljud och ruta) för de som är nya för den här fliken.
 */
export function feedOrders(locationId: string, list: readonly Order[], from: FeedSource = 'page'): void {
  feed(orders, locationId, list, from)
}

/** Cateringförfrågningarna för platsen, från vilken hämtning som helst. */
export function feedCatering(locationId: string, list: readonly RequestSummary[], from: FeedSource = 'page'): void {
  feed(catering, locationId, list, from)
}

/** Skalets hämtning i dedupe (shared/live): två väckningar samtidigt blir ett anrop. */
export function ordersKey(locationId: string): string {
  return `orders:${locationId}`
}

export function cateringKey(locationId: string): string {
  return `catering-alert:${locationId}`
}

function setScope<T>(t: Track<T>, locationId: string | null): void {
  if (t.scope === locationId) return
  t.scope = locationId
  const now = current(t)
  if (now.locationId !== locationId && (now.open.length || now.restore.length)) {
    t.state = acknowledge(now)
    persist(t, t.state)
    publish({ ...openOf(t as Track<unknown>) })
    if (openCount() === 0) {
      owed = false
      setMuted(false)
      publish({ latest: [] })
    }
  }
}

/**
 * Skalet, när restaurangen är hämtad: vilken plats som larmar om
 * beställningar (null = ingen). Byts platsen, eller finns inget larm längre,
 * stängs beställningarna i rutan.
 */
export function setAlertScope(locationId: string | null): void {
  setScope(orders, locationId)
}

/** Samma för cateringförfrågningar (plan och behörighet för Catering). */
export function setCateringScope(locationId: string | null): void {
  setScope(catering, locationId)
}

/** När en sida senast matade beställningarna för platsen (0 = aldrig). */
export function pageFedAt(locationId: string): number {
  return fedAt.get(`orders:${locationId}`) ?? 0
}

/** När en sida senast matade cateringförfrågningarna för platsen (0 = aldrig). */
export function pageFedCateringAt(locationId: string): number {
  return fedAt.get(`catering:${locationId}`) ?? 0
}

function clearTrack(t: Track<unknown>): void {
  const before = current(t)
  const next = acknowledge(before)
  if (next !== before) {
    t.state = next
    persist(t, next)
  }
}

/** OK: rutan stängs och listorna töms. */
export function acknowledgeOrders(): void {
  clearTrack(orders as Track<unknown>)
  clearTrack(catering as Track<unknown>)
  owed = false
  setMuted(false)
  publish({ open: [], requests: [], latest: [] })
}

/**
 * En rad öppnades: bara det slaget töms (sidan man hamnar på visar det
 * slaget). Det andra slaget står kvar i rutan, annars tappas det utan att
 * någon har sett det.
 */
export function acknowledgeKind(kind: 'orders' | 'catering'): void {
  const t = (kind === 'orders' ? orders : catering) as Track<unknown>
  clearTrack(t)
  const rest = kind === 'orders' ? snapshot.requests : snapshot.open
  if (rest.length === 0) {
    acknowledgeOrders()
    return
  }
  const gone = new Set((kind === 'orders' ? snapshot.open.map(orders.kind.id) : snapshot.requests.map(catering.kind.id)))
  publish({
    ...(kind === 'orders' ? { open: [] } : { requests: [] }),
    latest: snapshot.latest.filter((id) => !gone.has(id)),
  })
}

export function getAlertSnapshot(): AlertSnapshot {
  return snapshot
}

export function useOrderAlerts(): AlertSnapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getAlertSnapshot,
    getAlertSnapshot,
  )
}

/**
 * Utloggning (AuthContext): nästa inloggning i samma flik börjar från noll,
 * så att det som kom in medan ingen var inloggad inte larmar som nytt.
 */
export function forgetOrderAlerts(): void {
  for (const t of [orders, catering] as Track<unknown>[]) {
    // Läses om från fliken vid nästa behov (efter utloggning är den tom).
    t.state = null
    t.scope = undefined
    t.savedAt = 0
    try {
      sessionStorage.removeItem(t.storageKey)
    } catch {
      /* ingen lagring */
    }
  }
  fedAt.clear()
  pendingFocus = null
  owed = false
  chimeTick = null
  if (audioWatch) audioWatch()
  audioWatch = null
  snapshot = EMPTY_SNAPSHOT
  for (const l of [...listeners]) l()
}

// --- Escape: rutan först ---------------------------------------------------------

let escape: (() => void) | null = null
let keysInstalled = false

/**
 * Lyssnar på Escape före alla dialoger (installeras när appen startar, så
 * den ligger först): är rutan öppen stänger Escape den, inte en dialog som
 * ligger gömd under den.
 */
export function installOrderAlertKeys(): void {
  if (keysInstalled || typeof window === 'undefined') return
  keysInstalled = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !escape) return
      e.stopImmediatePropagation()
      e.preventDefault()
      escape()
    },
    true,
  )
}

/** Rutan: vad Escape gör medan den är öppen. Returnerar false om lyssnaren inte finns (då lyssnar rutan själv). */
export function setAlertEscape(run: (() => void) | null): boolean {
  escape = run
  return keysInstalled
}

// --- Öppna en beställning från rutan ---------------------------------------------

const FOCUS_EVENT = 'booqy:focus-order'
/** En begäran som ingen sida tog emot (en avbruten navigering) gäller inte senare. */
const FOCUS_TTL_MS = 5000
let pendingFocus: { id: string; at: number } | null = null

/** Rutans rad: Beställningar visar och markerar beställningen (när sidan är uppe). */
export function requestOrderFocus(orderId: string): void {
  pendingFocus = { id: orderId, at: Date.now() }
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: orderId }))
}

/** Väntar en beställning på att visas? Den tas bort när den har lästs. */
export function takeOrderFocus(): string | null {
  const p = pendingFocus
  pendingFocus = null
  return p && Date.now() - p.at < FOCUS_TTL_MS ? p.id : null
}

export function onOrderFocus(run: (orderId: string) => void): () => void {
  const listener = (e: Event) => {
    const id = (e as CustomEvent<string>).detail
    if (id && pendingFocus?.id === id) {
      pendingFocus = null
      run(id)
    }
  }
  window.addEventListener(FOCUS_EVENT, listener)
  return () => window.removeEventListener(FOCUS_EVENT, listener)
}

/** Bara för tester. */
export function resetOrderAlerts(next: AlertState = EMPTY_ALERT): void {
  forgetOrderAlerts()
  orders.state = next
  snapshot = { ...EMPTY_SNAPSHOT, open: next.open }
  for (const l of [...listeners]) l()
}
