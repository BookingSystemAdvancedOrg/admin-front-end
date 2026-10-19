import { createContext, useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { MOTION_SEEN_KEY } from '../storageRegistry'

/**
 * Rörelsen (vätskan i rutorna, talen som räknas upp, sidomenyn som fylls)
 * sker en gång per sida: första gången sidan visas i fliken. Kommer man
 * tillbaka står siffrorna redan där. Varje flik under Marknadsföring räknas
 * som en egen sida. Listan över visade sidor ligger i sessionStorage (se
 * registret), så en omladdning av fliken inte spelar allt igen; en ny flik
 * börjar om.
 */
const SIDEBAR = 'sidebar'
let cache: Set<string> | null = null

function load(): Set<string> {
  if (cache) return cache
  try {
    const raw = sessionStorage.getItem(MOTION_SEEN_KEY)
    cache = new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    cache = new Set()
  }
  return cache
}

function save(seen: Set<string>): void {
  try {
    sessionStorage.setItem(MOTION_SEEN_KEY, JSON.stringify([...seen]))
  } catch {
    // Utan lagring minns vi det i minnet så länge fliken lever.
  }
}

export function claimFirstVisit(key: string): boolean {
  const seen = load()
  if (seen.has(key)) return false
  seen.add(key)
  save(seen)
  return true
}

/** Sidomenyn fylls bara första gången i fliken. Svaret hålls tills
 * fyllningen är klar, så en omritning under tiden inte ändrar det. */
let sidebarDecision: boolean | null = null

export function sidebarShouldPour(): boolean {
  if (sidebarDecision === null) sidebarDecision = claimFirstVisit(SIDEBAR)
  return sidebarDecision
}

export function sidebarPourDone(): void {
  sidebarDecision = false
}

const MotionContext = createContext(true)

/** Får den här sidan röra på sig just nu (första besöket)? */
export function useMotionAllowed(): boolean {
  return useContext(MotionContext)
}

export function MotionScope({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation()
  const tab = new URLSearchParams(search).get('flik') ?? ''
  const key = `${pathname}?${tab}`
  // Beslutet tas en gång per sida och hålls medan man är kvar på den, så en
  // omritning (listan hämtas om) aldrig startar om rörelsen.
  const decided = useRef(new Map<string, boolean>())
  if (!decided.current.has(key)) decided.current.set(key, claimFirstVisit(key))
  return <MotionContext.Provider value={decided.current.get(key)!}>{children}</MotionContext.Provider>
}

/** Endast för tester. */
export function resetMotionForTests(): void {
  cache = null
  sidebarDecision = null
  try {
    sessionStorage.removeItem(MOTION_SEEN_KEY)
  } catch {
    // ingen lagring
  }
}
