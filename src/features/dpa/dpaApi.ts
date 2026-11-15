import { apiFetch, isApiConfigured } from '../../shared/api'
import type { Tenant, TenantDpa } from '../../shared/tenant'
import { DPA_VERSION } from './dpaText'
import { TERMS_VERSION } from './termsText'

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

/**
 * POST /tenant/terms/accept (bara ägare): Allmänna villkor för restauranger,
 * versionen som visades. 409 `terms_version_outdated` = en nyare version
 * finns. Utan API (lokal utveckling) godkänns de bara i minnet.
 */
export function acceptTerms(tenant: Tenant): Promise<Tenant> {
  if (!isApiConfigured()) {
    return Promise.resolve({
      ...tenant,
      terms: { currentVersion: TERMS_VERSION, acceptedVersion: TERMS_VERSION, acceptedAt: new Date().toISOString(), upToDate: true },
    })
  }
  return apiFetch<Tenant>('/tenant/terms/accept', {
    method: 'POST',
    body: JSON.stringify({ version: TERMS_VERSION }),
  })
}
