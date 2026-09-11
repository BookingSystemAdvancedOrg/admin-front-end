import { useEffect, useState } from 'react'
import { activateLayoutVersion, listLayoutVersions } from './layoutApi'
import type { LayoutActivation, PublishedLayoutSnapshot } from './layoutApi'

/** "2026-10-05T01:00:00Z" -> "5 oktober 2026, 03:00" i lokal tid. */
function formatMoment(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Publicerade layoutversioner, med möjlighet att aktivera en av dem.
 *
 * Aktiveringen är omedelbar bara när ingen version gäller ännu. Finns redan
 * en gällande version schemalägger API:t bytet fyra veckor fram — det måste
 * synas, annars tror man att bytet skett direkt. Bara ägare och systemadmin
 * får aktivera, så listan visas för alla men knappen bara för dem.
 */
export function LayoutVersionsModal({
  locationId,
  canActivate,
  onClose,
  onActivated,
}: {
  locationId: string
  canActivate: boolean
  onClose: () => void
  onActivated: () => void
}) {
  const [versions, setVersions] = useState<PublishedLayoutSnapshot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  const [result, setResult] = useState<LayoutActivation | null>(null)

  useEffect(() => {
    let cancelled = false
    listLayoutVersions(locationId)
      .then((items) => {
        if (!cancelled) setVersions(items)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Kunde inte hämta versionerna.',
          )
          setVersions([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  async function activate(version: number) {
    setError(null)
    setResult(null)
    setBusyVersion(version)
    try {
      const activation = await activateLayoutVersion(locationId, version)
      setResult(activation)
      // Läs om listan: lifecycle-fälten på både den nya och den gamla
      // versionen ändras av aktiveringen.
      setVersions(await listLayoutVersions(locationId))
      onActivated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte aktivera versionen.')
    } finally {
      setBusyVersion(null)
    }
  }

  // En väntande version har ett framtida effectiveFrom men gäller inte än.
  const pendingVersion = versions?.find(
    (v) => !v.isCurrent && v.effectiveFrom && new Date(v.effectiveFrom) > new Date(),
  )

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Publicerade versioner</h2>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {result && (
          <p className="save-notice" role="status">
            {result.status === 'active'
              ? `Version ${result.version} gäller nu.`
              : `Version ${result.version} tar över från version ${result.currentVersion} den ${formatMoment(result.cutoverAt)}.`}
          </p>
        )}

        {versions === null && <p className="cell-muted">Hämtar versioner…</p>}

        {versions?.length === 0 && !error && (
          <p className="cell-muted">
            Inga publicerade versioner än. Publicera layouten först.
          </p>
        )}

        {versions && versions.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Element</th>
                  <th>Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const isPending = pendingVersion?.version === v.version
                  return (
                    <tr key={v.version}>
                      <td className="cell-strong">{v.label}</td>
                      <td>
                        {v.isCurrent ? (
                          <span className="status-badge reserved">Gäller nu</span>
                        ) : isPending ? (
                          <span className="status-badge waiting">
                            Byte {v.effectiveFrom ? formatMoment(v.effectiveFrom) : ''}
                          </span>
                        ) : (
                          <span className="cell-muted">Inaktiv</span>
                        )}
                      </td>
                      <td className="cell-muted">{v.elements.length}</td>
                      <td>
                        {canActivate && !v.isCurrent && !isPending && (
                          <button
                            type="button"
                            className="link-action"
                            disabled={busyVersion !== null}
                            onClick={() => activate(v.version)}
                          >
                            {busyVersion === v.version ? 'Aktiverar…' : 'Aktivera'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!canActivate && versions && versions.length > 0 && (
          <p className="cell-muted">
            Bara ägare och systemadmin kan aktivera en version.
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onClose}>
            Stäng
          </button>
        </div>
      </div>
    </div>
  )
}
