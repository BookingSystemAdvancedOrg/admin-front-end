import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import * as api from '../../shared/api'
import type { Dish } from './data'
import {
  MENU_IMAGE_BASE_URL,
  MENU_ROUTES_MISSING_MESSAGE,
  menuImageUrl,
  dishChanges,
  getPublicMenu,
  isMenuRoutesMissing,
  listMenuItems,
  publicToDish,
  toDish,
  updateMenuItem,
  uploadMenuImage,
  validateDishPrice,
  parsePrice,
  isStaleDish,
} from './menuApi'
import type { MenuItem, MenuItemCreate } from './menuApi'

vi.mock('../../shared/api', async () => {
  const actual =
    await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockedApiFetch = vi.mocked(api.apiFetch)

function menuItem(over: Partial<MenuItem> = {}): MenuItem {
  return {
    menuItemId: 'm1',
    name: 'Toast Skagen',
    description: 'Klassikern',
    price: 145,
    category: 'starters',
    imageKey: 'locations/loc-1/menu/img-1.webp',
    active: true,
    createdBy: 'sub-1',
    createdAt: '2026-09-01T10:00:00Z',
    updatedBy: 'sub-1',
    updatedAt: '2026-09-01T10:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  mockedApiFetch.mockReset()
})


describe('toDish', () => {
  it('reads the focal point, with the centre and junk as null', () => {
    expect(toDish({ ...menuItem(), imageFocus: { x: 10, y: 90 } }).imageFocus).toEqual({ x: 10, y: 90 })
    expect(toDish({ ...menuItem(), imageFocus: { x: 50, y: 50 } }).imageFocus).toBeNull()
    expect(toDish(menuItem()).imageFocus).toBeNull()
    expect(toDish({ ...menuItem(), imageFocus: { x: 400, y: -3 } }).imageFocus).toEqual({ x: 100, y: 0 })
  })

  it('maps an API item to the UI shape', () => {
    const dish = toDish(menuItem())
    expect(dish).toMatchObject({
      id: 'm1',
      name: 'Toast Skagen',
      description: 'Klassikern',
      category: 'starters',
      price: 145,
      active: true,
      imageKey: 'locations/loc-1/menu/img-1.webp',
    })
    // Bild-URL:en beror på VITE_MENU_IMAGE_BASE_URL (satt i .env lokalt,
    // inte i CI): finns basen är den <bas>/<imageKey>, annars null.
    expect(dish.image).toBe(
      MENU_IMAGE_BASE_URL
        ? `${MENU_IMAGE_BASE_URL}/locations/loc-1/menu/img-1.webp`
        : null,
    )
  })

  it('builds the CDN URL as base + "/" + imageKey, never doubling slashes', () => {
    expect(menuImageUrl('')).toBeNull()
    if (MENU_IMAGE_BASE_URL) {
      expect(MENU_IMAGE_BASE_URL.endsWith('/')).toBe(false)
      expect(menuImageUrl('menu-images/locations/x/menu/y.png')).toBe(
        `${MENU_IMAGE_BASE_URL}/menu-images/locations/x/menu/y.png`,
      )
    } else {
      expect(menuImageUrl('menu-images/locations/x/menu/y.png')).toBeNull()
    }
  })

  it('treats every public-menu item as active', () => {
    const dish = publicToDish({
      menuItemId: 'm2',
      name: 'Saft',
      description: '',
      price: 25,
      category: 'drinks',
      imageKey: 'k',
    })
    expect(dish.active).toBe(true)
    expect(dish.category).toBe('drinks')
  })

  it('respects an explicit active flag when the menu route returns one', () => {
    const dish = publicToDish({
      menuItemId: 'm3',
      name: 'Paj',
      description: '',
      price: 95,
      category: 'mains',
      imageKey: 'k',
      active: false,
    })
    expect(dish.active).toBe(false)
  })
})

describe('validateDishPrice', () => {
  it('accepts zero, integers, and two decimals', () => {
    expect(validateDishPrice(0)).toBeNull()
    expect(validateDishPrice(195)).toBeNull()
    expect(validateDishPrice(129.5)).toBeNull()
    expect(validateDishPrice(129.55)).toBeNull()
  })

  it('caps a price at 10 000 kr (typo guard, same as the server)', () => {
    expect(validateDishPrice(10000)).toBeNull()
    expect(validateDishPrice(10000.01)).toBe('Pris får vara högst 10\u00a0000 kr.')
    expect(validateDishPrice(3500000)).not.toBeNull()
  })

  it('rejects negatives and more than two decimals', () => {
    expect(validateDishPrice(-1)).not.toBeNull()
    expect(validateDishPrice(129.555)).not.toBeNull()
    expect(validateDishPrice(Number.NaN)).not.toBeNull()
  })
})

describe('dishChanges', () => {
  const original: Dish = toDish(menuItem())

  function desired(over: Partial<MenuItemCreate> = {}): MenuItemCreate {
    return {
      name: original.name,
      description: original.description,
      price: original.price,
      category: original.category,
      imageKey: original.imageKey,
      active: original.active,
      ...over,
    }
  }

  it('sends the ticket station and combo parts only when they change, and clears them', () => {
    const combo: Dish = { ...original, station: 'kok', components: [{ name: 'Burgare' }, { name: 'Läsk', station: 'bar' }] }
    const same = desired({ station: 'kok', components: [{ name: 'Burgare' }, { name: 'Läsk', station: 'bar' }] })
    expect(dishChanges(combo, same)).toEqual({})
    expect(dishChanges(combo, { ...same, station: 'none' })).toEqual({ station: 'none' })
    expect(dishChanges(combo, { ...same, components: [] })).toEqual({ components: null })
    expect(toDish(menuItem()).station).toBeNull()
  })

  it('sends a changed or cleared schedule and skips an unchanged one', () => {
    const scheduled: Dish = { ...original, availableFrom: '2026-11-01T10:00:00Z', availableUntil: null }
    const keep = { ...desired(), availableFrom: '2026-11-01T10:00:00Z', availableUntil: null }
    expect(dishChanges(scheduled, keep)).toEqual({})
    expect(dishChanges(scheduled, { ...keep, availableFrom: null })).toEqual({ availableFrom: null })
    expect(dishChanges(scheduled, { ...keep, availableUntil: '2026-11-02T10:00:00Z' })).toEqual({
      availableUntil: '2026-11-02T10:00:00Z',
    })
  })

  it('sends a moved focal point, clears it on the centre and skips an unchanged one', () => {
    expect(dishChanges(original, desired({ imageFocus: { x: 50, y: 50 } }))).toEqual({})
    expect(dishChanges(original, desired({ imageFocus: { x: 20, y: 80 } }))).toEqual({ imageFocus: { x: 20, y: 80 } })
    const focused: Dish = { ...original, imageFocus: { x: 20, y: 80 } }
    expect(dishChanges(focused, desired({ imageFocus: { x: 20, y: 80 } }))).toEqual({})
    expect(dishChanges(focused, desired({ imageFocus: { x: 50, y: 50 } }))).toEqual({ imageFocus: null })
  })

  it('returns an empty diff when nothing changed', () => {
    expect(dishChanges(original, desired())).toEqual({})
  })

  it('includes only the changed fields', () => {
    expect(dishChanges(original, desired({ price: 155, active: false }))).toEqual(
      { price: 155, active: false },
    )
  })

  it('sends the alcohol flag when it changes', () => {
    expect(original.alcohol).toBe(false)
    expect(dishChanges(original, desired({ alcohol: true }))).toEqual({ alcohol: true })
    expect(dishChanges(original, desired({ alcohol: false }))).toEqual({})
  })

  it('never sends an empty imageKey - the API cannot clear it', () => {
    expect(dishChanges(original, desired({ imageKey: '' }))).toEqual({})
  })
})

describe('error mapping', () => {
  it('recognises a gateway-level 404 as routes not deployed', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(404, 'Not Found'))
    const err = await listMenuItems('loc-1').catch((e) => e)
    expect(err.message).toBe(MENU_ROUTES_MISSING_MESSAGE)
    expect(isMenuRoutesMissing(err)).toBe(true)
  })

  it('maps a Lambda 404 to a missing-item message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(404, 'menu item not found'))
    const err = await updateMenuItem('loc-1', 'm1', { price: 1 }).catch((e) => e)
    expect(err.message).toMatch(/finns inte längre/)
    expect(isMenuRoutesMissing(err)).toBe(false)
  })
})

