import { useEffect, useState } from 'react'
import {
  activateLayoutVersion,
  archiveLayoutVersion,
  cancelPendingLayoutActivation,
  listLayoutVersions,
} from './layoutApi'
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

/** Kort variant för statusmärket i listan — "5 okt. 2026" — så raden inte
 *  tvingar fram sidscroll. Fulla datumet + klockslag står redan i
 *  bekräftelsetexten ovanför listan när man just aktiverat något. */
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

/**
 * Publicerade layoutversioner, med möjlighet att aktivera, avbryta eller
 * arkivera en av dem.
 *
 * Aktiveringen är omedelbar bara när ingen version gäller ännu. Finns redan
 * en gällande version schemalägger API:t bytet ett stycke fram i tiden i
 * stället — hur långt är miljöberoende (bekräftat av backend-teamet
 * 2026-09-29: 5 minuter i dev, 28 dagar/fyra veckor i prod) — det måste
 * synas, annars tror man att bytet skett direkt.
 *
 * Ett schemalagt byte går att avbryta (fick stöd i API:t 2026-09-29): den
 * väntande versionen (badgen "Aktiveras …") får en "Avbryt"-knapp som bara
 * rör SCHEMALÄGGNINGEN — den gällande versionen fortsätter gälla utan
 * slutdatum, och den avbrutna versionen blir en vanlig inaktiv version igen
 * (kan därefter arkiveras precis som vilken annan inaktiv version som helst).
 *
 * Arkivering (fick också stöd 2026-09-29) städar bort gamla, aldrig
 * aktiverade eller redan förbrukade versioner ur listan — bara gällande och
 * väntande version kan inte arkiveras direkt (avbryt bytet först).
 *
 * Bara ägare och systemadmin får göra något av detta, så listan visas för
 * alla men knapparna bara för dem.
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
  const [archivingVersion, setArchivingVersion] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [result, setResult] = useState<LayoutActivation | null>(null)
  const busy = busyVersion !== null || archivingVersion !== null || cancelling

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

  /**
   * Mjuk arkivering — bara inaktiva versioner (aldrig gällande/väntande, det
   * filtreras bort i knappen nedan). Ögonblicksbilden finns kvar i lagringen,
   * men försvinner ur listan och går inte att ångra via API:t, därför en
   * bekräftelse innan anropet (samma mönster som "Ta bort"-knapparna för
   * användare/rätter).
   */
  async function archive(version: number, label: string) {
    if (!window.confirm(`Arkivera ${label}? Går inte att ångra.`)) return
    setError(null)
    setArchivingVersion(version)
    try {
      await archiveLayoutVersion(locationId, version)
      setVersions((prev) => prev?.filter((v) => v.version !== version) ?? prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte arkivera versionen.')
    } finally {
      setArchivingVersion(null)
    }
  }

  /**
   * Avbryter det väntande bytet (utan att röra vilken version som är vald
   * för det) — den gällande versionen fortsätter gälla utan slutdatum, och
   * den väntande versionen blir en vanlig inaktiv version igen (går då att
   * arkivera precis som vilken annan inaktiv version som helst). Läser om
   * listan efteråt eftersom både den gällande och den väntande versionens
   * lifecycle-fält ändras.
   */
  async function cancelPending() {
    if (!window.confirm('Avbryta det schemalagda bytet?')) return
    setError(null)
    setResult(null)
    setCancelling(true)
    try {
      await cancelPendingLayoutActivation(locationId)
      setVersions(await listLayoutVersions(locationId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte avbryta bytet.')
    } finally {
      setCancelling(false)
    }
  }

  // En väntande version har ett framtida effectiveFrom men gäller inte än.
  const pendingVersion = versions?.find(
    (v) => !v.isCurrent && v.effectiveFrom && new Date(v.effectiveFrom) > new Date(),
  )
  const currentVersion = versions?.find((v) => v.isCurrent)

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

        {pendingVersion && (
          <p className="pending-version-notice">
            <strong>Bara {currentVersion ? currentVersion.label : 'den nuvarande versionen'} gäller just nu.</strong>{' '}
            {pendingVersion.label} tar över automatiskt
            {pendingVersion.effectiveFrom
              ? ` den ${formatShortDate(pendingVersion.effectiveFrom)}`
              : ''}{' '}
            — inte förrän dess.
          </p>
        )}

        {versions === null && <p className="cell-muted">Hämtar versioner…</p>}

        {versions?.length === 0 && !error && (
          <p className="cell-muted">
            Inga publicerade versioner än. Publicera layouten först.
          </p>
        )}

        {versions && versions.length > 0 && (
          <div className="versions-list">
            {versions.map((v) => {
              const isPending = pendingVersion?.version === v.version
              return (
                <div className="version-row" key={v.version}>
                  <div className="version-row-main">
                    <span className="cell-strong">{v.label}</span>
                    <span className="cell-muted">{v.elements.length} element</span>
                  </div>
                  <div className="version-row-right">
                    {v.isCurrent ? (
                      <span className="status-badge reserved">Gäller nu</span>
                    ) : isPending ? (
                      <span className="status-badge pending-version">
                        Aktiveras {v.effectiveFrom ? formatShortDate(v.effectiveFrom) : ''}
                      </span>
                    ) : (
                      <span className="cell-muted">Inaktiv</span>
                    )}
                    {canActivate && isPending && (
                      <button
                        type="button"
                        className="link-action danger"
                        disabled={busy}
                        onClick={cancelPending}
                      >
                        {cancelling ? 'Avbryter…' : 'Avbryt'}
                      </button>
                    )}
                    {canActivate && !v.isCurrent && !isPending && (
                      <>
                        <button
                          type="button"
                          className="link-action"
                          disabled={busy}
                          onClick={() => activate(v.version)}
                        >
                          {busyVersion === v.version ? 'Aktiverar…' : 'Aktivera'}
                        </button>
                        <button
                          type="button"
                          className="link-action danger"
                          disabled={busy}
                          onClick={() => archive(v.version, v.label)}
                        >
                          {archivingVersion === v.version ? 'Arkiverar…' : 'Arkivera'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
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
