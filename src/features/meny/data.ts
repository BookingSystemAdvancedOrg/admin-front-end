/**
 * Delade typer för meny-vyn. Rätterna kommer från backendens meny-API
 * (menuApi.ts) - mockdatan som låg här tidigare är borttagen.
 *
 * Kategorierna är platsens egna (GET/PUT /menu/categories): ett id och ett
 * namn i visningsordning. Tills ägaren ändrar dem finns de fyra standard-
 * kategorierna, vars id är API:ts gamla värden (starters, mains ...).
 */

import type { Allergen } from '../catering/cateringApi'
import type { ImageFocus } from './imageFocus'

/** API:ts categoryId. */
export type DishCategory = string

export interface MenuCategoryEntry {
  categoryId: string
  name: string
}

export const DEFAULT_CATEGORIES: MenuCategoryEntry[] = [
  { categoryId: 'starters', name: 'Förrätter' },
  { categoryId: 'mains', name: 'Varmrätter' },
  { categoryId: 'desserts', name: 'Efterrätter' },
  { categoryId: 'drinks', name: 'Drycker' },
]

/** Kategorins namn, eller "Övrigt" när id:t inte finns bland platsens. */
export function categoryName(categories: MenuCategoryEntry[], id: string): string {
  return categories.find((c) => c.categoryId === id)?.name ?? 'Övrigt'
}

/** EU:s 14 allergener med svenska namn, samma koder som cateringmenyn och API:t. */
export { ALLERGENS, ALLERGEN_LABEL } from '../catering/cateringApi'
export type { Allergen } from '../catering/cateringApi'
/** Ett tillval gästen kan välja, med pristillägg i kr (0 = gratis). */
export interface OptionChoice {
  name: string
  price: number
}

/** En grupp tillval, t.ex. Storlek (krävs, ett val) eller Extra (frivilligt, upp till tre). */
export interface OptionGroup {
  name: string
  required: boolean
  maxChoices: number
  choices: OptionChoice[]
}

export interface Dish {
  /** API:ts menuItemId. */
  id: string
  name: string
  /** Får vara tom - API:t trimmar omgivande whitespace. */
  description: string
  category: DishCategory
  /** Pris i kr, högst två decimaler enligt API:t. */
  price: number
  active: boolean
  /** Innehåller alkohol: 25 % moms och kan inte beställas för avhämtning. */
  alcohol: boolean
  /**
   * S3-nyckeln som API:t lagrar. Tom sträng = ingen bild (bild är frivilligt
   * för alla rätter; null i en PUT tar bort bilden).
   */
  imageKey: string
  /**
   * Visningsbar bild-URL: CDN-adress byggd från imageKey när
   * VITE_MENU_IMAGE_BASE_URL är satt, annars null (platshållare visas).
   */
  image: string | null
  /** Bildens fokuspunkt (imageFocus.ts); null = mitten. */
  imageFocus: ImageFocus | null
  /** Schema i UTC ("...Z"), null = ingen gräns (schedule.ts). */
  availableFrom: string | null
  availableUntil: string | null
  /** Bongens station (Inställningar > Skrivare), "none" = ingen bong, null/saknas = kategorins. */
  station?: string | null
  /** En meny/combo: delarna får var sin bong; en del utan station följer rätten. */
  components?: DishComponent[]
  /** EU-allergener som rätten innehåller. */
  allergens?: Allergen[]
  /** Tillval gästen väljer vid beställning (Storlek, Extra ...). */
  options?: OptionGroup[]
  /** Senast sparad (API:ts updatedAt); skickas med vid ändring så att en äldre flik inte skriver över. */
  updatedAt?: string
}

export interface DishComponent {
  name: string
  station?: string | null
}

