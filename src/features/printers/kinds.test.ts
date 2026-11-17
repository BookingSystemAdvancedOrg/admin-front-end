import { describe, expect, it } from 'vitest'
import { categoryStation, dishStation, drinkDefaults, soundsLikeDrinks } from './kinds'
// Samma ordlista som serverns test (application tests/fixtures/drink_names.json).
import words from './drinkNames.json'

describe('soundsLikeDrinks', () => {
  it('finds drink categories', () => {
    for (const name of words.drinks) {
      expect(soundsLikeDrinks(name), name).toBe(true)
    }
  })

  it('leaves food alone', () => {
    for (const name of words.food) {
      expect(soundsLikeDrinks(name), name).toBe(false)
    }
    expect(soundsLikeDrinks(undefined)).toBe(false)
  })
})

describe('categoryStation and dishStation (as the server)', () => {
  const routing = {
    stations: [
      { stationId: 'kok', name: 'Kök', printerIds: [] },
      { stationId: 'bar', name: 'Dryck', printerIds: [] },
    ],
    categories: { mains: 'kok', drinks: 'bar', chosen: 'kok' } as Record<string, string>,
  }

  it('sends an unchosen category that sounds like drinks to Dryck', () => {
    expect(categoryStation(routing, 'c0a1b2c3d4', 'Öl')).toBe('bar')
    expect(categoryStation(routing, 'c0a1b2c3d4', 'Salladsbar')).toBe('kok')
    expect(categoryStation(routing, 'c0a1b2c3d4')).toBe('kok')
    expect(categoryStation(routing, 'chosen', 'Vin')).toBe('kok')
    expect(dishStation(routing, null, 'c0a1b2c3d4', false, 'Vinlista')).toBe('bar')
    expect(dishStation(routing, 'kok', 'c0a1b2c3d4', false, 'Vinlista')).toBe('kok')
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
