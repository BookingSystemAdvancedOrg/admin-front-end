import { apiFetch, ApiError } from '../../shared/api'
import type { Dish, DishCategory } from './data'

/**
 * Klient mot backendens meny-endpoints (openapi.yaml, Menu/Media-taggarna):
 *
 *   GET    /locations/{id}/menu                    — publik meny (bara aktiva)
 *   GET    /locations/{id}/menu/items              — alla rätter, kräver inloggning
 *   POST   /locations/{id}/menu/items              — skapa
 *   PUT    /locations/{id}/menu/items/{menuItemId} — partiell uppdatering
 *   DELETE /locations/{id}/menu/items/{menuItemId} — ta bort
 *   GET    /menu-images/presigned-url              — S3-uppladdnings-URL (5 min)
 *
 * Speglar kontraktets validering: namn krävs, pris >= 0 med högst två
 * decimaler, kategori ur enum:en, imageKey krävs vid skapande (och kan
 * aldrig tömmas — bara ersättas). Beskrivningen får vara tom.
 *
 * OBS enligt kontraktet verifierar meny-Lambdan INTE att platsen finns —
 * en tom lista kan alltså också betyda "fel plats-id".
 */

export type MenuCategory = 'starters' | 'mains' | 'desserts' | 'drinks'

/** API:ts kategorier <-> gränssnittets svenska värden. */
export const CATEGORY_TO_API: Record<DishCategory, MenuCategory> = {
  forratter: 'starters',
  varmratter: 'mains',
  efterratter: 'desserts',
  drycker: 'drinks',
}
export const CATEGORY_FROM_API: Record<MenuCategory, DishCategory> = {
  starters: 'forratter',
  mains: 'varmratter',
  desserts: 'efterratter',
  drinks: 'drycker',
}

export interface MenuItem {
  menuItemId: string
  name: string
  description: string
  price: number
  category: MenuCategory
  imageKey: string
  active: boolean
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

/** Den publika menyns kundvända form — inga auditfält, bara aktiva rätter. */
export type PublicMenuItem = Pick<
  MenuItem,
  'menuItemId' | 'name' | 'description' | 'price' | 'category' | 'imageKey'
>

/** Alla sex fälten krävs vid skapande enligt kontraktet. */
export interface MenuItemCreate {
  name: string
  description: string
  price: number
  category: MenuCategory
  imageKey: string
  active: boolean
}

/** Partiell uppdatering — minst ett fält krävs av API:t. */
export type MenuItemUpdate = Partial<MenuItemCreate>

/* --- Bildvisning ---------------------------------------------------------- */

/**
 * Bas-URL (CDN/CloudFront) för att visa lagrade menybilder. API:t returnerar
 * bara S3-nyckeln, aldrig en färdig URL — utan den här variabeln kan bilder
 * laddas upp men inte visas (platshållaren används i stället).
 */
export const MENU_IMAGE_BASE_URL = (
  import.meta.env.VITE_MENU_IMAGE_BASE_URL as string | undefined
)?.replace(/\/+$/, '')

export function menuImageUrl(imageKey: string): string | null {
  if (!imageKey.trim() || !MENU_IMAGE_BASE_URL) return null
  return `${MENU_IMAGE_BASE_URL}/${imageKey}`
}

/* --- Översättning API <-> gränssnitt -------------------------------------- */

export function toDish(item: MenuItem): Dish {
  return {
    id: item.menuItemId,
    name: item.name,
    description: item.description,
    category: CATEGORY_FROM_API[item.category],
    price: item.price,
    active: item.active,
    imageKey: item.imageKey,
    image: menuImageUrl(item.imageKey),
  }
}

/** Publika menyn saknar aktiv-flaggan — allt den returnerar ÄR aktivt. */
export function publicToDish(item: PublicMenuItem): Dish {
  return toDish({ ...item, active: true } as MenuItem)
}

/**
 * Ändrade fält jämfört med den sparade rätten, för PUT:en. API:t kräver
 * minst ett fält, så en tom diff ska aldrig skickas — anroparen kan skilja
 * "inget ändrat" från ett riktigt anrop. En tom imageKey skickas aldrig
 * (fältet kan inte tömmas enligt kontraktet).
 */
export function dishChanges(original: Dish, next: MenuItemCreate): MenuItemUpdate {
  const updates: MenuItemUpdate = {}
  if (next.name !== original.name) updates.name = next.name
  if (next.description !== original.description) {
    updates.description = next.description
  }
  if (next.price !== original.price) updates.price = next.price
  if (next.category !== CATEGORY_TO_API[original.category]) {
    updates.category = next.category
  }
  if (next.active !== original.active) updates.active = next.active
  if (next.imageKey.trim() && next.imageKey !== original.imageKey) {
    updates.imageKey = next.imageKey
  }
  return updates
}

/* --- Validering (spegel av kontraktet) ------------------------------------ */

export function validateDishName(name: string): string | null {
  return name.trim() ? null : 'Namn krävs.'
}

export function validateDishPrice(price: number): string | null {
  if (!Number.isFinite(price) || price < 0) {
    return 'Pris måste vara noll eller mer.'
  }
  // multipleOf 0.01 — flyttalsbrus tolereras på tiondels öre.
  if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
    return 'Pris får ha högst två decimaler.'
  }
  return null
}

