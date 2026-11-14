import { ApiError } from '../../shared/api'
import { errorText } from '../../shared/errors'
import { activateLayoutVersion, listLayoutVersions } from './layoutApi'
import type { LayoutActivation, PublishedLayoutSnapshot } from './layoutApi'

/** Etiketten bredvid Versioner-knappen, ur versionslistan. */
export function labelFor(versions: PublishedLayoutSnapshot[]): string {
  if (versions.length === 0) return 'Aldrig publicerad'
  const current = versions.find((v) => v.isCurrent)
  return current ? `Gäller: ${current.label}` : `${versions[0].label} · ej aktiverad`
}

export type ActivationOutcome = {
  /** Allt gick: status ska visas. Annars är `text` ett fel. */
  ok: boolean
  text: string
  /** Ny etikett ur en färsk versionslista ('' om listan inte gick att läsa). */
  label: string
}

type Deps = {
  activate: (locationId: string, version: number) => Promise<LayoutActivation>
  list: (locationId: string) => Promise<PublishedLayoutSnapshot[]>
  wait: (ms: number) => Promise<void>
  formatMoment: (iso: string) => string
}

const defaultDeps: Deps = {
  activate: activateLayoutVersion,
  list: listLayoutVersions,
  wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  formatMoment: (iso) => iso,
}

/** Nätverk, samtidig ändring (409) och serverfel (5xx) kan gå över av sig själva. */
function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status === 409 || err.status >= 500)
}

/**
 * Aktiverar en nypublicerad version. Samma begäran två gånger är ofarlig
 * enligt API:t (redan gällande version ger "active"), så ett tillfälligt fel
 * får två nya försök. Statusen kontrolleras sedan mot versionslistan, så
 * sidan aldrig säger "aktiverad" när listan säger "ej aktiverad".
 */
export async function activatePublished(
  locationId: string,
  version: number,
  deps: Partial<Deps> = {},
): Promise<ActivationOutcome> {
  const d = { ...defaultDeps, ...deps }
  let activation: LayoutActivation | null = null
  let failure: unknown = null
  for (const delay of [0, 1000, 3000]) {
    if (delay) await d.wait(delay)
    try {
      activation = await d.activate(locationId, version)
      failure = null
      break
    } catch (err) {
      failure = err
      if (!isTransient(err)) break
    }
  }

  const versions = await d.list(locationId).catch(() => null)
  const label = versions ? labelFor(versions) : ''
  const published = versions?.find((v) => v.version === version)

  if (!activation) {
    const detail = errorText(failure, 'Okänt fel.')
    const guidance = /aktivera/i.test(detail) ? '' : ' Aktivera den under Versioner.'
    return {
      ok: false,
      text: `Version ${version} är publicerad men inte aktiverad: ${detail}${guidance}`,
      label,
    }
  }
  if (activation.status === 'active' && published && !published.isCurrent) {
    return {
      ok: false,
      text: `Version ${version} är publicerad men inte aktiverad. Aktivera den under Versioner.`,
      label,
    }
  }
  return {
    ok: true,
    text:
      activation.status === 'active'
        ? `Publicerad och aktiverad som version ${version} - gäller nu.`
        : `Publicerad som version ${version}. En annan version gäller ` +
          `redan, så bytet sker ${d.formatMoment(activation.cutoverAt)} istället för direkt.`,
    label,
  }
}
