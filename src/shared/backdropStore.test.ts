import { afterEach, describe, expect, it } from 'vitest'
import { applyGlassBackdrop, forgetBackdropImage, readGlassBackdrop } from './glassBackdrop'
import { deleteBackdrop, getLibrary, loadLibrary, selectBackdrop, uploadBackdrop } from './backdropStore'

afterEach(() => {
  localStorage.clear()
  forgetBackdropImage()
  applyGlassBackdrop({ mode: 'clear' })
})

describe('bildbiblioteket', () => {
  it('börjar tomt och flyttar ingen till Egen bild', async () => {
    const lib = await loadLibrary()
    expect(lib.loaded).toBe(true)
    expect(readGlassBackdrop()).toEqual({ mode: 'clear' })
  })

  it('vägrar filer som inte är bilder', async () => {
    expect(await uploadBackdrop(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe('not-image')
  })

  it('vägrar när biblioteket är fullt', async () => {
    const lib = getLibrary()
    lib.items.length = 0
    for (let i = 0; i < lib.max; i++) lib.items.push({ id: `f${i}`, url: 'u', thumbUrl: 't', uploadedAt: '2026-01-01', width: 1, height: 1 })
    expect(await uploadBackdrop(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe('limit')
    lib.items.length = 0
  })

  it('att ta bort den valda bilden går tillbaka till genomskinligt', async () => {
    await selectBackdrop('x1')
    expect(getLibrary().selectedId).toBe('x1')
    await deleteBackdrop('x1')
    expect(getLibrary().selectedId).toBeNull()
    expect(readGlassBackdrop()).toEqual({ mode: 'clear' })
  })
})
