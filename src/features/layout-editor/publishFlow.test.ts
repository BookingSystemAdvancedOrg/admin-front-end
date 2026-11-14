import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import type { LayoutActivation, PublishedLayoutSnapshot } from './layoutApi'

type Activate = (locationId: string, version: number) => Promise<LayoutActivation>
import { activatePublished, labelFor } from './publishFlow'

function version(n: number, isCurrent: boolean): PublishedLayoutSnapshot {
  return { version: n, label: `Version ${n}`, isCurrent } as PublishedLayoutSnapshot
}

const active = { status: 'active' as const, version: 1, effectiveFrom: '2026-11-14T10:00:00Z' }

function deps(activate: Activate, versions: PublishedLayoutSnapshot[] | Error) {
  return {
    activate,
    list: vi.fn(() =>
      versions instanceof Error ? Promise.reject(versions) : Promise.resolve(versions),
    ),
    wait: vi.fn(() => Promise.resolve()),
  }
}

describe('activatePublished (first publish)', () => {
  it('activates and says so when the list agrees', async () => {
    const d = deps(vi.fn<Activate>().mockResolvedValue(active), [version(1, true)])
    const out = await activatePublished('loc', 1, d)
    expect(out).toEqual({
      ok: true,
      text: 'Publicerad och aktiverad som version 1 - gäller nu.',
      label: 'Gäller: Version 1',
    })
    expect(d.wait).not.toHaveBeenCalled()
  })

  it('retries a 503 and then reports it active', async () => {
    const activate = vi.fn<Activate>()
      .mockRejectedValueOnce(new ApiError(503, 'Layouttjänsten är tillfälligt otillgänglig.'))
      .mockResolvedValueOnce(active)
    const d = deps(activate, [version(1, true)])
    const out = await activatePublished('loc', 1, d)
    expect(activate).toHaveBeenCalledTimes(2)
    expect(d.wait).toHaveBeenCalledWith(1000)
    expect(out.ok).toBe(true)
    expect(out.text).toMatch(/aktiverad som version 1/)
  })

  it('retries a network error and a 409 (concurrent change) too', async () => {
    const activate = vi.fn<Activate>()
      .mockRejectedValueOnce(new ApiError(0, 'Ingen kontakt med servern.'))
      .mockRejectedValueOnce(new ApiError(409, 'Ett versionsbyte är redan inbokat.'))
      .mockResolvedValueOnce(active)
    const out = await activatePublished('loc', 1, deps(activate, [version(1, true)]))
    expect(activate).toHaveBeenCalledTimes(3)
    expect(out.ok).toBe(true)
  })

  it('gives up after three tries and says it is not active', async () => {
    const activate = vi.fn<Activate>().mockRejectedValue(new ApiError(503, 'Layouttjänsten är tillfälligt otillgänglig.'))
    const out = await activatePublished('loc', 1, deps(activate, [version(1, false)]))
    expect(activate).toHaveBeenCalledTimes(3)
    expect(out.ok).toBe(false)
    expect(out.text).toMatch(/^Version 1 är publicerad men inte aktiverad: /)
  })

  it('does not retry a 403, says it is not active and refreshes the label', async () => {
    const activate = vi.fn<Activate>().mockRejectedValue(new ApiError(403, 'Du har inte behörighet att ändra layouten.'))
    const d = deps(activate, [version(1, false)])
    const out = await activatePublished('loc', 1, d)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(d.list).toHaveBeenCalledWith('loc')
    expect(out).toEqual({
      ok: false,
      text:
        'Version 1 är publicerad men inte aktiverad: Du har inte behörighet att ändra layouten. ' +
        'Aktivera den under Versioner.',
      label: 'Version 1 · ej aktiverad',
    })
  })

  it('does not trust "active" when the list says the version is not current', async () => {
    const out = await activatePublished('loc', 1, deps(vi.fn<Activate>().mockResolvedValue(active), [version(1, false)]))
    expect(out.ok).toBe(false)
    expect(out.text).toBe('Version 1 är publicerad men inte aktiverad. Aktivera den under Versioner.')
    expect(out.label).toBe('Version 1 · ej aktiverad')
  })

  it('reports a scheduled switch when another version is current', async () => {
    const pending = { status: 'pending' as const, version: 2, currentVersion: 1, cutoverAt: '2026-11-14T10:05:00Z' }
    const out = await activatePublished('loc', 2, {
      ...deps(vi.fn<Activate>().mockResolvedValue(pending), [version(2, false), version(1, true)]),
      formatMoment: () => '14 november 2026 11:05',
    })
    expect(out).toEqual({
      ok: true,
      text:
        'Publicerad som version 2. En annan version gäller redan, så bytet sker ' +
        '14 november 2026 11:05 istället för direkt.',
      label: 'Gäller: Version 1',
    })
  })

  it('keeps the activation result when the list cannot be read', async () => {
    const out = await activatePublished('loc', 1, deps(vi.fn<Activate>().mockResolvedValue(active), new Error('nere')))
    expect(out).toMatchObject({ ok: true, label: '' })
  })
})

describe('labelFor', () => {
  it('names the current version, else the newest as not active', () => {
    expect(labelFor([])).toBe('Aldrig publicerad')
    expect(labelFor([version(2, false), version(1, true)])).toBe('Gäller: Version 1')
    expect(labelFor([version(1, false)])).toBe('Version 1 · ej aktiverad')
  })
})
