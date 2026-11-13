import { afterEach, describe, expect, it } from 'vitest'
import {
  applyGlassBackdrop,
  forgetBackdropImage,
  hasBackdropImage,
  installGlassBackdrop,
  parseGlassBackdrop,
  readGlassBackdrop,
  refreshBackdropImage,
  setBackdropImageSource,
  setGlassBackdrop,
} from './glassBackdrop'
import { vi } from 'vitest'
import { GLASS_BACKDROP_KEY } from './storageRegistry'

afterEach(() => {
  localStorage.clear()
  forgetBackdropImage()
  setBackdropImageSource(async () => null)
  applyGlassBackdrop({ mode: 'clear' })
  vi.unstubAllGlobals()
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

  it('Egen bild visar Booqys bakgrund tills bilden är avkodad', () => {
    setGlassBackdrop({ mode: 'image' })
    expect(localStorage.getItem(GLASS_BACKDROP_KEY)).toBe('image')
    expect(document.documentElement.dataset.glassBackdrop).toBe('image-loading')
  })

  it('lägger bilden på <html> när den är hämtad och avkodad', async () => {
    vi.stubGlobal(
      'Image',
      class {
        decoding = ''
        src = ''
        decode() {
          return Promise.resolve()
        }
      },
    )
    setBackdropImageSource(async () => 'https://bilder.example/backdrop?sig=1')
    setGlassBackdrop({ mode: 'image' })
    expect(await refreshBackdropImage()).toBe(true)
    expect(hasBackdropImage()).toBe(true)
    expect(document.documentElement.dataset.glassBackdrop).toBe('image')
    expect(document.documentElement.style.getPropertyValue('--user-image')).toContain('https://bilder.example/backdrop?sig=1')
  })

  it('utan bild på servern stannar sidan på Booqys bakgrund', async () => {
    setBackdropImageSource(async () => null)
    setGlassBackdrop({ mode: 'image' })
    expect(await refreshBackdropImage()).toBe(false)
    expect(document.documentElement.dataset.glassBackdrop).toBe('image-loading')
  })
})
