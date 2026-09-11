import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import * as api from '../../shared/api'
import type { Dish } from './data'
import {
  CATEGORY_FROM_API,
  CATEGORY_TO_API,
  MENU_ROUTES_MISSING_MESSAGE,
  dishChanges,
  getPublicMenu,
  isMenuRoutesMissing,
  listMenuItems,
  publicToDish,
  toDish,
  updateMenuItem,
  uploadMenuImage,
  validateDishPrice,
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

describe('category mapping', () => {
  it('round-trips every category between UI and API values', () => {
    for (const [ui, apiValue] of Object.entries(CATEGORY_TO_API)) {
      expect(CATEGORY_FROM_API[apiValue]).toBe(ui)
    }
  })
})

describe('toDish', () => {
  it('maps an API item to the UI shape', () => {
    const dish = toDish(menuItem())
    expect(dish).toMatchObject({
      id: 'm1',
      name: 'Toast Skagen',
      description: 'Klassikern',
      category: 'forratter',
      price: 145,
      active: true,
      imageKey: 'locations/loc-1/menu/img-1.webp',
    })
    // Utan VITE_MENU_IMAGE_BASE_URL kan nyckeln inte bli en visningsbar URL.
    expect(dish.image).toBeNull()
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
    expect(dish.category).toBe('drycker')
  })
})

describe('validateDishPrice', () => {
  it('accepts zero, integers, and two decimals', () => {
    expect(validateDishPrice(0)).toBeNull()
    expect(validateDishPrice(195)).toBeNull()
    expect(validateDishPrice(129.5)).toBeNull()
    expect(validateDishPrice(129.55)).toBeNull()
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
      category: CATEGORY_TO_API[original.category],
      imageKey: original.imageKey,
      active: original.active,
      ...over,
    }
  }

  it('returns an empty diff when nothing changed', () => {
    expect(dishChanges(original, desired())).toEqual({})
  })

  it('includes only the changed fields', () => {
    expect(dishChanges(original, desired({ price: 155, active: false }))).toEqual(
      { price: 155, active: false },
    )
  })

  it('never sends an empty imageKey — the API cannot clear it', () => {
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
