import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { ApiError } from './api'
import { getStoredLocationId, resolveLocationId } from './location'
import {
  getTenantState,
  loadTenant,
  pickLocation,
  resetTenantStore,
  selectLocation,
  stripeStage,
} from './tenant'
import type { Tenant } from './tenant'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof api>('./api')
  return { ...actual, apiFetch: vi.fn(), isApiConfigured: vi.fn(() => true) }
})

const mockedFetch = vi.mocked(api.apiFetch)

function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    tenantId: 't-a',
    name: 'Test Restaurang',
    slug: null,
    status: 'active',
    planId: 'growth',
    entitlements: { maxLocations: 3, features: {} },
    locationCount: 2,
    stripe: {
      connected: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    },
    primaryDomain: null,
    senderName: null,
    notifications: { sms: false, staffEmails: true, reminderHours: 24 },
    replyToEmail: null,
    role: 'owner_user',
    locations: [
      { locationId: 'loc-old', name: 'Södermalm', address: 'Gata 1', timezone: 'Europe/Stockholm' },
      { locationId: 'loc-new', name: 'Hagastan', address: 'Gata 2', timezone: 'Europe/Stockholm' },
    ],
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
  mockedFetch.mockReset()
  resetTenantStore()
})

describe('pickLocation', () => {
  it('keeps the preferred location when the tenant still has it', () => {
    expect(pickLocation(tenant(), 'loc-new')).toBe('loc-new')
  })

  it('falls back to the oldest when the preferred id is not one of ours', () => {
    expect(pickLocation(tenant(), 'loc-of-another-tenant')).toBe('loc-old')
    expect(pickLocation(tenant(), null)).toBe('loc-old')
  })

  it('is null when there are no locations', () => {
    expect(pickLocation(tenant({ locations: [] }), 'loc-old')).toBeNull()
  })
})

describe('loadTenant', () => {
  it('loads GET /tenant and selects the oldest location', async () => {
    mockedFetch.mockResolvedValue(tenant())

    await loadTenant('owner-sub')

    expect(mockedFetch).toHaveBeenCalledWith('/tenant')
    expect(getTenantState()).toMatchObject({ status: 'ready', locationId: 'loc-old' })
    expect(getStoredLocationId()).toBe('loc-old')
  })

  it('remembers the chosen location per tenant', async () => {
    mockedFetch.mockResolvedValue(tenant())
    await loadTenant('owner-sub')
    selectLocation('loc-new')
    expect(localStorage.getItem('admin-location-id:t-a')).toBe('loc-new')

    resetTenantStore()
    await loadTenant('owner-sub')
    expect(getStoredLocationId()).toBe('loc-new')
  })

  it("never selects another tenant's location from a shared browser", async () => {
    localStorage.setItem('admin-location-id', 'loc-of-anar-ab') // pre-tenancy key
    localStorage.setItem('admin-location-id:t-a', 'loc-of-anar-ab')
    mockedFetch.mockResolvedValue(tenant())

    await loadTenant('owner-sub')

    expect(getStoredLocationId()).toBe('loc-old')
    expect(localStorage.getItem('admin-location-id')).toBeNull()
  })

  it('ignores selecting an id the tenant does not have', async () => {
    mockedFetch.mockResolvedValue(tenant())
    await loadTenant('owner-sub')

    selectLocation('loc-of-another-tenant')

    expect(getStoredLocationId()).toBe('loc-old')
  })

  it('reuses the loaded tenant and re-fetches only when forced', async () => {
    mockedFetch.mockResolvedValue(tenant())
    await loadTenant('owner-sub')
    await loadTenant('owner-sub')
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    await loadTenant('owner-sub', { force: true })
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })

  it("starts from scratch for another user - never shows the previous user's tenant", async () => {
    mockedFetch.mockResolvedValueOnce(tenant())
    await loadTenant('owner-a')
    mockedFetch.mockResolvedValueOnce(
      tenant({ tenantId: 't-b', name: 'Other', locations: [] }),
    )

    await loadTenant('owner-b')

    expect(getTenantState()).toMatchObject({ sub: 'owner-b', locationId: null })
    expect(getTenantState().tenant?.name).toBe('Other')
  })

  it.each([
    [new ApiError(403, 'tenant_inactive'), 'tenant_inactive'],
    [new ApiError(403, 'no_tenant'), 'no_tenant'],
    [new ApiError(401, 'Unauthorized'), 'unauthorized'],
    [new ApiError(503, 'account service unavailable'), 'unavailable'],
    [new TypeError('Failed to fetch'), 'unavailable'],
  ])('maps %s to %s', async (error, code) => {
    mockedFetch.mockRejectedValue(error)

    await loadTenant('owner-sub')

    expect(getTenantState()).toMatchObject({ status: 'error', error: code, tenant: null })
  })

  it('keeps showing the tenant through a transient failure on refresh', async () => {
    mockedFetch.mockResolvedValueOnce(tenant())
    await loadTenant('owner-sub')
    mockedFetch.mockRejectedValueOnce(new ApiError(503, 'unavailable'))

    await loadTenant('owner-sub', { force: true })

    expect(getTenantState()).toMatchObject({ status: 'ready', locationId: 'loc-old' })
  })

  it('drops the tenant when a refresh says the account is suspended', async () => {
    mockedFetch.mockResolvedValueOnce(tenant())
    await loadTenant('owner-sub')
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'tenant_inactive'))

    await loadTenant('owner-sub', { force: true })

    expect(getTenantState()).toMatchObject({
      status: 'error',
      error: 'tenant_inactive',
      tenant: null,
      locationId: null,
    })
  })
})

describe('resolveLocationId', () => {
  it('re-reads the tenant, so a location created elsewhere is found', async () => {
    mockedFetch.mockResolvedValueOnce(tenant({ locations: [] }))
    await loadTenant('owner-sub')
    expect(getStoredLocationId()).toBeNull()

    mockedFetch.mockResolvedValueOnce(tenant())
    expect(await resolveLocationId('owner-sub')).toBe('loc-old')
  })
})

describe('stripeStage', () => {
  const base = tenant().stripe
  it.each([
    [{ ...base, connected: false }, 'missing'],
    [base, 'not_started'],
    [{ ...base, detailsSubmitted: true }, 'in_review'],
    [{ ...base, detailsSubmitted: true, chargesEnabled: true }, 'ready'],
  ])('%o -> %s', (stripe, stage) => {
    expect(stripeStage(stripe)).toBe(stage)
  })
})
