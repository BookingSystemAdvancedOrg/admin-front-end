import {
  currentLocation,
  getTenantState,
  loadTenant,
  selectLocation,
  useTenant,
} from './tenant'

/**
 * Vilken av restaurangens platser appen arbetar med.
 *
 * Källan är GET /tenant (se tenant.ts): servern listar de platser den
 * inloggade får se — ägaren alla restaurangens, personal bara sin egen — och
 * appen väljer bland dem. Ett plats-id som inte finns i den listan (en annan
 * restaurangs, ett borttaget, ett gammalt i webbläsarens cache) kan därför
 * aldrig bli valt.
 *
 * Tidigare antogs "en deployment per kund, en restaurang" och platsen
 * gissades ur GET /locations, användarlistan och localStorage. Det höll inte
 * när plattformen blev multi-tenant med flera platser per restaurang.
 */

/** Den valda platsen just nu (utanför React, t.ex. i en async-funktion). */
export function getStoredLocationId(): string | null {
  return getTenantState().locationId
}

/**
 * Hämtar om restaurangen från servern och returnerar den plats som gäller
 * — t.ex. strax innan en ny plats skapas, för att aldrig skapa en dubblett.
 */
export async function resolveLocationId(
  callerSub: string | null,
): Promise<string | null> {
  await loadTenant(callerSub, { force: true })
  return getTenantState().locationId
}

/**
 * Plats-ID:t för den inloggade. `resolving` är sant tills restaurangen är
 * hämtad — sidorna ska inte påstå att ingen plats finns medan den laddas.
 * `setLocationId` väljer en plats (t.ex. en som just skapats: listan hämtas
 * om först så att den nya platsen finns med).
 */
export function useLocationId(callerSub: string | null): {
  locationId: string | null
  setLocationId: (id: string) => void
  resolving: boolean
} {
  void callerSub // inloggningen läses av useTenant; parametern finns kvar för anroparna
  const { locationId, status } = useTenant()

  function setLocationId(id: string) {
    void loadTenant(getTenantState().sub, { force: true }).then(() =>
      selectLocation(id),
    )
  }

  return {
    locationId,
    setLocationId,
    resolving: status === 'idle' || status === 'loading',
  }
}

export interface LocationSummary {
  name: string
  address: string
}

/** Den valda platsens namn och adress för skalet, eller null. */
export function useLocationSummary(): LocationSummary | null {
  const location = currentLocation(useTenant())
  if (!location) return null
  return { name: location.name ?? '', address: location.address ?? '' }
}

/** Hämta om namn/adress efter att platsen ändrats, så skalet visar de nya. */
export function clearLocationSummaryCache(): void {
  void loadTenant(getTenantState().sub, { force: true })
}
