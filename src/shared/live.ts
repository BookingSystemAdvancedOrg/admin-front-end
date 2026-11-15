import { useCallback, useEffect, useRef, useState } from 'react'
import { DATA_CHANGED_EVENT } from './api'

/**
 * Levande data: det som syns hämtas om tyst, så att det en kollega eller en
 * annan plats ändrar kommer fram av sig självt. Ingen behöver ladda om sidan
 * för data ("Ladda om" finns bara för en ny version av appen).
 *
 * En gemensam puls för hela appen:
 * - var 15:e sekund medan fliken syns (pausad när den är dold),
 * - direkt när fönstret får fokus, fliken blir synlig igen eller nätet är
 *   tillbaka ("online"),
 * - direkt efter en egen sparning (apiFetch skickar DATA_CHANGED_EVENT).
 *
 * Varje sida hänger på med useLiveRefresh(hämta). En hämtning som misslyckas
 * väntar längre till nästa (15 s, 30 s, 60 s ... högst 5 min); fokus och
 * "online" försöker direkt igen. Läsningar visar ingen laddning och ingen
 * busy-strimma (bara skrivningar gör det), och svaren blandas in i listorna
 * som de är, så scroll, öppna dialoger och fokus står kvar. Oförändrade svar
 * är billiga: API:t svarar 304 på If-None-Match och webbläsaren återanvänder
 * det den har.
 */

export const LIVE_INTERVAL_MS = 15_000
export const LIVE_MAX_BACKOFF_MS = 5 * 60_000

export type LiveReason = 'interval' | 'focus' | 'online' | 'saved'
type Listener = (reason: LiveReason) => void

const listeners = new Set<Listener>()
let timer: ReturnType<typeof setInterval> | null = null
let lastWake = 0
let detach: (() => void) | null = null

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function emit(reason: LiveReason) {
  for (const l of [...listeners]) l(reason)
}

function startTimer() {
  if (timer === null) timer = setInterval(() => visible() && online() && emit('interval'), LIVE_INTERVAL_MS)
}

function stopTimer() {
  if (timer !== null) clearInterval(timer)
  timer = null
}

/** Fokus och synlig flik kommer ofta samtidigt: en hämtning räcker. */
function wake(reason: LiveReason) {
  if (!visible()) return
  const now = Date.now()
  if (now >= lastWake && now - lastWake < 1000) return
  lastWake = now
  emit(reason)
}

function attach() {
  if (typeof window === 'undefined') return
  const onFocus = () => wake('focus')
  const onVisibility = () => {
    if (visible()) {
      startTimer()
      wake('focus')
    } else {
      stopTimer()
    }
  }
  const onOnline = () => emit('online')
  const onSaved = () => emit('saved')
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener(DATA_CHANGED_EVENT, onSaved)
  if (visible()) startTimer()
  detach = () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener(DATA_CHANGED_EVENT, onSaved)
    stopTimer()
    lastWake = 0
    detach = null
  }
}

/** Lyssna på pulsen. Returnerar avregistreringen. */
export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener)
  if (!detach) attach()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) detach?.()
  }
}

/** Hämta om allt som syns nu (felrutans Försök igen), som när fönstret får fokus. */
export function refreshNow(): void {
  emit('focus')
}

/** Väntetid efter `failures` misslyckade hämtningar i rad. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(LIVE_MAX_BACKOFF_MS, LIVE_INTERVAL_MS * 2 ** failures)
}

/**
 * Hämtar om tyst på pulsen. `refetch` ska inte visa laddning; ett avvisat
 * löfte eller `false` räknas som fel (längre väntan till nästa). Aldrig två
 * hämtningar samtidigt för samma krok. `everyMs` ger en tätare takt än 15 s
 * (köksskärmen, beställningstavlan); den pausar också när fliken är dold.
 *
 *   useLiveRefresh(() => listThings(locationId).then(setThings), { enabled: Boolean(locationId) })
 */
export function useLiveRefresh(
  refetch: () => unknown,
  opts: { enabled?: boolean; everyMs?: number } = {},
): void {
  const latest = useRef(refetch)
  useEffect(() => {
    latest.current = refetch
  })
  const enabled = opts.enabled ?? true
  const everyMs = opts.everyMs && opts.everyMs < LIVE_INTERVAL_MS ? opts.everyMs : null
  useEffect(() => {
    if (!enabled) return
    let running = false
    // En signal (sparning, 409, fokus) under en pågående hämtning tappas
    // inte: den hämtningen kan ha börjat före sparningen och ge gammal data,
    // så en till körs direkt efteråt.
    let pending: LiveReason | null = null
    let stopped = false
    let failures = 0
    let notBefore = 0
    const run = async (reason: LiveReason) => {
      if (reason === 'online') failures = 0
      if (reason === 'interval' && Date.now() < notBefore) return
      if (running) {
        if (reason !== 'interval' || pending === null) pending = reason
        return
      }
      running = true
      try {
        const result = await latest.current()
        if (result === false) throw new Error('refetch failed')
        failures = 0
        notBefore = 0
      } catch {
        failures += 1
        notBefore = Date.now() + backoffMs(failures)
      } finally {
        running = false
      }
      const again = pending
      pending = null
      if (again !== null && !stopped) void run(again)
    }
    const unsubscribe = subscribeLive((reason) => {
      if (everyMs === null || reason !== 'interval') void run(reason)
    })
    const own = everyMs === null ? null : setInterval(() => visible() && online() && void run('interval'), everyMs)
    return () => {
      stopped = true
      unsubscribe()
      if (own !== null) clearInterval(own)
    }
  }, [enabled, everyMs])
}

