import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import * as api from '../../shared/api'
import {
  canInvite,
  canManageTarget,
  changeUserGroup,
  deactivateUser,
  deleteUser,
  getUser,
  inviteUser,
  listUsers,
  reactivateUser,
  updateUserProfile,
  validateEmail,
  validateLocationId,
  validateName,
  validatePhone,
} from './usersApi'
import type { User } from './usersApi'

vi.mock('../../shared/api', async () => {
  const actual =
    await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockedApiFetch = vi.mocked(api.apiFetch)

const baseUser: User = {
  cognitoSub: 'sub-1',
  role: 'staff',
  locationId: 'loc-1',
  name: 'Test User',
  email: 'test@example.com',
  phone: '+46701234567',
  status: 'active',
  createdBy: 'sub-owner',
  createdAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  mockedApiFetch.mockReset()
})

describe('field validation (mirrors manage-user Lambda rules)', () => {
  it('requires a non-blank name', () => {
    expect(validateName('')).not.toBeNull()
    expect(validateName('   ')).not.toBeNull()
    expect(validateName('Anna')).toBeNull()
  })

  it('rejects malformed emails', () => {
    expect(validateEmail('')).not.toBeNull()
    expect(validateEmail('not-an-email')).not.toBeNull()
    expect(validateEmail('a@b.se')).toBeNull()
  })

  it('rejects emails longer than 320 characters', () => {
    const tooLong = `${'a'.repeat(316)}@b.se`
    expect(tooLong.length).toBeGreaterThan(320)
    expect(validateEmail(tooLong)).not.toBeNull()
  })

  it('requires E.164-formatted phone numbers', () => {
    expect(validatePhone('')).not.toBeNull()
    expect(validatePhone('0701234567')).not.toBeNull()
    expect(validatePhone('+46701234567')).toBeNull()
  })

  it('requires locationId for staff_user and forbids it for privileged groups', () => {
    expect(validateLocationId('staff_user', '')).not.toBeNull()
    expect(validateLocationId('staff_user', 'loc-1')).toBeNull()
    expect(validateLocationId('owner_user', 'loc-1')).not.toBeNull()
    expect(validateLocationId('owner_user', '')).toBeNull()
    expect(validateLocationId('super_user', '')).toBeNull()
  })
})

describe('canInvite', () => {
  it('lets any caller invite staff_user', () => {
    expect(canInvite([], 'staff_user')).toBe(true)
    expect(canInvite(['owner_user'], 'staff_user')).toBe(true)
  })

  it('requires super_user to invite owner_user or super_user', () => {
    expect(canInvite(['owner_user'], 'owner_user')).toBe(false)
    expect(canInvite(['owner_user'], 'super_user')).toBe(false)
    expect(canInvite(['super_user'], 'owner_user')).toBe(true)
    expect(canInvite(['super_user'], 'super_user')).toBe(true)
  })
})

describe('canManageTarget', () => {
  it('never allows destructive or group-changing self-actions', () => {
    const self = { sub: 'sub-1', groups: ['super_user'] }
    expect(canManageTarget(self, baseUser, 'deactivate')).toBe(false)
    expect(canManageTarget(self, baseUser, 'reactivate')).toBe(false)
    expect(canManageTarget(self, baseUser, 'delete')).toBe(false)
    expect(canManageTarget(self, baseUser, 'group')).toBe(false)
  })

  it('allows editing your own profile even without owner/super group', () => {
    const self = { sub: 'sub-1', groups: [] }
    expect(canManageTarget(self, baseUser, 'profile')).toBe(true)
  })

  it('lets super_user manage anyone, including other privileged accounts', () => {
    const superUser = { sub: 'sub-owner', groups: ['super_user'] }
    const ownerTarget: User = { ...baseUser, cognitoSub: 'sub-2', role: 'owner_user' }
    expect(canManageTarget(superUser, ownerTarget, 'delete')).toBe(true)
    expect(canManageTarget(superUser, ownerTarget, 'group')).toBe(true)
  })

  it('restricts owner_user to staff-role targets only', () => {
    const owner = { sub: 'sub-owner', groups: ['owner_user'] }
    expect(canManageTarget(owner, baseUser, 'delete')).toBe(true)
    const ownerTarget: User = { ...baseUser, cognitoSub: 'sub-2', role: 'owner_user' }
    expect(canManageTarget(owner, ownerTarget, 'delete')).toBe(false)
    expect(canManageTarget(owner, ownerTarget, 'profile')).toBe(false)
  })
})

describe('request shaping', () => {
  it('inviteUser POSTs the exact payload to /users/invite', async () => {
    mockedApiFetch.mockResolvedValue(baseUser)
    const input = {
      name: 'Test User',
      email: 'test@example.com',
      phone: '+46701234567',
      group: 'staff_user' as const,
      locationId: 'loc-1',
    }
    const result = await inviteUser(input)
    expect(result).toEqual(baseUser)
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/invite', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  })

  it('updateUserProfile PUTs only the given fields to /users/{cognitoSub}', async () => {
    mockedApiFetch.mockResolvedValue(baseUser)
    await updateUserProfile('sub-1', { name: 'New Name' })
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/sub-1', {
      method: 'PUT',
      body: JSON.stringify({ name: 'New Name' }),
    })
  })

  it('changeUserGroup PUTs to /users/{cognitoSub}/group', async () => {
    mockedApiFetch.mockResolvedValue(baseUser)
    await changeUserGroup('sub-1', { group: 'owner_user', locationId: '' })
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/sub-1/group', {
      method: 'PUT',
      body: JSON.stringify({ group: 'owner_user', locationId: '' }),
    })
  })

  it('deactivateUser and reactivateUser POST to the right sub-paths', async () => {
    mockedApiFetch.mockResolvedValue(baseUser)
    await deactivateUser('sub-1')
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/sub-1/deactivate', {
      method: 'POST',
    })
    await reactivateUser('sub-1')
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/sub-1/reactivate', {
      method: 'POST',
    })
  })

  it('deleteUser DELETEs /users/{cognitoSub}', async () => {
    mockedApiFetch.mockResolvedValue(undefined)
    await deleteUser('sub-1')
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/sub-1', {
      method: 'DELETE',
    })
  })

  it('listUsers GETs /users and unwraps the { items: [...] } envelope', async () => {
    mockedApiFetch.mockResolvedValue({ items: [baseUser] })
    expect(await listUsers()).toEqual([baseUser])
    expect(mockedApiFetch).toHaveBeenCalledWith('/users')
  })

  it('listUsers returns an empty list when items is missing', async () => {
    mockedApiFetch.mockResolvedValue({})
    expect(await listUsers()).toEqual([])
  })

  it('listUsers maps 404 to a route-missing message, not "user not found"', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(404, 'Not Found'))
    await expect(listUsers()).rejects.toThrow(/inte deployad/)
  })

  it('getUser GETs /users/{cognitoSub}', async () => {
    mockedApiFetch.mockResolvedValue(baseUser)
    expect(await getUser('sub-1')).toEqual(baseUser)
    expect(mockedApiFetch).toHaveBeenCalledWith('/users/sub-1')
  })

  it('URL-encodes the cognitoSub in the path', async () => {
    mockedApiFetch.mockResolvedValue(baseUser)
    await updateUserProfile('sub/with space', { name: 'x' })
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `/users/${encodeURIComponent('sub/with space')}`,
      expect.anything(),
    )
  })
})

