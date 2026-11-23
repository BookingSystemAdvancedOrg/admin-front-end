import { ApiError, apiFetch } from '../../shared/api'
import { tablesFromLayout } from '../../shared/tables'
import { loadLayoutVersions, toFloors } from './layoutApi'
import type { LayoutElement } from './layoutApi'
import type { Floor } from './data'

/** GET /locations/{id}/layout/active: den publicerade planen gästerna bokar mot. */
export interface PublicLayout {
  floors: { floorId: string; name?: string; level: number }[]
  elements: (Omit<LayoutElement, 'updatedBy' | 'updatedAt'> & { label?: string })[]
}

/** Planen som kartan ritar: våningarna och "Bord 3" per bord-id (som gästsajten numrerar). */
export interface ActivePlan {
  floors: Floor[]
  labels: Map<string, string>
}

/** Den publicerade planen som våningar och etiketter; null = ingen plan. */
export function planFromLayout(layout: PublicLayout): ActivePlan | null {
  // Ingen aktiv layout än: servern svarar 200 med en tom plan.
  if (layout.floors.length === 0 && layout.elements.length === 0) return null
  const stamp = { updatedBy: '', updatedAt: '' }
  const elements: LayoutElement[] = [
    ...layout.floors.map((f) => ({
      elementId: f.floorId,
      type: 'floor' as const,
      name: f.name,
      level: f.level,
      x: 0,
      y: 0,
      z: 0,
      width: 0,
      height: 0,
      depth: 0,
      rotationY: 0,
      ...stamp,
    })),
    ...layout.elements.map((e) => ({ ...e, ...stamp })),
  ]
  const labels = new Map(tablesFromLayout(layout).map((t) => [t.tableId, t.label]))
  return { floors: toFloors(elements), labels }
}

/** Den gällande planen (samma som gästerna bokar mot); null = ingen publicerad. */
export async function loadActiveLayout(locationId: string): Promise<ActivePlan | null> {
  let layout: PublicLayout
  try {
    layout = await apiFetch<PublicLayout>(`/locations/${encodeURIComponent(locationId)}/layout/active`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
  return planFromLayout(layout)
}

/** De publicerade versionerna som planer, för dagar då en annan version gäller än idag. */
export interface VersionPlans {
  /** Versionen som gäller nu; null = okänt. */
  current: number | null
  plans: Map<number, ActivePlan>
}

/** En versions ögonblicksbild (våningar som element) som samma plan som GET /layout/active ger. */
export function planFromSnapshot(elements: LayoutElement[]): ActivePlan | null {
  const floors = elements
    .filter((e) => e.type === 'floor')
    .map((f) => ({ floorId: f.elementId, name: f.name, level: f.level ?? 0 }))
  return planFromLayout({ floors, elements: elements.filter((e) => e.type !== 'floor') })
}

/**
 * GET /layout/versions: varje publicerad version som plan. Bokningar efter
 * ett inbokat versionsbyte gäller den nya versionens bord, som inte finns i
 * GET /layout/active förrän bytet skett. Hämtas bara när det behövs.
 */
export async function loadVersionPlans(locationId: string): Promise<VersionPlans> {
  const { items } = await loadLayoutVersions(locationId)
  const plans = new Map<number, ActivePlan>()
  for (const item of items) {
    const p = planFromSnapshot(item.elements ?? [])
    if (p) plans.set(item.version, p)
  }
  return { current: items.find((i) => i.isCurrent)?.version ?? null, plans }
}
