import { describe, expect, it } from 'vitest'
import { categoryListError, draftToGroups, toDraft } from './menuForm'

describe('draftToGroups', () => {
  it('turns drafts into option groups; empty price is free', () => {
    const res = draftToGroups([
      { name: ' Storlek ', required: true, maxChoices: 1, choices: [{ name: 'Normal', price: '' }, { name: 'Stor', price: '30,50' }] },
    ])
    expect(res).toEqual({
      groups: [{ name: 'Storlek', required: true, maxChoices: 1, choices: [{ name: 'Normal', price: 0 }, { name: 'Stor', price: 30.5 }] }],
      error: null,
    })
  })

  it('refuses bad prices, missing names and duplicates in Swedish', () => {
    expect(draftToGroups([{ name: 'Extra', required: false, maxChoices: 1, choices: [{ name: 'Ost', price: 'abc' }] }]).error)
      .toMatch(/Extra, Ost: Skriv priset med siffror/)
    expect(draftToGroups([{ name: 'Extra', required: false, maxChoices: 1, choices: [{ name: 'Ost', price: '-5' }] }]).error)
      .toMatch(/negativt/)
    expect(draftToGroups([{ name: '', required: false, maxChoices: 1, choices: [{ name: 'A', price: '' }] }]).error).toMatch(/namn/)
    expect(draftToGroups([{ name: 'S', required: false, maxChoices: 1, choices: [] }]).error).toMatch(/minst ett val/)
    expect(draftToGroups([
      { name: 'S', required: false, maxChoices: 1, choices: [{ name: 'A', price: '' }] },
      { name: 's', required: false, maxChoices: 1, choices: [{ name: 'A', price: '' }] },
    ]).error).toMatch(/Två tillvalsgrupper/)
  })

  it('round-trips through toDraft and caps maxChoices at the number of choices', () => {
    const groups = [{ name: 'Extra', required: false, maxChoices: 5, choices: [{ name: 'Ost', price: 10.5 }] }]
    expect(toDraft(groups)[0].choices[0].price).toBe('10,5')
    expect(draftToGroups(toDraft(groups)).groups?.[0].maxChoices).toBe(1)
  })
})

describe('categoryListError', () => {
  it('needs at least one named, unique category', () => {
    expect(categoryListError([])).toMatch(/minst en/)
    expect(categoryListError([{ name: ' ' }])).toMatch(/saknar namn/)
    expect(categoryListError([{ name: 'Öl' }, { name: 'öl' }])).toMatch(/Två kategorier/)
    expect(categoryListError([{ categoryId: 'mains', name: 'Pizzor' }, { name: 'Öl' }])).toBeNull()
  })
})
