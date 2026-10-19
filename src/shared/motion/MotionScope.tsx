import { createContext, useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { MOTION_SEEN_KEY } from '../storageRegistry'

/**
 * Rörelsen (vätskan i rutorna, talen som räknas upp, sidomenyn som fylls)
 * sker en gång per inloggning: på den första sidan som visas efter att man
 * loggat in. Därefter står allt stilla, på alla sidor, tills man loggar ut
 * och in igen. Flaggan ligger i localStorage (se registret), så en
 * omladdning eller en ny flik inte spelar om den; utloggningen tar bort den.
 * Laddningsindikatorn (Loading) och sparindikatorn (BusyBar) rör sig alltid.
 */
let decision: boolean | null = null
let sidebarDecision: boolean | null = null

function hasPlayed(): boolean {
  try {
    return localStorage.getItem(MOTION_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markPlayed(): void {
  try {
    localStorage.setItem(MOTION_SEEN_KEY, '1')
  } catch {
    // Utan lagring minns vi det i minnet så länge sidan lever.
  }
}

/**
 * Får rörelsen spelas i den här sidladdningen? Första anropet efter
 * inloggningen svarar ja och skriver flaggan; svaret hålls sedan för hela
 * sidladdningen, så sidomenyn och sidan får samma besked.
 */
export function motionThisLogin(): boolean {
  if (decision === null) {
    decision = !hasPlayed()
    if (decision) markPlayed()
  }
  return decision
}

/** Vid utloggning: nästa inloggning får rörelsen igen. */
export function resetMotion(): void {
  decision = null
  sidebarDecision = null
  try {
    localStorage.removeItem(MOTION_SEEN_KEY)
  } catch {
    // ingen lagring
  }
}

/** Sidomenyn fylls bara på den första sidan efter inloggningen. Svaret hålls
 * tills fyllningen är klar, så en omritning under tiden inte ändrar det. */

export function sidebarShouldPour(): boolean {
  if (sidebarDecision === null) sidebarDecision = motionThisLogin()
  return sidebarDecision
}

export function sidebarPourDone(): void {
  sidebarDecision = false
}

const MotionContext = createContext(true)

/** Får den här sidan röra på sig just nu (första sidan efter inloggningen)? */
export function useMotionAllowed(): boolean {
  return useContext(MotionContext)
}

export function MotionScope({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation()
  const tab = new URLSearchParams(search).get('flik') ?? ''
  const key = `${pathname}?${tab}`
  // Beslutet tas när skalet monteras och gäller bara den sida man då står
  // på; byter man sida (eller flik under Marknadsföring) är det över. En
  // omritning av samma sida (listan hämtas om) startar aldrig om rörelsen.
  const first = useRef<string | null>(null)
  if (first.current === null) first.current = motionThisLogin() ? key : ''
  else if (first.current !== key) first.current = '' // lämnade första sidan: över för gott
  return <MotionContext.Provider value={first.current !== '' && first.current === key}>{children}</MotionContext.Provider>
}

/** Endast för tester. */
export function resetMotionForTests(): void {
  resetMotion()
}
