import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import * as api from '../../shared/api'
import {
  createLocation,
  emptyBusinessHours,
  getLocation,
  locationChanges,
  updateLocation,
  validateAddress,
  validateBookingDuration,
  validateBusinessHours,
  validateDayIntervals,
  validateGracePeriod,
  validateName,
  validateTimezone,
} from './locationApi'
import type { Location } from './locationApi'

vi.mock('../../shared/api', async () => {
  const actual =
    await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockedApiFetch = vi.mocked(api.apiFetch)

const baseLocation: Location = {
  locationId: 'loc-1',
  name: 'Central Bistro',
  address: 'Main Street 1, Stockholm',
  timezone: 'Europe/Stockholm',
  businessHours: emptyBusinessHours(),
  bookingDurationHours: 2,
  gracePeriodHours: 0.25,
  createdBy: 'sub-owner',
  createdAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  mockedApiFetch.mockReset()
})

describe('field validation (mirrors create-location Lambda rules)', () => {
  it('requires a non-blank name and address', () => {
    expect(validateName('')).not.toBeNull()
    expect(validateName('KÄLLA')).toBeNull()
    expect(validateAddress('')).not.toBeNull()
    expect(validateAddress('Sveavägen 42')).toBeNull()
  })

  it('requires a non-blank timezone', () => {
    expect(validateTimezone('')).not.toBeNull()
    expect(validateTimezone('Europe/Stockholm')).toBeNull()
  })

  it('requires bookingDurationHours to be strictly greater than zero', () => {
    expect(validateBookingDuration(0)).not.toBeNull()
    expect(validateBookingDuration(-1)).not.toBeNull()
    expect(validateBookingDuration(NaN)).not.toBeNull()
    expect(validateBookingDuration(2)).toBeNull()
  })

  it('allows gracePeriodHours to be zero but not negative', () => {
    expect(validateGracePeriod(0)).toBeNull()
    expect(validateGracePeriod(-0.5)).not.toBeNull()
  })
})

describe('validateDayIntervals / validateBusinessHours', () => {
  it('accepts an empty (closed) day', () => {
    expect(validateDayIntervals('monday', [])).toBeNull()
  })

  it('requires opensAt to precede closesAt', () => {
    expect(
      validateDayIntervals('monday', [{ opensAt: '22:00', closesAt: '11:00' }]),
    ).not.toBeNull()
    expect(
      validateDayIntervals('monday', [{ opensAt: '11:00', closesAt: '11:00' }]),
    ).not.toBeNull()
  })

  it('rejects malformed time strings', () => {
    expect(
      validateDayIntervals('monday', [{ opensAt: '9:00', closesAt: '17:00' }]),
    ).not.toBeNull()
    expect(
      validateDayIntervals('monday', [{ opensAt: '25:00', closesAt: '17:00' }]),
    ).not.toBeNull()
  })

  it('rejects overlapping intervals regardless of input order', () => {
    expect(
      validateDayIntervals('monday', [
        { opensAt: '11:00', closesAt: '15:00' },
        { opensAt: '14:00', closesAt: '18:00' },
      ]),
    ).not.toBeNull()
    // Same overlap, given out of order - the validator sorts before checking.
    expect(
      validateDayIntervals('monday', [
        { opensAt: '14:00', closesAt: '18:00' },
        { opensAt: '11:00', closesAt: '15:00' },
      ]),
    ).not.toBeNull()
  })

  it('accepts back-to-back non-overlapping intervals', () => {
    expect(
      validateDayIntervals('monday', [
        { opensAt: '11:00', closesAt: '14:00' },
        { opensAt: '14:00', closesAt: '18:00' },
      ]),
    ).toBeNull()
  })

  it('validateBusinessHours checks every day and reports the first failure', () => {
    const hours = emptyBusinessHours()
    hours.wednesday = [{ opensAt: '18:00', closesAt: '10:00' }]
    expect(validateBusinessHours(hours)).toMatch(/wednesday/)
  })
})

describe('request shaping', () => {
  it('createLocation POSTs the exact payload to /locations', async () => {
    mockedApiFetch.mockResolvedValue(baseLocation)
    const input = {
      name: 'Central Bistro',
      address: 'Main Street 1, Stockholm',
      timezone: 'Europe/Stockholm',
      businessHours: emptyBusinessHours(),
      bookingDurationHours: 2,
      gracePeriodHours: 0.25,
    }
    const result = await createLocation(input)
    expect(result).toEqual(baseLocation)
    expect(mockedApiFetch).toHaveBeenCalledWith('/locations', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  })

  it('getLocation GETs /locations/{locationId}', async () => {
    mockedApiFetch.mockResolvedValue(baseLocation)
    await getLocation('loc-1')
    expect(mockedApiFetch).toHaveBeenCalledWith('/locations/loc-1')
  })
})

describe('updateLocation', () => {
  const base = {
    name: 'Källa',
    address: 'Storgatan 1',
    timezone: 'Europe/Stockholm',
    businessHours: emptyBusinessHours(),
    bookingDurationHours: 2,
    gracePeriodHours: 0.25,
  }

  it('PUTs to the location path', async () => {
    mockedApiFetch.mockResolvedValue({})
    await updateLocation('loc 1', { name: 'Nytt namn' })
    expect(mockedApiFetch).toHaveBeenCalledWith('/locations/loc%201', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Nytt namn' }),
    })
  })

  it('reports no changes when nothing was edited', () => {
    expect(locationChanges(base, { ...base })).toEqual({})
  })

  it('includes only the fields that actually differ', () => {
    const changes = locationChanges(base, { ...base, gracePeriodHours: 1 })
    expect(changes).toEqual({ gracePeriodHours: 1 })
  })

  it('detects a nested business-hours edit', () => {
    const next = {
      ...base,
      businessHours: {
        ...base.businessHours,
        monday: [{ opensAt: '11:00', closesAt: '22:00' }],
      },
    }
    expect(locationChanges(base, next)).toHaveProperty('businessHours')
  })
})

describe('error mapping', () => {
  it('maps 404 to a not-found message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(404, 'location not found'))
    await expect(getLocation('missing')).rejects.toThrow('Platsen hittades inte.')
  })

  it('maps 403 to a forbidden message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(403, 'forbidden'))
    await expect(getLocation('loc-1')).rejects.toThrow(/inte behörighet/)
  })

  it('passes 400 validation messages through as-is', async () => {
    mockedApiFetch.mockRejectedValue(
      new ApiError(400, 'bookingDurationHours must be greater than zero'),
    )
    await expect(
      createLocation({
        name: 'x',
        address: 'x',
        timezone: 'Europe/Stockholm',
        businessHours: emptyBusinessHours(),
        bookingDurationHours: 0,
        gracePeriodHours: 0,
      }),
    ).rejects.toThrow('bookingDurationHours must be greater than zero')
  })
})