describe('getPublicMenu', () => {
  it('unwraps the items list', async () => {
    mockedApiFetch.mockResolvedValue({
      items: [
        {
          menuItemId: 'm1',
          name: 'Mushroom Toast',
          description: '',
          price: 125.5,
          category: 'starters',
          imageKey: 'k',
        },
      ],
    })
    const items = await getPublicMenu('loc-1')
    expect(items).toHaveLength(1)
    expect(mockedApiFetch).toHaveBeenCalledWith('/locations/loc-1/menu')
  })
})

describe('uploadMenuImage', () => {
  it('rejects unsupported file types before any API call', async () => {
    const file = new File(['x'], 'bild.gif', { type: 'image/gif' })
    await expect(uploadMenuImage('loc-1', file)).rejects.toThrow(/AVIF/)
    expect(mockedApiFetch).not.toHaveBeenCalled()
  })

  it('PUTs the file to the presigned URL and returns the imageKey', async () => {
    mockedApiFetch.mockResolvedValue({
      uploadUrl: 'https://s3.example/upload',
      imageKey: 'locations/loc-1/menu/new.webp',
      expiresIn: 300,
      requiredHeaders: { 'Content-Type': 'image/webp' },
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))

    const file = new File(['x'], 'bild.webp', { type: 'image/webp' })
    await expect(uploadMenuImage('loc-1', file)).resolves.toBe(
      'locations/loc-1/menu/new.webp',
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://s3.example/upload',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
      }),
    )
    fetchSpy.mockRestore()
  })
})