describe('error mapping', () => {
  it('maps 409 "already exists" to a Swedish conflict message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(409, 'user already exists'))
    await expect(
      inviteUser({
        name: 'x',
        email: 'x@x.se',
        phone: '+46700000000',
        group: 'staff_user',
        locationId: 'l',
      }),
    ).rejects.toThrow(/redan en användare/)
  })

  it('maps 403 to a forbidden message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(403, 'forbidden'))
    await expect(deleteUser('sub-1')).rejects.toThrow(/inte behörighet/)
  })

  it('maps 404 to a not-found message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(404, 'user not found'))
    await expect(deleteUser('sub-1')).rejects.toThrow(/hittades inte/)
  })

  it('maps 501 to a not-yet-implemented message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(501, 'not implemented'))
    await expect(deleteUser('sub-1')).rejects.toThrow(/inte klar på serversidan/)
  })

  it('maps locationId validation errors from the server to Swedish', async () => {
    mockedApiFetch.mockRejectedValue(
      new ApiError(400, 'locationId is required for staff_user'),
    )
    await expect(
      inviteUser({
        name: 'x',
        email: 'x@x.se',
        phone: '+46700000000',
        group: 'staff_user',
        locationId: '',
      }),
    ).rejects.toThrow('Plats-ID krävs för personal.')
  })

  it('passes non-ApiError failures through unchanged', async () => {
    mockedApiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(deleteUser('sub-1')).rejects.toThrow('Failed to fetch')
  })
})
