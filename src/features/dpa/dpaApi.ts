import { apiFetch, isApiConfigured } from '../../shared/api'
import type { Tenant, TenantDpa } from '../../shared/tenant'
import { DPA_VERSION } from './dpaText'

/** Ägaren ska se avtalsrutan: avtalet finns i API:t och nuvarande version är inte godkänd. */
export function dpaPending(tenant: Pick<Tenant, 'dpa'> | null | undefined): tenant is { dpa: TenantDpa } {
  return Boolean(tenant?.dpa && !tenant.dpa.upToDate)
}

/** Ny restaurang som inte har godkänt någon version: webbplatsen är inte publicerad än. */
export function dpaBlocksSite(tenant: Pick<Tenant, 'dpa'> | null | undefined): boolean {
  return Boolean(tenant?.dpa?.required && !tenant.dpa.acceptedVersion)
}

/**
 * POST /tenant/dpa/accept (bara ägare) med versionen av texten som visades.
 * 409 `dpa_version_outdated` = servern har en nyare version än appen.
 * Utan API (lokal utveckling) godkänns det bara i minnet.
 */
export function acceptDpa(tenant: Tenant): Promise<Tenant> {
  if (!isApiConfigured()) {
    const acceptedAt = new Date().toISOString()
    return Promise.resolve({
      ...tenant,
      dpa: {
        currentVersion: DPA_VERSION,
        acceptedVersion: DPA_VERSION,
        acceptedAt,
        required: tenant.dpa?.required ?? false,
        upToDate: true,
      },
    })
  }
  return apiFetch<Tenant>('/tenant/dpa/accept', {
    method: 'POST',
    body: JSON.stringify({ version: DPA_VERSION }),
  })
}
