import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import * as usersApi from '../features/installningar/usersApi'
import * as locationApi from '../features/installningar/locationApi'
import type { User } from '../features/installningar/usersApi'
import {
  LOCATION_ID_STORAGE_KEY,
  getStoredLocationId,
  resolveLocationId,
} from './location'

vi.mock('../features/installningar/usersApi', async () => {
  const actual = await vi.importActual<typeof usersApi>(
    '../features/installningar/usersApi',
  )
  return { ...actual, listUsers: vi.fn() }
})

vi.mock('../features/installningar/locationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../features/installningar/locationApi')
  >('../features/installningar/locationApi')
  return { ...actual, listLocations: vi.fn(), getLocation: vi.fn() }
})

const mockedListUsers = vi.mocked(usersApi.listUsers)
const mockedListLocations = vi.mocked(locationApi.listLocations)
const mockedGetLocation = vi.mocked(locationApi.getLocation)

function user(over: Partial<User>): User {
  return {
    cognitoSub: 'sub-1',
    role: 'staff',
    locationId: '',
    name: 'Namn',
    email: 'a@b.se',
    phone: '+46701234567',
    status: 'active',
    createdBy: 'sub-owner',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function locations(
  ...items: Partial<locationApi.Location>[]
): locationApi.Location[] {
  return items as unknown as locationApi.Location[]
}

/** Katalogen är otillgänglig — personal får 403, och rutten kan saknas. */
function noLocationDirectory() {
  mockedListLocations.mockRejectedValue(new Error('403'))
}

beforeEach(() => {
  localStorage.clear()
  mockedListUsers.mockReset()
  mockedListLocations.mockReset()
  mockedGetLocation.mockReset()
  mockedListLocations.mockResolvedValue([])
  // Ett uppslaget id bekräftas mot servern — låt det finnas om inte testet
  // säger något annat.
  mockedGetLocation.mockResolvedValue({} as unknown as locationApi.Location)
})

describe('resolveLocationId', () => {
  it('takes the single location from the directory — one restaurant per deployment', async () => {
    mockedListLocations.mockResolvedValue(locations({ locationId: 'loc-the-one' }))
    expect(await resolveLocationId('owner')).toBe('loc-the-one')
    // Katalogen räckte — ingen anledning att gå vidare till användarlistan.
    expect(mockedListUsers).not.toHaveBeenCalled()
  })

  it('lets the server override a stale cached id, so every device converges', async () => {
    localStorage.setItem(LOCATION_ID_STORAGE_KEY, 'loc-stale')
    mockedListLocations.mockResolvedValue(locations({ locationId: 'loc-real' }))
    expect(await resolveLocationId('owner')).toBe('loc-real')
    expect(getStoredLocationId()).toBe('loc-real')
  })

  it('clears a cached id when the directory says no location exists', async () => {
    localStorage.setItem(LOCATION_ID_STORAGE_KEY, 'loc-deleted')
    mockedListLocations.mockResolvedValue([])
    expect(await resolveLocationId('owner')).toBeNull()
    expect(getStoredLocationId()).toBeNull()
  })

  it('picks the oldest location when duplicates exist, deterministically on every device', async () => {
    mockedListLocations.mockResolvedValue(
      locations(
        { locationId: 'loc-dupe', createdAt: '2026-03-01T00:00:00Z' },
        { locationId: 'loc-original', createdAt: '2026-01-01T00:00:00Z' },
      ),
    )
    expect(await resolveLocationId('owner')).toBe('loc-original')
  })

  it('works for an owner with no staff at all, which the user list cannot cover', async () => {
    mockedListLocations.mockResolvedValue(locations({ locationId: 'loc-1' }))
    mockedListUsers.mockResolvedValue([])
    expect(await resolveLocationId('owner')).toBe('loc-1')
  })

  it('recovers the id from the callers own staff record on a fresh browser', async () => {
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([
      user({ cognitoSub: 'other', locationId: 'loc-other' }),
      user({ cognitoSub: 'sub-1', locationId: 'loc-mine' }),
    ])
    expect(await resolveLocationId('sub-1')).toBe('loc-mine')
  })

  it('remembers what it recovered so the next load is instant', async () => {
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([user({ locationId: 'loc-1' })])
    await resolveLocationId('sub-1')
    expect(getStoredLocationId()).toBe('loc-1')
  })

  it('falls back to a staff members location for an owner, whose own record has none', async () => {
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([
      user({ cognitoSub: 'owner', role: 'owner_user', locationId: '' }),
      user({ cognitoSub: 'staff-1', locationId: 'loc-from-staff' }),
    ])
    expect(await resolveLocationId('owner')).toBe('loc-from-staff')
  })

  it('skips a user-list id whose location was deleted and takes the next candidate', async () => {
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([
      user({ cognitoSub: 'sub-1', locationId: 'loc-deleted' }),
      user({ cognitoSub: 'other', locationId: 'loc-alive' }),
    ])
    mockedGetLocation.mockImplementation((id) =>
      id === 'loc-deleted'
        ? Promise.reject(new ApiError(404, 'Platsen hittades inte.'))
        : Promise.resolve({} as unknown as locationApi.Location),
    )
    expect(await resolveLocationId('sub-1')).toBe('loc-alive')
    expect(getStoredLocationId()).toBe('loc-alive')
  })

  it('drops a cached id the server explicitly says is gone', async () => {
    localStorage.setItem(LOCATION_ID_STORAGE_KEY, 'loc-deleted')
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([])
    mockedGetLocation.mockRejectedValue(new ApiError(404, 'Platsen hittades inte.'))
    expect(await resolveLocationId('sub-1')).toBeNull()
    expect(getStoredLocationId()).toBeNull()
  })

  it('keeps the cached id when the server cannot be reached at all', async () => {
    localStorage.setItem(LOCATION_ID_STORAGE_KEY, 'loc-offline')
    noLocationDirectory()
    mockedListUsers.mockRejectedValue(new Error('nätverksfel'))
    // Ett nätverksfel är inte ett "finns inte" — id:t ska överleva.
    mockedGetLocation.mockRejectedValue(new Error('nätverksfel'))
    expect(await resolveLocationId('sub-1')).toBe('loc-offline')
    expect(getStoredLocationId()).toBe('loc-offline')
  })

  it('returns null when no user carries a location', async () => {
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([
      user({ cognitoSub: 'owner', role: 'owner_user', locationId: '' }),
    ])
    expect(await resolveLocationId('owner')).toBeNull()
  })

  it('returns null instead of throwing when the user list fails', async () => {
    noLocationDirectory()
    mockedListUsers.mockRejectedValue(new Error('403'))
    await expect(resolveLocationId('sub-1')).resolves.toBeNull()
  })

  it('ignores a blank locationId rather than storing an empty pointer', async () => {
    noLocationDirectory()
    mockedListUsers.mockResolvedValue([user({ locationId: '   ' })])
    expect(await resolveLocationId('sub-1')).toBeNull()
    expect(getStoredLocationId()).toBeNull()
  })
})
