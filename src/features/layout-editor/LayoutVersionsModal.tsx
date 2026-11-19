import { errorText } from '../../shared/errors'
import { useEffect, useId, useState } from 'react'
import {
  BookingsOnRemovedTablesError,
  activateLayoutVersion,
  archiveLayoutVersion,
  cancelPendingLayoutActivation,
  loadLayoutVersions,
  reschedulePendingLayoutActivation,
} from './layoutApi'
import type { LayoutActivation, LayoutVersionList, RemovedTableBooking } from './layoutApi'
import { SkelRows } from '../../shared/Skeleton'
import ModalOverlay from '../../shared/ModalOverlay'
import { useConfirm } from '../../shared/ConfirmDialog'
import { ErrorNote } from '../../shared/ErrorNote'
import { DateInput } from '../../shared/DateInput'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { RemovedTablesBookings } from './RemovedTablesBookings'
import { daysUntil, earliestDate, localDate, longDate, shortDate, sizeText, versionTimeline } from './versionTimeline'
import type { TimelineEntry } from './versionTimeline'
import { BackButton } from '../../shared/BackButton'

/** "om 22 dagar", "imorgon", "idag". */
function inDays(date: string): string {
  const n = daysUntil(date)
  if (n <= 0) return 'idag'
  if (n === 1) return 'imorgon'
  return `om ${n} dagar`
}

type Planning = { version: number; mode: 'activate' | 'move'; date: string }

