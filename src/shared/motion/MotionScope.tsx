import { createContext, useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Rörelsen (vätskan i rutorna, talen som räknas upp) sker en gång per sida
 * och flik: första gången sidan visas i fliken. Kommer man tillbaka står
 * siffrorna redan där. Varje flik under Marknadsföring räknas som en egen
 * sida. Inget sparas i webbläsaren; listan lever så länge fliken gör.
 */
const seen = new Set<string>()
const MotionContext = createContext(true)

export function claimFirstVisit(key: string): boolean {
  if (seen.has(key)) return false
  seen.add(key)
  return true
}

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
  seen.clear()
}
