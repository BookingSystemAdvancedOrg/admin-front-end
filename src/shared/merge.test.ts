import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { errorText } from './errors'
import { ConflictError, changedFields, isConflict, mergeDeep, mergeEdits, saveWithMerge, serverChanges } from './merge'
import { mergeCategoryRows } from '../features/meny/menuForm'

const dish = { name: 'Torsk', price: 189, description: 'Brynt smör', version: 3 }

describe('mergeEdits', () => {
  it('keeps your changed fields and takes theirs for the rest', () => {
    const mine = { ...dish, price: 199 }
    const theirs = { ...dish, description: 'Brynt smör och pepparrot', version: 4 }
    expect(mergeEdits(dish, mine, theirs)).toEqual({
      merged: { name: 'Torsk', price: 199, description: 'Brynt smör och pepparrot', version: 4 },
      conflicts: [],
    })
  })

  it('the same field changed on both sides to different values is a conflict; yours stays', () => {
    const { merged, conflicts } = mergeEdits(dish, { ...dish, price: 199 }, { ...dish, price: 129, version: 4 })
    expect(conflicts).toEqual([{ field: 'price', mine: 199, theirs: 129 }])
    expect(merged.price).toBe(199)
    expect(merged.version).toBe(4)
  })

  it('both sides making the same change is not a conflict', () => {
    expect(mergeEdits(dish, { ...dish, price: 129 }, { ...dish, price: 129 }).conflicts).toEqual([])
  })

  it('compares lists and objects by value', () => {
    const base = { tags: ['a'] }
    expect(mergeEdits(base, { tags: ['a'] }, { tags: ['b'] }).merged).toEqual({ tags: ['b'] })
    expect(changedFields(base, { tags: ['a'] })).toEqual({})
    expect(serverChanges(base, { tags: ['b'] }, ['tags'])).toEqual({ tags: ['b'] })
  })
})

describe('isConflict', () => {
  it('is the 409s that mean someone saved in between, not every 409', () => {
    for (const code of ['changed_retry', 'conflict', 'stale_item', 'stale_categories']) {
      expect(isConflict(new ApiError(409, 'x', { code }))).toBe(true)
    }
    expect(isConflict(new ApiError(409, 'Bordet är upptaget.', { code: 'table_taken' }))).toBe(false)
    expect(isConflict(new ApiError(400, 'x', { code: 'changed_retry' }))).toBe(false)
    expect(isConflict(new Error('changed_retry'))).toBe(false)
  })
})

describe('saveWithMerge', () => {
  const stale = new ApiError(409, 'changed_retry', { code: 'changed_retry', fromServer: true })

  it('saves once when nothing clashes', async () => {
    const save = vi.fn().mockResolvedValue('ok')
    const fetchLatest = vi.fn()
    await expect(saveWithMerge({ base: dish, mine: { ...dish, price: 199 }, save, fetchLatest })).resolves.toBe('ok')
    expect(save).toHaveBeenCalledTimes(1)
    expect(fetchLatest).not.toHaveBeenCalled()
  })

  it('on a 409 it fetches the latest, lays your changed fields on top and retries once', async () => {
    const latest = { ...dish, description: 'Ny text', version: 4 }
    const save = vi.fn().mockRejectedValueOnce(stale).mockResolvedValueOnce('saved')
    const fetchLatest = vi.fn().mockResolvedValue(latest)
    await expect(saveWithMerge({ base: dish, mine: { ...dish, price: 199 }, save, fetchLatest })).resolves.toBe('saved')
    expect(save).toHaveBeenCalledTimes(2)
    // Andra gången: bara ditt ändrade fält, ovanpå den senaste versionen.
    expect(save.mock.calls[1]).toEqual([{ price: 199 }, latest])
  })

  it('stops with the other value when the same field changed on both sides', async () => {
    const latest = { ...dish, price: 129, version: 4 }
    const save = vi.fn().mockRejectedValueOnce(stale)
    const err = await saveWithMerge({ base: dish, mine: { ...dish, price: 199 }, save, fetchLatest: async () => latest }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).conflicts).toEqual([{ field: 'price', mine: 199, theirs: 129 }])
    expect((err as ConflictError).latest).toBe(latest)
    expect(save).toHaveBeenCalledTimes(1)
    // Lugn text, ingen "ladda om".
    expect(errorText(err)).not.toMatch(/ladda om/i)
  })

  it('retries only once and passes other errors through', async () => {
    const save = vi.fn().mockRejectedValue(stale)
    await expect(saveWithMerge({ base: dish, mine: { ...dish, price: 199 }, save, fetchLatest: async () => dish })).rejects.toBe(stale)
    expect(save).toHaveBeenCalledTimes(2)
    const other = new ApiError(400, 'invalid_value', { code: 'invalid_value' })
    const once = vi.fn().mockRejectedValue(other)
    await expect(saveWithMerge({ base: dish, mine: dish, save: once, fetchLatest: vi.fn() })).rejects.toBe(other)
    expect(once).toHaveBeenCalledTimes(1)
  })
})

