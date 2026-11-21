import { useSyncExternalStore } from 'react'
import type { Order } from '../../features/bestallningar/ordersApi'
import { ORDER_ALERT_KEY } from '../storageRegistry'
import { onOrderAudioUnlocked, playOrderAlert } from './alertSound'
import type { ChimeResult } from './alertSound'
import { EMPTY_ALERT, acknowledge, fromStored, observe, toStored } from './queue'
import type { AlertState } from './queue'

/**
 * Beställningslarmets tillstånd för hela appen (utanför React). Flera
 * hämtningar matar samma lista, så att larmet och sidorna alltid är överens:
 * skalets egen (OrderAlert.tsx), Beställningar (var tionde sekund, då hämtar
 * skalet inget) och Översikten. Ett svar för en annan plats än den valda
 * (ett sent svar efter ett platsbyte) räknas inte.
 */

export interface AlertSnapshot {
  /** Rutans beställningar, nyaste först. Tom = ingen ruta. */
  open: readonly Order[]
  /** Larmet kunde inte höras: webbläsaren väntar på ett tryck. */
  muted: boolean
  /** Räknas upp för varje omgång nya beställningar. */
  rev: number
  /** Id:n i den senaste omgången (rutan markerar och läser upp dem). */
  latest: readonly string[]
}

const EMPTY_SNAPSHOT: AlertSnapshot = { open: [], muted: false, rev: 0, latest: [] }

let state: AlertState | null = null
let snapshot: AlertSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()
/** När en sida som hämtar minst lika ofta som skalet (Beställningar) senast matade listan. */
const fedAt = new Map<string, number>()
let audioWatch: (() => void) | null = null
/** Ett larm hördes inte (spärrat ljud): det spelas när ljudet går igen, om rutan står kvar. */
let owed = false
/** När tillståndet senast sparades i fliken; sparas om minst varje minut även utan ändring. */
let savedAt = 0
const SAVE_EVERY_MS = 60_000
/**
 * Platsen som larmar, satt av skalet (OrderAlert): null = inget larm (ingen
 * plats, ingen behörighet). Utan skal (en sida i ett test) räknas allt.
 */
let scope: string | null | undefined = undefined

function current(): AlertState {
  if (state === null) {
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(ORDER_ALERT_KEY)
    } catch {
      /* ingen lagring */
    }
    state = fromStored(raw, Date.now())
  }
  return state
}

/**
 * Sparar id:na i fliken. Tiden i sparningen är när en lista senast togs
 * emot (inte när något senast ändrades), så att en omladdning efter en lugn
 * stund fortsätter där fliken var och larmar det som kom under tiden.
 */
function persist(next: AlertState) {
  const now = Date.now()
  savedAt = now
  const raw = toStored(next, now)
  try {
    if (raw) sessionStorage.setItem(ORDER_ALERT_KEY, raw)
    else sessionStorage.removeItem(ORDER_ALERT_KEY)
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

function chime() {
  void playOrderAlert().then(heard)
}

function heard(result: ChimeResult) {
  owed = result === 'locked' && snapshot.open.length > 0
  setMuted(owed)
}

function audioBack() {
  const replay = owed && snapshot.open.length > 0
  owed = false
  setMuted(false)
  if (replay) chime()
}

/** Vem som hämtade: `page` = en sida som hämtar minst var tionde sekund (Beställningar), då väntar skalet. */
export type FeedSource = 'page' | 'other'

/**
 * Dagens beställningar för platsen, från vilken hämtning som helst.
 * Larmar (ljud och ruta) för de som är nya för den här fliken.
 */
export function feedOrders(locationId: string, orders: readonly Order[], from: FeedSource = 'page'): void {
  if (!locationId || scope === null || (scope !== undefined && scope !== locationId)) return
  if (from === 'page') fedAt.set(locationId, Date.now())
  const before = current()
  const { state: next, added } = observe(before, locationId, orders)
  if (next === before) {
    if (Date.now() - savedAt > SAVE_EVERY_MS) persist(before)
    return
  }
  state = next
  persist(next)
  if (added.length) {
    publish({ open: next.open, rev: snapshot.rev + 1, latest: added.map((o) => o.orderId) })
    chime()
  } else {
    publish({ open: next.open, ...(next.open.length ? {} : { latest: [] }) })
  }
}

/** Skalets hämtning i dedupe (shared/live): två väckningar samtidigt blir ett anrop. */
export function ordersKey(locationId: string): string {
  return `orders:${locationId}`
}

/**
 * Skalet, när restaurangen är hämtad: vilken plats som larmar (null = ingen).
 * Byts platsen, eller finns inget larm längre, stängs rutan.
 */
export function setAlertScope(locationId: string | null): void {
  if (scope === locationId) return
  scope = locationId
  const now = current()
  if (now.locationId !== locationId && (now.open.length || now.restore.length)) {
    state = acknowledge(now)
    persist(state)
    owed = false
    setMuted(false)
    publish({ open: [], latest: [] })
  }
}

/** När en sida senast matade listan för platsen (0 = aldrig). */
export function pageFedAt(locationId: string): number {
  return fedAt.get(locationId) ?? 0
}

/** OK: rutan stängs och listan töms. */
export function acknowledgeOrders(): void {
  const before = current()
  const next = acknowledge(before)
  if (next !== before) {
    state = next
    persist(next)
  }
  owed = false
  setMuted(false)
  publish({ open: [], latest: [] })
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
  state = EMPTY_ALERT
  scope = undefined
  fedAt.clear()
  pendingFocus = null
  owed = false
  savedAt = 0
  if (audioWatch) audioWatch()
  audioWatch = null
  try {
    sessionStorage.removeItem(ORDER_ALERT_KEY)
  } catch {
    /* ingen lagring */
  }
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
  state = next
  snapshot = { ...EMPTY_SNAPSHOT, open: next.open }
  for (const l of [...listeners]) l()
}
