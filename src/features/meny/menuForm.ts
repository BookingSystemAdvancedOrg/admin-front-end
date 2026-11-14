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
      const price = c.price.trim() === '' ? { value: 0, error: null } : parsePrice(c.price)
      if (price.error !== null) return { groups: null, error: `${label}, ${cname}: ${price.error}` }
      choices.push({ name: cname, price: price.value })
    }
    groups.push({ name, required: d.required, maxChoices: Math.min(Math.max(1, d.maxChoices), choices.length), choices })
  }
  return { groups, error: null }
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