describe('mergeDeep (whole documents)', () => {
  const site = { pages: [{ blocks: [{ heading: 'Hej', text: 'A' }, { heading: 'Meny', text: 'B' }] }], theme: { color: 'wine' } }

  it('merges edits in different blocks', () => {
    const mine = structuredClone(site)
    mine.pages[0].blocks[0].heading = 'Välkommen'
    const theirs = structuredClone(site)
    theirs.pages[0].blocks[1].text = 'Ny meny'
    theirs.theme.color = 'oak'
    const { merged, conflicts } = mergeDeep(site, mine, theirs)
    expect(conflicts).toEqual([])
    expect(merged.pages[0].blocks[0].heading).toBe('Välkommen')
    expect(merged.pages[0].blocks[1].text).toBe('Ny meny')
    expect(merged.theme.color).toBe('oak')
  })

  it('names the path that changed on both sides and keeps yours there', () => {
    const mine = structuredClone(site)
    mine.pages[0].blocks[0].heading = 'Välkommen'
    const theirs = structuredClone(site)
    theirs.pages[0].blocks[0].heading = 'Hej och välkommen'
    const { merged, conflicts } = mergeDeep(site, mine, theirs)
    expect(conflicts).toEqual(['pages.0.blocks.0.heading'])
    expect(merged.pages[0].blocks[0].heading).toBe('Välkommen')
  })

  describe('lists with ids (pages, blocks)', () => {
    const doc = {
      pages: [{ id: 'start', title: 'Bistro', blocks: [{ id: 'hero', heading: 'Hej' }, { id: 'text', body: 'A' }, { id: 'meny', heading: 'Meny' }] }],
    }

    it('a block a colleague added stays when you edit another block', () => {
      const mine = structuredClone(doc)
      mine.pages[0].blocks[0].heading = 'Välkommen'
      const theirs = structuredClone(doc)
      theirs.pages[0].blocks.splice(1, 0, { id: 'bild', heading: 'Bild' })
      const { merged, conflicts } = mergeDeep(doc, mine, theirs)
      expect(conflicts).toEqual([])
      expect(merged.pages[0].blocks.map((b) => b.id)).toEqual(['hero', 'bild', 'text', 'meny'])
      expect(merged.pages[0].blocks[0].heading).toBe('Välkommen')
    })

    it('keeps additions and deletions from both sides', () => {
      const mine = structuredClone(doc)
      mine.pages[0].blocks = mine.pages[0].blocks.filter((b) => b.id !== 'text')
      mine.pages[0].blocks.push({ id: 'kontakt', heading: 'Kontakt' })
      const theirs = structuredClone(doc)
      theirs.pages[0].blocks = theirs.pages[0].blocks.filter((b) => b.id !== 'meny')
      theirs.pages[0].blocks.unshift({ id: 'oppet', heading: 'Öppet' })
      const { merged, conflicts } = mergeDeep(doc, mine, theirs)
      expect(conflicts).toEqual([])
      expect(merged.pages[0].blocks.map((b) => b.id)).toEqual(['oppet', 'hero', 'kontakt'])
    })

    it('your move wins the order and their new block still lands', () => {
      const mine = structuredClone(doc)
      mine.pages[0].blocks.reverse()
      const theirs = structuredClone(doc)
      theirs.pages[0].blocks.push({ id: 'kontakt', heading: 'Kontakt' })
      expect(mergeDeep(doc, mine, theirs).merged.pages[0].blocks.map((b) => b.id)).toEqual(['meny', 'kontakt', 'text', 'hero'])
    })

    it('their move is kept when you only edited', () => {
      const mine = structuredClone(doc)
      mine.pages[0].blocks[1].body = 'B'
      const theirs = structuredClone(doc)
      theirs.pages[0].blocks.reverse()
      const { merged, conflicts } = mergeDeep(doc, mine, theirs)
      expect(conflicts).toEqual([])
      expect(merged.pages[0].blocks.map((b) => b.id)).toEqual(['meny', 'text', 'hero'])
      expect(merged.pages[0].blocks[1].body).toBe('B')
    })

    it('only the same block changed on both sides is a conflict, at its place in the result', () => {
      const mine = structuredClone(doc)
      mine.pages[0].blocks[2].heading = 'Vår meny'
      const theirs = structuredClone(doc)
      theirs.pages[0].blocks.unshift({ id: 'bild', heading: 'Bild' })
      theirs.pages[0].blocks[3].heading = 'Menyn'
      const { merged, conflicts } = mergeDeep(doc, mine, theirs)
      expect(conflicts).toEqual(['pages.0.blocks.3.heading'])
      expect(merged.pages[0].blocks.map((b) => b.id)).toEqual(['bild', 'hero', 'text', 'meny'])
      expect(merged.pages[0].blocks[3].heading).toBe('Vår meny')
    })

    it('a block you edited that they removed is a conflict and stays', () => {
      const mine = structuredClone(doc)
      mine.pages[0].blocks[1].body = 'B'
      const theirs = structuredClone(doc)
      theirs.pages[0].blocks.splice(1, 1)
      const { merged, conflicts } = mergeDeep(doc, mine, theirs)
      expect(conflicts).toEqual(['pages.0.blocks.1'])
      expect(merged.pages[0].blocks.map((b) => b.id)).toEqual(['hero', 'text', 'meny'])
    })
  })
})

