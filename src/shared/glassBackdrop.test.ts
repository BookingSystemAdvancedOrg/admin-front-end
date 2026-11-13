import { afterEach, describe, expect, it } from 'vitest'
import { applyGlassBackdrop, installGlassBackdrop, parseGlassBackdrop, readGlassBackdrop, setGlassBackdrop } from './glassBackdrop'
import { GLASS_BACKDROP_KEY } from './storageRegistry'

afterEach(() => {
  localStorage.clear()
  applyGlassBackdrop({ mode: 'clear' })
})

describe('bakgrund bakom glaset', () => {
  it('är genomskinlig när inget är valt', () => {
    expect(readGlassBackdrop()).toEqual({ mode: 'clear' })
    installGlassBackdrop()
    expect(document.documentElement.dataset.glassBackdrop).toBeUndefined()
  })

  it('flyttar aldrig någon till Färg av ett okänt eller gammalt värde', () => {
    for (const v of ['', 'clear', 'colour', 'red', '#fff', '#12345', 'url(x)', 'data:image/png;base64,AA']) {
      expect(parseGlassBackdrop(v)).toEqual({ mode: 'clear' })
    }
    localStorage.setItem('booqy-backdrop', 'data:image/jpeg;base64,AA')
    expect(readGlassBackdrop()).toEqual({ mode: 'clear' })
  })

  it('läser en sparad färg', () => {
    localStorage.setItem(GLASS_BACKDROP_KEY, '#6B1D24')
    expect(readGlassBackdrop()).toEqual({ mode: 'colour', colour: '#6b1d24' })
  })

  it('sparar en färg och lägger den på <html>', () => {
    setGlassBackdrop({ mode: 'colour', colour: '#7f9479' })
    expect(localStorage.getItem(GLASS_BACKDROP_KEY)).toBe('#7f9479')
    expect(document.documentElement.dataset.glassBackdrop).toBe('colour')
    expect(document.documentElement.style.getPropertyValue('--user-colour')).toBe('#7f9479')
  })

  it('tillbaka till genomskinligt tar bort det sparade', () => {
    setGlassBackdrop({ mode: 'colour', colour: '#7f9479' })
    setGlassBackdrop({ mode: 'clear' })
    expect(localStorage.getItem(GLASS_BACKDROP_KEY)).toBeNull()
    expect(document.documentElement.dataset.glassBackdrop).toBeUndefined()
  })
})