/** Samma värde (djupt, som JSON)? Då behålls det gamla objektet och inget ritas om. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Data för en nyckel (plats, dag ...), hämtad en gång och sedan levande.
 * `loading` gäller bara första hämtningen för nyckeln; tysta hämtningar
 * byter bara data när svaret faktiskt ändrats och visar aldrig ett fel när
 * det redan finns data (de försöker igen på nästa puls).
 */
export function useLiveQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): {
  data: T | undefined
  error: unknown
  loading: boolean
  refresh: () => Promise<boolean>
  setData: (next: T | ((prev: T | undefined) => T)) => void
} {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: unknown; done: boolean }>({ key, done: false })
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })
  // Räknas upp vid varje lokal ändring: ett svar som hämtades före den skriver inte över den.
  const edits = useRef(0)
  const seq = useRef(0)

  const run = useCallback(async (quiet: boolean): Promise<boolean> => {
    if (key === null) return true
    const id = ++seq.current
    const at = edits.current
    try {
      const value = await fetcherRef.current()
      if (id !== seq.current || edits.current !== at) return true
      setState((prev) => {
        if (prev.key === key && prev.done && !prev.error && sameData(prev.data, value)) return prev
        return { key, data: value, done: true }
      })
      return true
    } catch (err) {
      if (id !== seq.current) return false
      setState((prev) => {
        // Tyst hämtning med data på skärmen: behåll den, försök igen nästa puls.
        if (quiet && prev.key === key && prev.done && prev.data !== undefined) return prev
        return { key, data: prev.key === key ? prev.data : undefined, error: err, done: true }
      })
      return false
    }
  }, [key])

  useEffect(() => {
    void run(false)
  }, [run])
  useLiveRefresh(() => run(true), { enabled: key !== null })

  const current = state.key === key ? state : { key, done: false, data: undefined, error: undefined }
  const setData = useCallback((next: T | ((prev: T | undefined) => T)) => {
    edits.current += 1
    setState((prev) => {
      const base = prev.key === key ? prev.data : undefined
      const value = typeof next === 'function' ? (next as (p: T | undefined) => T)(base) : next
      return { key, data: value, done: true }
    })
  }, [key])
  return {
    data: current.data,
    error: current.error,
    loading: key !== null && !current.done,
    refresh: () => run(false),
    setData,
  }
}

const inflight = new Map<string, Promise<unknown>>()

/**
 * Samma läsning från flera kort på en gång (alla hänger på samma puls) blir
 * ett enda anrop: `key` delar svaret tills det kommit.
 */
export function dedupe<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const p = fetch().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/**
 * Ett sparat formulär (`saved` + `form`) som följer servern. Orört formulär:
 * det nya sparade värdet tas in tyst (`adopt`). Formulär du ändrat i: ditt
 * står kvar och `there` är det som sparats på annat håll, för en rad med
 * "Använd" (`takeThere`).
 */
export function useLiveForm<S, F>(opts: {
  enabled: boolean
  fetch: () => Promise<S>
  saved: S | null
  form: F
  toForm: (s: S) => F
  adopt: (s: S) => void
}): { there: S | null; takeThere: () => void } {
  const [there, setThere] = useState<S | null>(null)
  // Formulär och sparat värde läses efter svaret, inte före: det du skriver
  // medan hämtningen pågår räknas som ändrat och skrivs aldrig över.
  const now = useRef(opts)
  useEffect(() => {
    now.current = opts
  })
  useLiveRefresh(async () => {
    const next = await now.current.fetch()
    const { saved, form, toForm, adopt } = now.current
    if (sameData(next, saved)) {
      setThere(null)
      return
    }
    if (sameData(form, toForm(saved as S))) {
      adopt(next)
      setThere(null)
    } else {
      setThere(next)
    }
  }, { enabled: opts.enabled })
  return {
    there,
    takeThere: () => {
      if (there === null) return
      opts.adopt(there)
      setThere(null)
    },
  }
}
