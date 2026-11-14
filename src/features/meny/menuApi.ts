import { errorText as commonError } from '../../shared/errors'
import { apiFetch, ApiError } from '../../shared/api'
import { withBusy } from '../../shared/motion/busy'
import { ALLERGENS } from './data'
import type { Allergen, Dish, DishComponent, MenuCategoryEntry, OptionGroup } from './data'
import { clampFocus, isCentre, sameFocus } from './imageFocus'
import type { ImageFocus } from './imageFocus'

/**
 * Klient mot backendens meny-endpoints (openapi.yaml, Menu/Media-taggarna):
 *
 *   GET    /locations/{id}/menu                    - publik meny (bara aktiva)
 *   GET    /locations/{id}/menu/items              - alla rätter, kräver inloggning
 *   POST   /locations/{id}/menu/items              - skapa
 *   PUT    /locations/{id}/menu/items/{menuItemId} - partiell uppdatering
 *   DELETE /locations/{id}/menu/items/{menuItemId} - ta bort
 *   GET    /locations/{id}/menu/categories         - platsens kategorier
 *   PUT    /locations/{id}/menu/categories         - spara hela listan
 *   GET    /menu-images/presigned-url              - S3-uppladdnings-URL (5 min)
 *
 * Speglar kontraktets validering: namn krävs, pris >= 0 med högst två
 * decimaler, kategori ur platsens kategorier, bild frivillig (null tar bort
 * den). Beskrivningen får vara tom.
 *
 * OBS enligt kontraktet verifierar meny-Lambdan INTE att platsen finns -
 * en tom lista kan alltså också betyda "fel plats-id".
 */

/** Ett categoryId bland platsens kategorier. */
export type MenuCategory = string