describe('parsePrice', () => {
  it('accepts whole kronor, comma and point decimals and spaces', () => {
    expect(parsePrice('89')).toEqual({ value: 89, error: null })
    expect(parsePrice('89,50')).toEqual({ value: 89.5, error: null })
    expect(parsePrice('89.5')).toEqual({ value: 89.5, error: null })
    expect(parsePrice(' 1 250 kr')).toEqual({ value: 1250, error: null })
    expect(parsePrice('0')).toEqual({ value: 0, error: null })
  })

  it('refuses text, negative numbers, empty and three decimals in Swedish', () => {
    expect(parsePrice('abc').error).toMatch(/siffror/)
    expect(parsePrice('-10').error).toBe('Priset kan inte vara negativt.')
    expect(parsePrice('').error).toBe('Pris krävs.')
    expect(parsePrice('12,345').error).toBe('Pris får ha högst två decimaler.')
    expect(parsePrice('1,2,3').error).toMatch(/siffror/)
    expect(parsePrice('10e3').error).toMatch(/siffror/)
    expect(parsePrice('10001').error).toMatch(/högst/)
  })
})

describe('allergens, options and photo in dishChanges', () => {
  const original: Dish = toDish(menuItem({ allergens: ['milk'], options: [] }))
  const base: MenuItemCreate = {
    name: original.name, description: original.description, price: original.price,
    category: original.category, imageKey: original.imageKey, active: original.active,
  }

  it('sends allergens and options only when changed, empty clears', () => {
    expect(dishChanges(original, { ...base, allergens: ['milk'] })).toEqual({})
    expect(dishChanges(original, { ...base, allergens: [] })).toEqual({ allergens: null })
    const groups = [{ name: 'Storlek', required: true, maxChoices: 1, choices: [{ name: 'Stor', price: 30 }] }]
    expect(dishChanges(original, { ...base, options: groups })).toEqual({ options: groups })
  })

  it('removes the photo with null, never sends an empty key', () => {
    expect(dishChanges(original, { ...base, imageKey: null })).toEqual({ imageKey: null })
    const noPhoto = toDish(menuItem({ imageKey: null }))
    expect(noPhoto.imageKey).toBe('')
    expect(noPhoto.image).toBeNull()
    expect(dishChanges(noPhoto, { ...base, imageKey: null })).toEqual({})
  })
})

describe('stale saves', () => {
  it('sends expectedUpdatedAt and says in Swedish that someone else changed the dish', async () => {
    mockedApiFetch.mockRejectedValueOnce(new ApiError(409, 'menu item was changed by someone else', { code: 'stale_item' }))
    const err = await updateMenuItem('loc-1', 'm1', { price: 99 }, '2026-09-01T10:00:00Z').catch((e: unknown) => e)
    expect(mockedApiFetch).toHaveBeenCalledWith('/locations/loc-1/menu/items/m1', {
      method: 'PUT', body: JSON.stringify({ price: 99, expectedUpdatedAt: '2026-09-01T10:00:00Z' }),
    })
    expect(isStaleDish(err)).toBe(true)
    expect((err as Error).message).toMatch(/Någon annan har ändrat rätten/)
  })
})
