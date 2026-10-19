import { createContext, useContext } from 'react'
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
/** Sidan (sökväg + flik) som fick rörelsen, för hela sidladdningen. */
let firstKey: string | null = null
/** När den första rutan/talet började röra sig. */
let revealStart: number | null = null
/**
 * Hur länge efter att den första rutan börjat som andra rutor/tal på samma
 * sida får hänga på (data som kommer i flera anrop). Efter det står allt
 * stilla även om sidan hämtar om, byter period eller ritar om rutorna.
 */
export const REVEAL_WINDOW_MS = 4000

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
  firstKey = null
  revealStart = null
  try {
    localStorage.removeItem(MOTION_SEEN_KEY)
  } catch {
    // ingen lagring
  }
}

/**
 * Anropas av en ruta eller ett tal precis innan det börjar röra sig (efter
 * att sidan fått klartecken). Den första startar fönstret; den som kommer
 * efter fönstret visar bara slutläget. Så spelas avslöjandet en gång, även
 * om sidan hämtar om eller rutorna monteras om.
 */
export function claimReveal(): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (revealStart === null) revealStart = now
  return now - revealStart < REVEAL_WINDOW_MS
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
  // Första sidan efter inloggningen får rörelsen; byter man sida (eller flik
  // under Marknadsföring) är den över för gott, även om man kommer tillbaka
  // eller skalet monteras om. Beslutet ligger på modulnivå, inte i komponenten.
  if (firstKey === null) firstKey = motionThisLogin() ? key : ''
  else if (firstKey !== key) firstKey = ''
  return <MotionContext.Provider value={firstKey !== '' && firstKey === key}>{children}</MotionContext.Provider>
}

/** Endast för tester. */
export function resetMotionForTests(): void {
  resetMotion()
}
