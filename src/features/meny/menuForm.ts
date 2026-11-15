import type { OptionGroup } from './data'
import { parsePrice } from './menuApi'

/* Formulärlogik för tillval och kategorier (OptionsEditor, CategoriesModal). */

/** En grupp under redigering: priserna är text tills de sparas. */
export interface DraftGroup {
  name: string
  required: boolean
  maxChoices: number
  choices: { name: string; price: string }[]
}

export const MAX_GROUPS = 10
export const MAX_CHOICES = 20
export const NAME_MAX = 40

export function toDraft(groups: OptionGroup[] | undefined): DraftGroup[] {
  return (groups ?? []).map((g) => ({
    name: g.name,
    required: g.required,
    maxChoices: g.maxChoices,
    choices: g.choices.map((c) => ({ name: c.name, price: c.price ? String(c.price).replace('.', ',') : '' })),
  }))
}

/**
 * Utkasten -> det som sparas, eller första felet på svenska. Ett tomt pris
 * betyder gratis (0 kr). Samma regler som servern (shared/menu.py): namn
 * 1-40 tecken och unika, minst ett val per grupp, max antal val högst
 * antalet val.
 */
export function draftToGroups(drafts: DraftGroup[]): { groups: OptionGroup[]; error: null } | { groups: null; error: string } {
  const groups: OptionGroup[] = []
  const names = new Set<string>()
  for (const [i, d] of drafts.entries()) {
    const name = d.name.trim()
    const label = name || `grupp ${i + 1}`
    if (!name) return { groups: null, error: `Ge tillvalsgrupp ${i + 1} ett namn, till exempel Storlek.` }
    if (name.length > NAME_MAX) return { groups: null, error: `Namnet på ${label} får vara högst ${NAME_MAX} tecken.` }
    if (names.has(name.toLowerCase())) return { groups: null, error: `Två tillvalsgrupper heter ${name}.` }
    names.add(name.toLowerCase())
    if (!d.choices.length) return { groups: null, error: `Lägg till minst ett val i ${label}.` }
    const choiceNames = new Set<string>()
    const choices = []
    for (const [j, c] of d.choices.entries()) {
      const cname = c.name.trim()
      if (!cname) return { groups: null, error: `Val ${j + 1} i ${label} saknar namn.` }
      if (cname.length > NAME_MAX) return { groups: null, error: `${cname} får vara högst ${NAME_MAX} tecken.` }
      if (choiceNames.has(cname.toLowerCase())) return { groups: null, error: `${label} har två val som heter ${cname}.` }
      choiceNames.add(cname.toLowerCase())
      const price = parseAddonPrice(c.price)
      if (price.error !== null) return { groups: null, error: `${label}, ${cname}: ${price.error}` }
      choices.push({ name: cname, price: price.value })
    }
    groups.push({ name, required: d.required, maxChoices: Math.min(Math.max(1, d.maxChoices), choices.length), choices })
  }
  return { groups, error: null }
}

/**
 * Tillvalets pristillägg: tomt är gratis och ett inledande "+" ("+10",
 * "+ 10 kr") godtas, eftersom det är så tillägg brukar skrivas. Annars
 * samma regler som rättens pris (parsePrice).
 */
export function parseAddonPrice(text: string): ReturnType<typeof parsePrice> {
  if (text.trim() === '') return { value: 0, error: null }
  return parsePrice(text.trim().replace(/^\+/, ''))
}

export interface CategoryRow {
  categoryId?: string
  name: string
}

export const MAX_CATEGORIES = 30

/** Första felet i listan, på svenska, eller null. Samma regler som servern. */
export function categoryListError(rows: CategoryRow[]): string | null {
  if (!rows.length) return 'Menyn behöver minst en kategori.'
  const seen = new Set<string>()
  for (const [i, r] of rows.entries()) {
    const name = r.name.trim()
    if (!name) return `Kategori ${i + 1} saknar namn.`
    if (name.length > NAME_MAX) return `${name} får vara högst ${NAME_MAX} tecken.`
    if (seen.has(name.toLowerCase())) return `Två kategorier heter ${name}.`
    seen.add(name.toLowerCase())
  }
  return null
}


/**
 * Kategorilistan sparades på annat håll medan dialogen var öppen (409
 * stale_categories): lägg dina ändringar ovanpå den senaste listan.
 * - Namn du bytt behålls; byttes samma kategori till ett annat namn där
 *   också blir det en konflikt (ditt namn står kvar, deras visas under).
 * - Kategorier du tog bort tas bort; de som togs bort där försvinner.
 * - Nya kategorier från båda hållen kommer med (dina sist).
 * - Flyttade du om gäller din ordning, annars deras.
 */
export function mergeCategoryRows(
  base: readonly CategoryRow[],
  mine: readonly CategoryRow[],
  theirs: readonly CategoryRow[],
): { rows: CategoryRow[]; conflicts: { categoryId: string; theirs: string }[] } {
  const baseById = new Map(base.filter((r) => r.categoryId).map((r) => [r.categoryId as string, r]))
  const theirsById = new Map(theirs.filter((r) => r.categoryId).map((r) => [r.categoryId as string, r]))
  const mineIds = new Set(mine.filter((r) => r.categoryId).map((r) => r.categoryId as string))
  const conflicts: { categoryId: string; theirs: string }[] = []

  const named = (id: string): CategoryRow | null => {
    const t = theirsById.get(id)
    if (!t) return null // borttagen där
    const b = baseById.get(id)
    const m = mine.find((r) => r.categoryId === id)
    if (!m || !b || m.name.trim() === b.name.trim()) return { categoryId: id, name: t.name }
    if (t.name.trim() !== b.name.trim() && t.name.trim() !== m.name.trim()) conflicts.push({ categoryId: id, theirs: t.name })
    return { categoryId: id, name: m.name }
  }

  const baseOrder = base.filter((r) => r.categoryId && mineIds.has(r.categoryId)).map((r) => r.categoryId)
  const myOrder = mine.filter((r) => r.categoryId && baseById.has(r.categoryId)).map((r) => r.categoryId)
  const reordered = baseOrder.join('|') !== myOrder.join('|')
  const removedByMe = (id: string) => baseById.has(id) && !mineIds.has(id)

  const rows: CategoryRow[] = []
  if (reordered) {
    for (const r of mine) if (r.categoryId) { const row = named(r.categoryId); if (row) rows.push(row) }
    for (const t of theirs) if (t.categoryId && !baseById.has(t.categoryId)) rows.push({ ...t })
  } else {
    for (const t of theirs) {
      const id = t.categoryId as string
      if (removedByMe(id)) continue
      const row = baseById.has(id) ? named(id) : { ...t }
      if (row) rows.push(row)
    }
  }
  for (const r of mine) if (!r.categoryId) rows.push({ name: r.name })
  return { rows, conflicts }
}