export interface MenuItem {
  menuItemId: string
  name: string
  description: string
  price: number
  category: MenuCategory
  /** null = ingen bild. */
  imageKey: string | null
  active: boolean
  allergens?: Allergen[]
  options?: OptionGroup[]
  /** Innehåller alkohol (backend: 25 % moms, inte till avhämtning). Saknas = false. */
  alcohol?: boolean
  /** Schema i UTC; null eller saknas = ingen gräns. Slutet är exklusivt. */
  availableFrom?: string | null
  availableUntil?: string | null
  /** Bongens station; "none" = ingen bong; null = kategorins. */
  station?: string | null
  components?: DishComponent[]
  /** Bildens fokuspunkt i hela procent; saknas = mitten. */
  imageFocus?: ImageFocus | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

/**
 * Den publika menyns kundvända form - inga auditfält, bara aktiva rätter.
 * `active` är med som frivilligt fält: backend-teamet har beskrivit en
 * variant där samma rutt ger fulla listan (inkl. inaktiva) till inloggade,
 * och då ska flaggan respekteras i stället för att antas vara sann.
 */
export type PublicMenuItem = Pick<
  MenuItem,
  'menuItemId' | 'name' | 'description' | 'price' | 'category' | 'imageKey'
> &
  Partial<Pick<MenuItem, 'active' | 'alcohol' | 'imageFocus' | 'allergens' | 'options'>>

/** Namn, beskrivning, pris, kategori och aktiv krävs vid skapande; bilden är frivillig. */
export interface MenuItemCreate {
  name: string
  description: string
  price: number
  category: MenuCategory
  /** null = ingen bild (tar bort en sparad bild vid ändring). */
  imageKey: string | null
  active: boolean
  /** null eller tom rensar. */
  allergens?: Allergen[] | null
  options?: OptionGroup[] | null
  alcohol?: boolean
  /** null rensar gränsen. */
  availableFrom?: string | null
  availableUntil?: string | null
  station?: string | null
  /** null eller tom rensar. */
  components?: DishComponent[] | null
  /** null = mitten (rensar ett sparat värde). Skickas bara när det ändrats. */
  imageFocus?: ImageFocus | null
}

/** Partiell uppdatering - minst ett fält krävs av API:t. */
export type MenuItemUpdate = Partial<MenuItemCreate>

/** 409 när någon annan sparat rätten efter att den laddades. */
export const STALE_DISH_MESSAGE =
  'Någon annan har ändrat rätten medan du redigerade. Det senaste visas nu; spara igen om din ändring fortfarande behövs.'

export function isStaleDish(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'stale_item'
}

/** 409 när någon annan sparat kategorierna efter att de laddades. */
export function isStaleCategories(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'stale_categories'
}

/* --- Bildvisning ---------------------------------------------------------- */

/**
 * Bas-URL (CDN/CloudFront) för att visa lagrade menybilder. API:t returnerar
 * bara S3-nyckeln, aldrig en färdig URL - utan den här variabeln kan bilder
 * laddas upp men inte visas (platshållaren används i stället).
 */
export const MENU_IMAGE_BASE_URL = (
  import.meta.env.VITE_MENU_IMAGE_BASE_URL as string | undefined
)?.replace(/\/+$/, '')

export function menuImageUrl(imageKey: string | null | undefined): string | null {
  if (!imageKey?.trim() || !MENU_IMAGE_BASE_URL) return null
  return `${MENU_IMAGE_BASE_URL}/${imageKey}`
}

/* --- Översättning API <-> gränssnitt -------------------------------------- */

export function toDish(item: MenuItem): Dish {
  return {
    id: item.menuItemId,
    name: item.name,
    description: item.description,
    category: item.category,
    price: item.price,
    active: item.active,
    alcohol: item.alcohol === true,
    imageKey: item.imageKey ?? '',
    image: menuImageUrl(item.imageKey),
    imageFocus: item.imageFocus && !isCentre(item.imageFocus) ? clampFocus(item.imageFocus) : null,
    availableFrom: item.availableFrom ?? null,
    availableUntil: item.availableUntil ?? null,
    station: item.station ?? null,
    components: item.components ?? [],
    allergens: (item.allergens ?? []).filter((a): a is Allergen => (ALLERGENS as readonly string[]).includes(a)),
    options: item.options ?? [],
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  }
}

/** Saknas aktiv-flaggan är allt som returneras aktivt; finns den gäller den. */
export function publicToDish(item: PublicMenuItem): Dish {
  return toDish({ ...item, active: item.active ?? true } as MenuItem)
}

/**
 * Ändrade fält jämfört med den sparade rätten, för PUT:en. API:t kräver
 * minst ett fält, så en tom diff ska aldrig skickas - anroparen kan skilja
 * "inget ändrat" från ett riktigt anrop. imageKey null tar bort bilden.
 */
/** Rätten som ett fullt sparobjekt (för att jämföra två versioner med dishChanges). */
export function dishAsCreate(d: Dish): MenuItemCreate {
  return {
    name: d.name, description: d.description, price: d.price, category: d.category, imageKey: d.imageKey ?? null,
    active: d.active, alcohol: d.alcohol, availableFrom: d.availableFrom ?? null, availableUntil: d.availableUntil ?? null,
    station: d.station ?? null, components: d.components ?? [], allergens: d.allergens ?? [], options: d.options ?? [],
    ...(d.imageFocus ? { imageFocus: d.imageFocus } : {}),
  }
}

export function dishChanges(original: Dish, next: MenuItemCreate): MenuItemUpdate {
  const updates: MenuItemUpdate = {}
  if (next.name !== original.name) updates.name = next.name
  if (next.description !== original.description) {
    updates.description = next.description
  }
  if (next.price !== original.price) updates.price = next.price
  if (next.category !== original.category) {
    updates.category = next.category
  }
  if (next.active !== original.active) updates.active = next.active
  if (next.alcohol !== undefined && next.alcohol !== original.alcohol) {
    updates.alcohol = next.alcohol
  }
  if (next.availableFrom !== undefined && next.availableFrom !== original.availableFrom) {
    updates.availableFrom = next.availableFrom
  }
  if (next.availableUntil !== undefined && next.availableUntil !== original.availableUntil) {
    updates.availableUntil = next.availableUntil
  }
  if (next.station !== undefined && next.station !== (original.station ?? null)) updates.station = next.station
  if (next.components !== undefined && JSON.stringify(next.components ?? []) !== JSON.stringify(original.components ?? [])) {
    updates.components = next.components?.length ? next.components : null
  }
  if (next.imageFocus !== undefined && !sameFocus(next.imageFocus, original.imageFocus)) {
    updates.imageFocus = isCentre(next.imageFocus) ? null : clampFocus(next.imageFocus)
  }
  if (next.allergens !== undefined && JSON.stringify(next.allergens ?? []) !== JSON.stringify(original.allergens ?? [])) {
    updates.allergens = next.allergens?.length ? next.allergens : null
  }
  if (next.options !== undefined && JSON.stringify(next.options ?? []) !== JSON.stringify(original.options ?? [])) {
    updates.options = next.options?.length ? next.options : null
  }
  if (next.imageKey === null) {
    if (original.imageKey) updates.imageKey = null
  } else if (next.imageKey.trim() && next.imageKey !== original.imageKey) {
    updates.imageKey = next.imageKey
  }
  return updates
}

/* --- Validering (spegel av kontraktet) ------------------------------------ */

export function validateDishName(name: string): string | null {
  return name.trim() ? null : 'Namn krävs.'
}

/** Högsta pris på en produkt (rätt eller cateringrad) - samma skrivfelsspärr
 * som servern (application shared/prices.py). */
export const MAX_ITEM_PRICE_KR = 10_000

/**
 * Pris som gästen ser, inmatat som text: "89", "89,50", "89.50" och
 * "1 250" går bra. Allt annat ("abc", "-10", "12,345", tomt) ger ett
 * svenskt felmeddelande i stället för ett tyst 0 eller 10 kr.
 */
export function parsePrice(text: string): { value: number; error: null } | { value: null; error: string } {
  const raw = text.trim().replace(/[\s\u00a0]/g, '').replace(/kr$/i, '')
  if (!raw) return { value: null, error: 'Pris krävs.' }
  if (/^[-\u2212]/.test(raw)) return { value: null, error: 'Priset kan inte vara negativt.' }
  if (!/^\d+([.,]\d+)?$/.test(raw)) {
    return { value: null, error: 'Skriv priset med siffror, till exempel 89 eller 89,50.' }
  }
  if (/[.,]\d{3,}$/.test(raw)) return { value: null, error: 'Pris får ha högst två decimaler.' }
  const value = Number(raw.replace(',', '.'))
  const error = validateDishPrice(value)
  return error ? { value: null, error } : { value, error: null }
}

export function validateDishPrice(price: number): string | null {
  if (!Number.isFinite(price) || price < 0) {
    return 'Pris måste vara noll eller mer.'
  }
  if (price > MAX_ITEM_PRICE_KR) {
    return `Pris får vara högst ${MAX_ITEM_PRICE_KR.toLocaleString('sv-SE')} kr.`
  }
  // multipleOf 0.01 - flyttalsbrus tolereras på tiondels öre.
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
  'Menyns adminrutter är inte deployade på API:t än - publika menyn visas i stället, och ändringar kan inte sparas.'

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
  // offline, utloggad, pausat konto, för många försök: samma text överallt
  if (err.status === 0 || err.status === 429 || (err.status === 403 && err.code !== 'forbidden')) {
    return new ApiError(err.status, commonError(err), { code: err.code })
  }

  switch (err.status) {
    case 400:
      if (/^price may be at most/.test(err.message)) {
        return new ApiError(400, `Pris får vara högst ${MAX_ITEM_PRICE_KR.toLocaleString('sv-SE')} kr.`)
      }
      if (err.message === 'availableUntil must be after availableFrom') {
        return new ApiError(400, 'Slutet på schemat måste vara efter starten.')
      }
      return new ApiError(400, commonError(err, 'Rätten kunde inte sparas.', {}, MENU_FIELDS), { code: err.code, field: err.field })
    case 401:
      return new ApiError(401, 'Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new ApiError(403, 'Du har inte behörighet att ändra menyn.')
    case 404:
      return err.message === 'Not Found'
        ? new ApiError(404, MENU_ROUTES_MISSING_MESSAGE)
        : new ApiError(404, 'Rätten finns inte längre; den har tagits bort på en annan plats.')
    case 409:
      if (err.code === 'stale_item') return new ApiError(409, STALE_DISH_MESSAGE, { code: 'stale_item' })
      if (err.code === 'category_in_use') {
        return new ApiError(409, 'Kategorin har rätter. Flytta rätterna till en annan kategori först.', { code: err.code })
      }
      if (err.code === 'stale_categories') {
        return new ApiError(409, 'Någon annan har ändrat kategorierna medan du redigerade. Det senaste visas nu; spara igen om din ändring fortfarande behövs.', { code: err.code })
      }
      return new ApiError(
        409,
        'Menyn ändrades samtidigt av någon annan. Det senaste visas nu; försök igen.',
        { code: 'stale_item' },
      )
    case 503:
      return new ApiError(503, 'Menytjänsten är tillfälligt otillgänglig. Försök igen.')
    default:
      return new ApiError(err.status, commonError(err, 'Kunde inte spara menyn.'), { code: err.code })
  }
}

const MENU_FIELDS: Record<string, string> = {
  name: 'namnet', description: 'beskrivningen', price: 'priset', category: 'kategorin',
  allergens: 'allergenerna', imageUrl: 'bilden', imageFocus: 'bildens fokus', availableFrom: 'schemats start', availableUntil: 'schemats slut',
  schedule: 'schemat', vatRate: 'momsen', options: 'tillvalen', sortOrder: 'ordningen',
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

/** Publika menyn - bara aktiva rätter, ingen inloggning krävs. */
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

/**
 * `expectedUpdatedAt`: rättens updatedAt som den laddades. Har någon annan
 * sparat sedan dess svarar API:t 409 (isStaleDish) och inget sparas.
 */
export function updateMenuItem(
  locationId: string,
  menuItemId: string,
  updates: MenuItemUpdate,
  expectedUpdatedAt?: string,
): Promise<MenuItem> {
  return call(() =>
    apiFetch<MenuItem>(
      `${itemsPath(locationId)}/${encodeURIComponent(menuItemId)}`,
      { method: 'PUT', body: JSON.stringify(expectedUpdatedAt ? { ...updates, expectedUpdatedAt } : updates) },
    ),
  )
}

export interface MenuCategories {
  categories: MenuCategoryEntry[]
  version: number
}

function categoriesPath(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/menu/categories`
}

/** Platsens kategorier i visningsordning (de fyra standard tills ägaren ändrar). */
export function getMenuCategories(locationId: string): Promise<MenuCategories> {
  return call(() => apiFetch<MenuCategories>(categoriesPath(locationId)))
}

/** Hela listan: ny kategori utan categoryId, byt namn, ordning, ta bort. */
export function putMenuCategories(
  locationId: string,
  categories: { categoryId?: string; name: string }[],
  version: number,
): Promise<MenuCategories> {
  return call(() =>
    apiFetch<MenuCategories>(categoriesPath(locationId), {
      method: 'PUT',
      body: JSON.stringify({ categories, version }),
    }),
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

/** Kräver owner_user/super_user - personal får 403 här enligt kontraktet. */
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
 * som ska sparas på rätten. S3-anropet går utan Authorization-header -
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
  // Själva uppladdningen går till S3, inte via apiFetch: visa den som pågående själv.
  await withBusy(async () => {
    const res = await fetch(grant.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': grant.requiredHeaders['Content-Type'] },
    })
    if (!res.ok) {
      throw new Error('Bilduppladdningen misslyckades - försök igen.')
    }
  })
  return grant.imageKey
}
