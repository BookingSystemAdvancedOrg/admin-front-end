/**
 * MOCKDATA — ersätts med backend-anrop när API:t är på plats:
 *   const dishes = await apiFetch<Dish[]>('/menu')
 * (se src/shared/api.ts och docs/BACKEND-KOPPLING.md)
 *
 * Bilder: i mocken är `image` en liten inbäddad SVG (data-URL). Bilder som
 * laddas upp i dialogen blir data-URL:er från användarens fil. När backend
 * kopplas laddas filen i stället upp till S3 och `image` blir en riktig URL.
 */

export type DishCategory = 'forratter' | 'varmratter' | 'efterratter'

export interface Dish {
  id: string
  name: string
  category: DishCategory
  /** Pris i kr. */
  price: number
  active: boolean
  /** Bild-URL (data-URL i mocken). null = ingen bild uppladdad ännu. */
  image: string | null
}

export const CATEGORY_LABEL: Record<DishCategory, string> = {
  forratter: 'Förrätter',
  varmratter: 'Varmrätter',
  efterratter: 'Efterrätter',
}

/** Enkel platshållarbild tills riktiga foton finns i backend. */
function dishImage(bg: string, emoji: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='112' height='88'>` +
    `<rect width='112' height='88' fill='${bg}'/>` +
    `<text x='56' y='58' font-size='40' text-anchor='middle'>${emoji}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export const MOCK_DISHES: Dish[] = [
  { id: 'd1', name: 'Toast Skagen', category: 'forratter', price: 145, active: true, image: dishImage('#e7c8ab', '🍤') },
  { id: 'd2', name: 'Rimmad Lax', category: 'forratter', price: 225, active: true, image: dishImage('#d9b48f', '🐟') },
  { id: 'd3', name: 'Köttbullar med Potatismos', category: 'varmratter', price: 195, active: true, image: dishImage('#c99b6f', '🍽️') },
  { id: 'd4', name: 'Smörstekt Torskrygg', category: 'varmratter', price: 265, active: true, image: dishImage('#b8935f', '🐟') },
  { id: 'd5', name: 'Svensk Västerbottenpaj', category: 'forratter', price: 135, active: false, image: null },
  { id: 'd6', name: 'Chokladfondant', category: 'efterratter', price: 110, active: true, image: dishImage('#8a5a3c', '🍫') },
  { id: 'd7', name: 'Klassisk Crème Brûlée', category: 'efterratter', price: 95, active: true, image: dishImage('#e8d3a0', '🍮') },
]
