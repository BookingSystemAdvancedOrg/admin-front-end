import { useEffect, useState } from 'react'
import { getLocation, listLocations } from '../features/installningar/locationApi'
import type { Location } from '../features/installningar/locationApi'
import { listUsers } from '../features/installningar/usersApi'
import { useAuth } from '../features/auth/useAuth'
import { ApiError } from './api'

/**
 * Cache av restaurangens id i webbläsaren. Bara en genväg för snabb start —
 * den riktiga källan är servern (se `resolveLocationId`), som alltid får
 * sista ordet. Därför pekar alla enheter på samma plats: cachen kan aldrig
 * vinna över vad servern svarar.
 */
export const LOCATION_ID_STORAGE_KEY = 'admin-location-id'

export function getStoredLocationId(): string | null {
  try {
    return localStorage.getItem(LOCATION_ID_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Skriver cachen utan att röra sessionens uppslagsminne. */
function persistStoredLocationId(locationId: string): void {
  try {
    localStorage.setItem(LOCATION_ID_STORAGE_KEY, locationId)
  } catch {
    // Avstängd localStorage ska inte krascha sparningen.
  }
}

function removeStoredLocationId(): void {
  try {
    localStorage.removeItem(LOCATION_ID_STORAGE_KEY)
  } catch {
    // Som ovan.
  }
}

export function setStoredLocationId(locationId: string): void {
  persistStoredLocationId(locationId)
  // Ett id satt utifrån (t.ex. efter att platsen just skapats) gör sessionens
  // gamla uppslag inaktuella — nästa sida ska bekräfta mot servern igen.
  resolutionCache.clear()
}

/**
 * Väljer vilken plats som gäller om katalogen mot förmodan innehåller flera
 * (dubbletter från äldre versioner av appen). Äldsta posten vinner — den är
 * restaurangens ursprungliga — och valet är deterministiskt så att alla
 * enheter landar på SAMMA plats.
 */
function canonicalLocationId(locations: Location[]): string | null {
  const valid = locations.filter((l) => l.locationId?.trim())
  if (valid.length === 0) return null
  const oldest = [...valid].sort((a, b) => {
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1
    }
    if (!a.createdAt !== !b.createdAt) return a.createdAt ? -1 : 1
    return a.locationId.localeCompare(b.locationId)
  })[0]
  return oldest.locationId.trim()
}

/**
 * Finns platsen på servern? `false` bara vid ett uttryckligt 404 — nätverks-
 * eller behörighetsfel ger `null` (okänt), och då döms id:t inte ut.
 */
async function locationExists(id: string): Promise<boolean | null> {
  try {
    await getLocation(id)
    return true
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false
    return null
  }
}

/**
 * Tar reda på vilken restaurang det här systemet tillhör. Servern är facit;
 * webbläsarens cache används bara när servern inte går att fråga.
 *
 * Systemet driftsätts med en egen instans per kund — en databas, en Cognito-
 * pool, EN restaurang. Alla som loggar in ska därför se samma plats, oavsett
 * roll och enhet.
 *
 * Tre vägar, i förtroendeordning:
 *   1. `GET /locations` — katalogen är auktoritativ. Finns platser väljs den
 *      kanoniska; är katalogen TOM finns ingen plats, och en kvarliggande
 *      cache rensas (den pekade på något som inte längre finns).
 *      Kräver owner_user/super_user, så personal får 403 här.
 *   2. Användarlistan: personalposter bär sin `locationId` (ägarposter har
 *      den tom enligt kontraktet). Täcker personal, och ägare vars personal
 *      redan är upplagd.
 *   3. Cachen — sista utvägen när servern inte gav något svar alls.
 */
export async function resolveLocationId(
  callerSub: string | null,
): Promise<string | null> {
  // 1. Platskatalogen — serverns facit.
  try {
    const locations = await listLocations()
    const id = canonicalLocationId(locations)
    if (id) {
      persistStoredLocationId(id)
      return id
    }
    // Katalogen svarade och är tom: ingen plats finns, punkt. En gammal
    // cache får inte återuppliva en borttagen eller aldrig skapad plats.
    removeStoredLocationId()
    return null
  } catch {
    // 403 för personal, eller rutten inte deployad — prova nästa väg.
  }

  // 2. Härled ur användarlistan.
  try {
    const users = await listUsers()
    const own = callerSub
      ? users.find((u) => u.cognitoSub === callerSub)
      : undefined
    const candidates = new Set(
      [own?.locationId, ...users.map((u) => u.locationId)]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    )
    for (const candidate of candidates) {
      // En användarpost kan bära ett id till en borttagen plats (t.ex. en
      // gammal dubblett). Servern får döma — ett uttryckligt "finns inte"
      // hoppar till nästa kandidat i stället för att låsa fast alla sidor
      // vid ett dött id.
      if ((await locationExists(candidate)) !== false) {
        persistStoredLocationId(candidate)
        return candidate
      }
    }
  } catch {
    // Inte heller listan gick att nå — cachen nedan är sista utvägen.
  }

  // 3. Servern gav inget definitivt svar — kör vidare på cachen om den finns,
  //    men släpp den om servern uttryckligen säger att platsen inte finns.
  const stored = getStoredLocationId()
  if (stored && (await locationExists(stored)) === false) {
    removeStoredLocationId()
    return null
  }
  return stored
}

/**
 * En serverbekräftelse per session och användare räcker. Skalet monterar
 * `useLocationId` på varje sidbyte, och utan det här minnet hade varje
 * navigering kostat ett `GET /locations`-anrop.
 */
const resolutionCache = new Map<string, Promise<string | null>>()

function resolveLocationIdCached(
  callerSub: string | null,
): Promise<string | null> {
  const key = callerSub ?? ''
  let promise = resolutionCache.get(key)
  if (!promise) {
    promise = resolveLocationId(callerSub)
    resolutionCache.set(key, promise)
  }
  return promise
}

/**
 * Plats-ID:t för den inloggade. Cachen ger ett värde direkt, men servern
 * tillfrågas alltid i bakgrunden och dess svar ersätter cachen — så en enhet
 * med ett gammalt eller felaktigt id självläker till restaurangens riktiga.
 * `resolving` är sant tills ett värde finns — sidorna ska inte påstå att
 * ingen plats finns medan sökningen pågår.
 */
export function useLocationId(callerSub: string | null): {
  locationId: string | null
  setLocationId: (id: string) => void
  resolving: boolean
} {
  const [locationId, setLocationIdState] = useState<string | null>(() =>
    getStoredLocationId(),
  )
  const [resolving, setResolving] = useState(() => !getStoredLocationId())

  useEffect(() => {
    let cancelled = false
    resolveLocationIdCached(callerSub).then((id) => {
      if (cancelled) return
      if (id) {
        setLocationIdState(id)
      } else {
        // Ett tomt svar får inte radera ett id som hann sättas under tiden
        // (t.ex. att platsen just skapades i en annan flik/komponent).
        setLocationIdState(getStoredLocationId())
      }
      setResolving(false)
    })
    return () => {
      cancelled = true
    }
  }, [callerSub])

  function setLocationId(id: string) {
    setStoredLocationId(id)
    setLocationIdState(id)
    setResolving(false)
  }

  return { locationId, setLocationId, resolving }
}

export interface LocationSummary {
  name: string
  address: string
}

/**
 * Cache i modulnivå så att varje sidbyte inte gör ett nytt anrop — skalet
 * (sidebar + topbar) ritas om på varje sida och behöver samma två fält.
 */
let cached: { id: string; summary: LocationSummary } | null = null
let pending: { id: string; promise: Promise<LocationSummary | null> } | null =
  null

async function fetchSummary(id: string): Promise<LocationSummary | null> {
  if (cached?.id === id) return cached.summary
  if (pending?.id !== id) {
    const promise = getLocation(id)
      .then((loc) => {
        const summary = { name: loc.name, address: loc.address }
        cached = { id, summary }
        return summary
      })
      .catch(() => null)
      .finally(() => {
        if (pending?.promise === promise) pending = null
      })
    pending = { id, promise }
  }
  return pending.promise
}

/** Glöm cachen när platsen ändrats, så skalet visar de nya uppgifterna. */
export function clearLocationSummaryCache(): void {
  cached = null
}

/**
 * Platsens namn och adress för skalet. Returnerar null tills den finns —
 * anroparen ska då visa ingenting hellre än en platshållare.
 */
export function useLocationSummary(): LocationSummary | null {
  const { sub } = useAuth()
  // Går via useLocationId så att skalet hittar restaurangen även i en
  // webbläsare som aldrig sett den förut.
  const { locationId } = useLocationId(sub)
  const [summary, setSummary] = useState<LocationSummary | null>(
    () => cached?.summary ?? null,
  )

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    fetchSummary(locationId).then((s) => {
      if (!cancelled && s) setSummary(s)
    })
    return () => {
      cancelled = true
    }
  }, [locationId])

  return summary
}