/* --- Felöversättning ------------------------------------------------------ */

/**
 * Gatewayens ruttnivå-404 har body {"message":"Not Found"} och betyder att
 * meny-endpointen inte är deployad än; Lambdans 404 säger "menu item not
 * found". De behöver helt olika texter.
 */
export const MENU_ROUTES_MISSING_MESSAGE =
  'Menyns adminrutter är inte deployade på API:t än — publika menyn visas i stället, och ändringar kan inte sparas.'

export function isMenuRoutesMissing(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 404 &&
    err.message === MENU_ROUTES_MISSING_MESSAGE
  )
}

/** Mappar API:ts fel till svenska; statuskoden bevaras som i locationApi. */
function toFriendlyMenuError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Ett okänt fel inträffade.')
  }

  console.error(`[Menu] ${err.status}: ${err.message}`)

  switch (err.status) {
    case 400:
      return new ApiError(400, `Rätten avvisades av servern: ${err.message}`)
    case 401:
      return new ApiError(401, 'Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new ApiError(403, 'Du har inte behörighet att ändra menyn.')
    case 404:
      return err.message === 'Not Found'
        ? new ApiError(404, MENU_ROUTES_MISSING_MESSAGE)
        : new ApiError(404, 'Rätten finns inte längre — ladda om sidan.')
    case 409:
      return new ApiError(
        409,
        'Menyn ändrades samtidigt av någon annan. Ladda om och försök igen.',
      )
    case 503:
      return new ApiError(503, 'Menytjänsten är tillfälligt otillgänglig. Försök igen.')
    default:
      return new ApiError(err.status, err.message || `Serverfel (${err.status}).`)
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toFriendlyMenuError(err)
  }
}

/* --- HTTP ----------------------------------------------------------------- */

function itemsPath(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/menu/items`
}

/** Publika menyn — bara aktiva rätter, ingen inloggning krävs. */
export function getPublicMenu(locationId: string): Promise<PublicMenuItem[]> {
  return call(async () => {
    const res = await apiFetch<{ items?: PublicMenuItem[] }>(
      `/locations/${encodeURIComponent(locationId)}/menu`,
    )
    return res.items ?? []
  })
}

/** Hela menyn inklusive inaktiva rätter. Ordningen är inte garanterad. */
export function listMenuItems(locationId: string): Promise<MenuItem[]> {
  return call(async () => {
    const res = await apiFetch<{ items?: MenuItem[] }>(itemsPath(locationId))
    return res.items ?? []
  })
}

export function createMenuItem(
  locationId: string,
  item: MenuItemCreate,
): Promise<MenuItem> {
  return call(() =>
    apiFetch<MenuItem>(itemsPath(locationId), {
      method: 'POST',
      body: JSON.stringify(item),
    }),
  )
}

export function updateMenuItem(
  locationId: string,
  menuItemId: string,
  updates: MenuItemUpdate,
): Promise<MenuItem> {
  return call(() =>
    apiFetch<MenuItem>(
      `${itemsPath(locationId)}/${encodeURIComponent(menuItemId)}`,
      { method: 'PUT', body: JSON.stringify(updates) },
    ),
  )
}

export function deleteMenuItem(
  locationId: string,
  menuItemId: string,
): Promise<void> {
  return call(() =>
    apiFetch<void>(`${itemsPath(locationId)}/${encodeURIComponent(menuItemId)}`, {
      method: 'DELETE',
    }),
  )
}

/* --- Bilduppladdning ------------------------------------------------------ */

export const MENU_IMAGE_CONTENT_TYPES = [
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type MenuImageContentType = (typeof MENU_IMAGE_CONTENT_TYPES)[number]

export interface MenuImageUpload {
  uploadUrl: string
  imageKey: string
  expiresIn: number
  requiredHeaders: { 'Content-Type': MenuImageContentType }
}

/** Kräver owner_user/super_user — personal får 403 här enligt kontraktet. */
export function createMenuImageUploadUrl(
  locationId: string,
  contentType: MenuImageContentType,
): Promise<MenuImageUpload> {
  const query = new URLSearchParams({ locationId, contentType })
  return call(() =>
    apiFetch<MenuImageUpload>(`/menu-images/presigned-url?${query.toString()}`),
  )
}

/**
 * Laddar upp en bildfil: hämtar en femminuters presigned S3-URL och PUT:ar
 * filen dit med exakt den Content-Type servern kräver. Returnerar imageKey
 * som ska sparas på rätten. S3-anropet går utan Authorization-header —
 * behörigheten ligger i själva URL:en.
 */
export async function uploadMenuImage(
  locationId: string,
  file: File,
): Promise<string> {
  const contentType = file.type as MenuImageContentType
  if (!MENU_IMAGE_CONTENT_TYPES.includes(contentType)) {
    throw new Error('Bilden måste vara AVIF, JPEG, PNG eller WebP.')
  }
  const grant = await createMenuImageUploadUrl(locationId, contentType)
  const res = await fetch(grant.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': grant.requiredHeaders['Content-Type'] },
  })
  if (!res.ok) {
    throw new Error('Bilduppladdningen misslyckades — försök igen.')
  }
  return grant.imageKey
}
