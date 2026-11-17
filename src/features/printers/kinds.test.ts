import { describe, expect, it } from 'vitest'
import { drinkDefaults, soundsLikeDrinks } from './kinds'

describe('soundsLikeDrinks', () => {
  it('finds drink categories', () => {
    for (const name of ['Öl', 'Fatöl', 'Lättöl', 'Vin', 'Rödvin', 'Viner', 'Bar', 'Te & kaffe', 'Shots', 'Drycker', 'Cocktails']) {
      expect(soundsLikeDrinks(name), name).toBe(true)
    }
  })

  it('leaves food alone', () => {
    for (const name of ['Pölsa', 'Mjölkfritt', 'Salladsbar', 'Barnmeny', 'Vinäger', 'Varmrätter', 'Förrätter', 'Tex-mex']) {
      expect(soundsLikeDrinks(name), name).toBe(false)
    }
  })
})

describe('drinkDefaults', () => {
  it('sends unchosen drink categories to Dryck, never the chosen ones', () => {
    const routing = { categories: { mains: 'kok', vin: 'none' } }
    const categories = [
      { categoryId: 'mains', name: 'Varmrätt' },
      { categoryId: 'drinks', name: 'Dryck' },
      { categoryId: 'ol', name: 'Öl' },
      { categoryId: 'vin', name: 'Vin' },
      { categoryId: 'salladsbar', name: 'Salladsbar' },
    ]
    expect(drinkDefaults(routing, categories)).toEqual({ ol: 'bar' })
    expect(drinkDefaults(null, categories)).toEqual({})
  })
})