describe('mergeCategoryRows', () => {
  const base = [{ categoryId: 'a', name: 'Förrätter' }, { categoryId: 'b', name: 'Varmrätter' }, { categoryId: 'c', name: 'Dryck' }]

  it('keeps your rename, their rename of another one, their new one and your new one', () => {
    const mine = [{ categoryId: 'a', name: 'Smårätter' }, base[1], base[2], { name: 'Pizzor' }]
    const theirs = [...base.slice(0, 2), { categoryId: 'c', name: 'Drycker' }, { categoryId: 'd', name: 'Efterrätter' }]
    expect(mergeCategoryRows(base, mine, theirs)).toEqual({
      rows: [
        { categoryId: 'a', name: 'Smårätter' }, { categoryId: 'b', name: 'Varmrätter' }, { categoryId: 'c', name: 'Drycker' },
        { categoryId: 'd', name: 'Efterrätter' }, { name: 'Pizzor' },
      ],
      conflicts: [],
    })
  })

  it('your removal and your order win; their removal sticks', () => {
    const mine = [base[2], base[0]] // flyttade Dryck först, tog bort Varmrätter
    const theirs = [base[0], base[1]] // tog bort Dryck
    expect(mergeCategoryRows(base, mine, theirs).rows).toEqual([{ categoryId: 'a', name: 'Förrätter' }])
  })

  it('a name changed on both sides is a conflict with theirs', () => {
    const mine = [{ categoryId: 'a', name: 'Smårätter' }, base[1], base[2]]
    const theirs = [{ categoryId: 'a', name: 'Tapas' }, base[1], base[2]]
    const { rows, conflicts } = mergeCategoryRows(base, mine, theirs)
    expect(conflicts).toEqual([{ categoryId: 'a', theirs: 'Tapas' }])
    expect(rows[0]).toEqual({ categoryId: 'a', name: 'Smårätter' })
  })
})
