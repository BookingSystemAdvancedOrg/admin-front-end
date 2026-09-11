/**
 * Delade typer för meny-vyn. Rätterna kommer från backendens meny-API
 * (menuApi.ts) — mockdatan som låg här tidigare är borttagen.
 *
 * Kategorierna speglar API:ts enum (starters/mains/desserts/drinks) men
 * behåller svenska värden i gränssnittet; översättningen bor i menuApi.ts.
 */

export type DishCategory =
  | 'forratter'
  | 'varmratter'
  | 'efterratter'
  | 'drycker'

export interface Dish {
  /** API:ts menuItemId. */
  id: string
  name: string
  /** Får vara tom — API:t trimmar omgivande whitespace. */
  description: string
  category: DishCategory
  /** Pris i kr, högst två decimaler enligt API:t. */
  price: number
  active: boolean
  /**
   * S3-nyckeln som API:t lagrar. Tom sträng = ingen bild. Nyckeln kan inte
   * tömmas via API:t (fältet kräver minst ett tecken), bara ersättas.
   */
  imageKey: string
  /**
   * Visningsbar bild-URL: CDN-adress byggd från imageKey när
   * VITE_MENU_IMAGE_BASE_URL är satt, annars null (platshållare visas).
   */
  image: string | null
}

export const CATEGORY_LABEL: Record<DishCategory, string> = {
  forratter: 'Förrätter',
  varmratter: 'Varmrätter',
  efterratter: 'Efterrätter',
  drycker: 'Drycker',
}