/**
 * Versioner som en tidslinje: den som gäller nu, sedan den som tar över (med
 * datum), sist de som inte är inplanerade. Varje knapp säger vad den gör.
 *
 * Ett byte till en ny ritning sker tidigast dagen efter bokningsfönstret
 * (gäster bokar 21 dagar fram), så ingen bokning hamnar på en ritning som
 * ändrats under den. Bara ett byte kan vänta åt gången: att planera in en
 * annan version avbryter först det väntande bytet (efter en fråga).
 *
 * Bara ägare och systemadmin får ändra något, så listan visas för alla men
 * knapparna bara för dem.
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
  const titleId = useId()
  const [confirmEl, ask] = useConfirm()
  const [list, setList] = useState<LayoutVersionList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState<RemovedTableBooking[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [planning, setPlanning] = useState<Planning | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadLayoutVersions(locationId)
      .then((l) => {
        if (!cancelled) setList(l)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorText(err, 'Versionerna kunde inte visas.'))
          setList({ items: [], earliestChangeDate: null, bookingHorizonDays: 21 })
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  const entries = list ? versionTimeline(list.items) : []
  const current = entries.find((e) => e.kind === 'current')
  const next = entries.find((e) => e.kind === 'next')
  const planned = entries.filter((e) => e.kind !== 'unscheduled')
  const saved = entries.filter((e) => e.kind === 'unscheduled')
  const earliest = list ? earliestDate(list) : ''

  async function run(key: string, work: () => Promise<string | null>) {
    setError(null)
    setRemoved([])
    setResult(null)
    setBusy(key)
    try {
      const done = await work()
      setPlanning(null)
      setResult(done)
      setList(await loadLayoutVersions(locationId))
      onActivated()
    } catch (err) {
      setError(errorText(err, 'Det gick inte. Försök igen.'))
      if (err instanceof BookingsOnRemovedTablesError) setRemoved(err.bookings)
    } finally {
      setBusy(null)
    }
  }

  const outcome = (label: string, a: LayoutActivation) =>
    a.status === 'active' ? `${label} gäller nu.` : `Klart. ${label} tar över ${longDate(a.cutoverAt)}.`

  function activateNow(e: TimelineEntry) {
    void run(`now-${e.snapshot.version}`, async () =>
      outcome(e.snapshot.label, await activateLayoutVersion(locationId, e.snapshot.version)),
    )
  }

  async function confirmPlan(e: TimelineEntry, p: Planning) {
    const label = e.snapshot.label
    if (p.mode === 'move') {
      void run(`plan-${p.version}`, async () =>
        outcome(label, await reschedulePendingLayoutActivation(locationId, p.date)),
      )
      return
    }
    if (next) {
      const ok = await ask({
        title: `Byta ut ${next.snapshot.label}?`,
        text: `${next.snapshot.label} tar inte över ${longDate(next.from!)}. ${label} tar över ${longDate(p.date)} i stället.`,
        confirmLabel: `Ja, ${label}`,
        cancelLabel: 'Nej',
      })
      if (!ok) return
    }
    void run(`plan-${p.version}`, async () => {
      if (next) await cancelPendingLayoutActivation(locationId)
      return outcome(label, await activateLayoutVersion(locationId, p.version, p.date))
    })
  }

  async function cancelNext(e: TimelineEntry) {
    const ok = await ask({
      title: `Stoppa bytet till ${e.snapshot.label}?`,
      text: `${current?.snapshot.label ?? 'Nuvarande version'} fortsätter gälla. ${e.snapshot.label} sparas och kan planeras in igen.`,
      confirmLabel: 'Stoppa bytet',
      cancelLabel: 'Behåll',
    })
    if (!ok) return
    void run('cancel', async () => {
      await cancelPendingLayoutActivation(locationId)
      return `Bytet är stoppat. ${current?.snapshot.label ?? 'Nuvarande version'} gäller.`
    })
  }

  async function remove(e: TimelineEntry) {
    const ok = await ask({
      title: `Ta bort ${e.snapshot.label}?`,
      text: 'Den försvinner ur listan. Det går inte att ångra.',
      confirmLabel: 'Ta bort',
      danger: true,
    })
    if (!ok) return
    void run(`remove-${e.snapshot.version}`, async () => {
      await archiveLayoutVersion(locationId, e.snapshot.version)
      return `${e.snapshot.label} är borttagen.`
    })
  }

  const summary = !list || list.items.length === 0
    ? null
    : current && next
      ? <><strong>Nu gäller {current.snapshot.label}.</strong> {next.snapshot.label} tar över av sig själv {longDate(next.from!)} ({inDays(localDate(next.from!))}).</>
      : current
        ? <><strong>Nu gäller {current.snapshot.label}.</strong> Inget byte är inplanerat.</>
        : <><strong>Ingen version gäller än.</strong> Välj en, så kan gäster boka bord.</>

  function row(e: TimelineEntry) {
    const v = e.snapshot.version
    const label = e.snapshot.label
    const open = planning?.version === v
    const meta = [
      sizeText(e),
      e.endedAt ? `gällde till ${shortDate(e.endedAt)}` : `publicerad ${shortDate(e.snapshot.createdAt)}`,
    ].join(' · ')
    return (
      <li key={v} className={`vt-row vt-${e.kind}`}>
        <span className="vt-dot" aria-hidden="true" />
        <div className="vt-body">
          <div className="vt-head">
            <span className="vt-name">{label}</span>
            {e.kind === 'current' && <span className="vt-stamp vt-stamp-now">Gäller nu</span>}
            {e.kind === 'next' && e.from && (
              <span className="vt-stamp vt-stamp-next">Från {shortDate(e.from)}</span>
            )}
          </div>
          <p className="vt-meta">{meta}</p>

          {canActivate && !open && e.kind === 'next' && (
            <div className="vt-actions">
              <button type="button" className="link-action" disabled={busy !== null}
                onClick={() => setPlanning({ version: v, mode: 'move', date: localDate(e.from!) })}>
                Ändra datum
              </button>
              <button type="button" className="link-action danger" disabled={busy !== null} onClick={() => cancelNext(e)}>
                {busy === 'cancel' ? 'Stoppar…' : 'Stoppa bytet'}
              </button>
            </div>
          )}
          {canActivate && !open && e.kind === 'unscheduled' && (
            <div className="vt-actions">
              {current ? (
                <button type="button" className="link-action strong" disabled={busy !== null}
                  onClick={() => setPlanning({ version: v, mode: 'activate', date: earliest })}>
                  Välj datum för bytet
                </button>
              ) : (
                <button type="button" className="link-action strong" disabled={busy !== null} onClick={() => activateNow(e)}>
                  {busy === `now-${v}` ? 'Aktiverar…' : 'Använd nu'}
                </button>
              )}
              <button type="button" className="link-action danger" disabled={busy !== null} onClick={() => remove(e)}>
                {busy === `remove-${v}` ? 'Tar bort…' : 'Ta bort'}
              </button>
            </div>
          )}

          {open && planning && (
            <div className="vt-plan">
              <label className="vt-plan-label" htmlFor={`vt-date-${v}`}>
                {label} tar över
              </label>
              <DateInput
                id={`vt-date-${v}`}
                inputClassName="bq-input"
                value={planning.date}
                min={earliest}
                onChange={(ev) => setPlanning({ ...planning, date: ev.target.value })}
              />
              <p className="vt-plan-why">
                Tidigast {longDate(earliest)}.
                <InfoTooltip label="Varför tidigast">
                  Gäster kan boka {list?.bookingHorizonDays ?? 21} dagar fram. Bytet sker dagen efter, så
                  ingen bokning hamnar på en ritning som ändrats.
                </InfoTooltip>
              </p>
              {planning.mode === 'activate' && next && (
                <p className="vt-plan-replaces">Bytet till {next.snapshot.label} {shortDate(next.from!)} stoppas.</p>
              )}
              <div className="vt-plan-actions">
                <BackButton disabled={busy !== null} onClick={() => setPlanning(null)} />
                <button type="button" className="btn primary square"
                  disabled={busy !== null || !planning.date || planning.date < earliest}
                  onClick={() => confirmPlan(e, planning)}>
                  {busy === `plan-${v}`
                    ? 'Sparar…'
                    : planning.date
                      ? `Byt ${shortDate(planning.date)}`
                      : 'Välj ett datum'}
                </button>
              </div>
            </div>
          )}
        </div>
      </li>
    )
  }

  return (
    <>
      <ModalOverlay role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal versions-modal">
          <h2 id={titleId}>Versioner</h2>

          {summary && <p className="versions-summary" role="status">{summary}</p>}

          <ErrorNote text={error} />
          {error && removed.length > 0 && (
            <RemovedTablesBookings locationId={locationId} bookings={removed} />
          )}
          {result && <p className="save-notice" role="status">{result}</p>}

          {list === null && <SkelRows n={4} cols={2} />}

          {list?.items.length === 0 && !error && (
            <p className="cell-muted">Inga versioner än. Tryck Publicera layout först.</p>
          )}

          {planned.length > 0 && <ol className="version-timeline" aria-label="Gäller och nästa">{planned.map(row)}</ol>}

          {saved.length > 0 && (
            <section className="versions-saved" aria-labelledby={`${titleId}-saved`}>
              <h3 id={`${titleId}-saved`}>{current ? 'Inte inplanerade' : 'Publicerade'}</h3>
              <ol className="version-timeline">{saved.map(row)}</ol>
            </section>
          )}

          {!canActivate && list && list.items.length > 0 && (
            <p className="cell-muted">Bara ägare och systemadmin kan byta version.</p>
          )}

          <div className="modal-actions modal-actions--pinned">
            <button type="button" className="btn outline square" onClick={onClose}>
              Stäng
            </button>
          </div>
        </div>
      </ModalOverlay>
      {confirmEl}
    </>
  )
}
