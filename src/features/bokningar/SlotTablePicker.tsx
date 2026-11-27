import { useEffect, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { dayNotice, errorMessage, getAvailability, lastBookableDate, LOCATION_NOT_BOOKABLE } from './bookingsApi'
import type { AvailabilitySlot, DayStatus } from './bookingsApi'
import { tableNames, tableTitle } from '../../shared/tables'
import { DateInput } from '../../shared/DateInput'
import { ErrorNote } from '../../shared/ErrorNote'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { Select } from '../../shared/Select'
import { loadActiveLayout, loadVersionPlans } from '../layout-editor/activeLayout'
import type { ActivePlan, VersionPlans } from '../layout-editor/activeLayout'
import type { TableElement } from '../layout-editor/data'
import { FloorMap, FloorTabs } from '../layout-editor/FloorMap'
import type { TableView } from '../layout-editor/FloorMap'
import './slot-map.css'

/** Hur ofta listan med lediga tider hämtas om medan formuläret är öppet. */
export const SLOT_REFRESH_MS = 60_000

export interface SlotValue {
  date: string
  startTime: string
  tableIds: string[]
}

/**
 * Datum, tid och bord för en ny eller flyttad bokning, från platsens lediga
 * tider (GET /availability) - samma tider som servern godkänner: hel- och
 * halvtimmar, minst 30 minuter fram. `walkIn` (drop-in) tar även med
 * pågående tider och de inom 30 minuter, och låser datumet till idag.
 *
 * `keep` = bokningens egen tid och egna bord när den redigeras: de räknas
 * som lediga för den själv (servern ignorerar bokningens egna bord), även
 * om tiden är pågående eller från ett äldre schema.
 *
 * Listan hämtas om varje minut och när `refreshKey` ändras. Försvinner den
 * valda tiden (eller ett valt bord) tas valet bort med en förklaring, så att
 * ingen skickar en tid som inte går längre.
 *
 * Borden väljs på platsens publicerade bordskarta (2D, samma numrering som
 * gästsajten och Layout): tryck på ett eller flera lediga bord. Personalen
 * får kombinera alla lediga bord (gästernas regler för bord online gäller
 * inte här). Kartan hämtas en gång per plats, inte för varje tid; gick det
 * inte hämtas den igen med Försök igen, varje minut och när nätet är tillbaka.
 * Efter ett inbokat versionsbyte gäller den nya versionens bord: finns ett
 * bord i tiden som inte står i dagens karta hämtas versionerna (en gång) och
 * tidens version ritas. Ett ledigt bord som ändå saknas i kartan visas inte;
 * ett valt bord som saknas (bokningens eget) står under kartan och går att
 * ta bort. En avvikande dag (stängt, andra tider, ingen onlinebokning)
 * förklaras ovanför tiderna.
 */
export function SlotTablePicker({
  locationId,
  date,
  startTime,
  tableIds,
  partySize,
  today,
  keep,
  walkIn = false,
  refreshKey = 0,
  onChange,
  onSeats,
}: {
  locationId: string
  date: string
  startTime: string
  tableIds: string[]
  partySize: number
  /** Dagens datum i platsens tidszon (YYYY-MM-DD). */
  today: string
  /** Bokningens egen tid och egna bord (och deras platser totalt). */
  keep?: { date: string; startTime: string; tableIds: string[]; seats?: number }
  walkIn?: boolean
  refreshKey?: number
  onChange: (next: SlotValue) => void
  /** Valda bords platser (null = okänt än), så formuläret kan stänga av Spara när de inte rymmer sällskapet. */
  onSeats?: (seats: number | null) => void
}) {
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [day, setDay] = useState<DayStatus | null>(null)
  // Bordskartan för en plats: planen eller felet. Ett nytt försök visar felet
  // tills svaret kommer (utom när personalen själv trycker Försök igen).
  const [planRes, setPlanRes] = useState<{ loc: string; plan: ActivePlan | null; error: string | null } | null>(null)
  const [planTry, setPlanTry] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [versions, setVersions] = useState<{ loc: string; plans: VersionPlans } | null>(null)
  const versionsAsked = useRef<string | null>(null)
  const [floorId, setFloorId] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slotNotice, setSlotNotice] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const requestKey = `${locationId}|${date}|${walkIn}`

  // Den senaste valda tiden/borden - läses när en ny lista kommer, utan att
  // varje val startar en ny hämtning.
  const planFailed = planRes?.loc === locationId && planRes.error !== null
  const latest = useRef({ date, startTime, tableIds, keep, onChange, planFailed })
  useEffect(() => {
    latest.current = { date, startTime, tableIds, keep, onChange, planFailed }
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((n) => n + 1)
      // Kartan som inte gick att hämta försöks igen med tiderna.
      if (latest.current.planFailed) setPlanTry((n) => n + 1)
    }, SLOT_REFRESH_MS)
    const online = () => {
      if (latest.current.planFailed) setPlanTry((n) => n + 1)
    }
    window.addEventListener('online', online)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', online)
    }
  }, [])

  // Bordskartan: en gång per plats (och vid ett nytt försök), inte för varje tid.
  useEffect(() => {
    let live = true
    loadActiveLayout(locationId).then(
      (p) => {
        if (!live) return
        setPlanRes({ loc: locationId, plan: p, error: null })
        setRetrying(false)
      },
      (err) => {
        if (!live) return
        setPlanRes({ loc: locationId, plan: null, error: errorMessage(err, 'Bordskartan kunde inte visas.', LOCATION_NOT_BOOKABLE) })
        setRetrying(false)
      },
    )
    return () => {
      live = false
    }
  }, [locationId, planTry])

  useEffect(() => {
    let cancelled = false
    getAvailability(locationId, date, { walkIn })
      .then((result) => {
        if (cancelled) return
        const fresh = result.slots
        setSlots(fresh)
        setDay(result.day)
        setError(null)
        setLoadedFor(requestKey)
        const cur = latest.current
        if (cur.date !== date || !cur.startTime) return
        const own = cur.keep && cur.keep.date === date && cur.keep.startTime === cur.startTime
          ? cur.keep
          : null
        const slot = fresh.find((s) => s.startTime === cur.startTime)
        if (!slot && !own) {
          setSlotNotice(`${cur.startTime} går inte att boka längre - välj en ny tid.`)
          cur.onChange({ date, startTime: '', tableIds: [] })
          return
        }
        const free = new Set([...(slot?.tables ?? []).map((t) => t.tableId), ...(own?.tableIds ?? [])])
        const still = cur.tableIds.filter((id) => free.has(id))
        if (still.length !== cur.tableIds.length) {
          setSlotNotice('Ett valt bord har hunnit bokas - välj bord igen.')
          cur.onChange({ date, startTime: cur.startTime, tableIds: still })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setSlots([])
        setDay(null)
        setError(errorMessage(err, 'Lediga tider kunde inte visas.', LOCATION_NOT_BOOKABLE))
        setLoadedFor(requestKey)
      })
    return () => {
      cancelled = true
    }
  }, [locationId, date, walkIn, requestKey, refreshKey, tick])

  const loading = loadedFor !== requestKey
  const ownSlot = keep && keep.date === date ? keep : null
  const times = (loading ? [] : (slots ?? [])).map((s) => s.startTime)
  if (ownSlot && !times.includes(ownSlot.startTime)) times.push(ownSlot.startTime)
  times.sort()

  const slot = loading ? undefined : (slots ?? []).find((s) => s.startTime === startTime)
  const ownIds = ownSlot && ownSlot.startTime === startTime ? ownSlot.tableIds : []
  const res = planRes?.loc === locationId ? planRes : null
  const active = res?.plan ?? null
  const hasTables = (p: ActivePlan | null): p is ActivePlan => Boolean(p && p.floors.some((f) => f.tables.length > 0))
  const planState: 'loading' | 'error' | 'none' | 'ready' =
    !res || retrying ? 'loading' : res.error ? 'error' : hasTables(active) ? 'ready' : 'none'

  // Tidens bord som inte står i dagens karta: efter ett inbokat versionsbyte
  // gäller den nya versionens bord. Då hämtas versionerna, en gång per plats.
  const activeIds = new Set((active?.floors ?? []).flatMap((f) => f.tables.map((t) => t.id)))
  const wanted = [...(slot?.tables ?? []).map((t) => t.tableId), ...ownIds]
  const needVersions = planState === 'ready' && wanted.some((id) => !activeIds.has(id))
  useEffect(() => {
    if (!needVersions || versionsAsked.current === locationId) return
    versionsAsked.current = locationId
    const loc = locationId
    loadVersionPlans(loc).then(
      (plans) => setVersions({ loc, plans }),
      // Utan versionerna ritas dagens karta; borden som saknas visas inte.
      () => setVersions({ loc, plans: { current: null, plans: new Map() } }),
    )
  }, [needVersions, locationId])
  const vp = versions?.loc === locationId ? versions.plans : null
  let plan: ActivePlan | null = active
  let newVersion = false
  if (vp && planState === 'ready') {
    const v = slot?.layoutVersion
    const byVersion = v !== undefined && v !== vp.current ? vp.plans.get(v) : undefined
    // Den egna tiden utan lediga bord kan sakna version: välj den som har bokningens bord.
    const byOwn =
      !slot && ownIds.some((id) => !activeIds.has(id))
        ? [...vp.plans].find(([n, p]) => n !== vp.current && ownIds.every((id) => p.labels.has(id)))?.[1]
        : undefined
    const other = byVersion ?? byOwn
    if (hasTables(other ?? null)) {
      plan = other!
      newVersion = true
    }
  }
  const mapTables = planState === 'ready' && plan ? plan.floors.flatMap((f) => f.tables) : []
  const mapIds = new Set(mapTables.map((t) => t.id))
  const layoutSeats = new Map(mapTables.map((t) => [t.id, t.seats]))
  const tables = [...(slot?.tables ?? [])]
  if (ownSlot && ownSlot.startTime === startTime) {
    for (const id of ownSlot.tableIds) {
      // Bokningens egna bord är inte lediga i listan; platserna står i kartan.
      if (!tables.some((t) => t.tableId === id)) tables.push({ tableId: id, seats: layoutSeats.get(id) ?? 0 })
    }
  }
  const freeIds = new Set(tables.map((t) => t.tableId))
  const notice = loading ? null : dayNotice(day)
  const chosen = tables.filter((t) => tableIds.includes(t.tableId))
  // Ett eget bord som inte finns i kartan har okända platser (0) här - då
  // gäller summan för alla egna bord (keep.seats). Väljs bara en del av dem
  // avgör servern, och ingen siffra visas.
  const ownChosen = chosen.filter((t) => ownIds.includes(t.tableId) && t.seats === 0)
  const otherSeats = chosen
    .filter((t) => !ownChosen.includes(t))
    .reduce((sum, t) => sum + t.seats, 0)
  const allOwnChosen = ownChosen.length > 0 && ownIds.every((id) => tableIds.includes(id))
  const seatsKnown =
    chosen.length > 0 &&
    (ownChosen.length === 0 || (allOwnChosen && typeof ownSlot?.seats === 'number'))
  const seats = otherSeats + (ownChosen.length > 0 ? (ownSlot?.seats ?? 0) : 0)
  const reportedSeats = seatsKnown ? seats : null
  const onSeatsRef = useRef(onSeats)
  useEffect(() => {
    onSeatsRef.current = onSeats
  })
  useEffect(() => {
    onSeatsRef.current?.(reportedSeats)
  }, [reportedSeats])

  // Våningen som visas: den personalen valt, annars först den med ett valt
  // bord. Den hålls sedan kvar, också när borden på den väljs bort.
  const floors = planState === 'ready' && plan ? plan.floors : []
  const floor =
    floors.find((f) => f.id === floorId) ??
    floors.find((f) => f.tables.some((t) => tableIds.includes(t.id))) ??
    floors.find((f) => f.tables.length > 0) ??
    null
  if (floor && floor.id !== floorId) setFloorId(floor.id)
  const label = (t: TableElement) => plan?.labels.get(t.id) ?? t.label
  // Valda bord som inte står i kartan (bokningens eget bord i en annan version).
  const offMap = planState === 'ready' || planState === 'none' ? tableIds.filter((id) => !mapIds.has(id)) : []

  function retryPlan() {
    setRetrying(true)
    setPlanTry((n) => n + 1)
  }

  function pick(next: SlotValue) {
    setSlotNotice(null)
    onChange(next)
  }

  function toggle(id: string) {
    const next = tableIds.includes(id) ? tableIds.filter((t) => t !== id) : [...tableIds, id]
    pick({ date, startTime, tableIds: next })
  }

  const roomyFree = partySize > 0 && mapTables.some((t) => freeIds.has(t.id) && t.seats >= partySize)
  // Sällskapet är större än bordet och ett ledigt bord rymmer det: det lilla
  // bordet väljs inte först (att slå ihop bord går när inget annat rymmer
  // sällskapet, eller när ett bord redan är valt).
  const isTooSmall = (t: TableElement) =>
    (freeIds.has(t.id) || tableIds.includes(t.id)) &&
    !tableIds.includes(t.id) &&
    t.seats < partySize &&
    tableIds.length === 0 &&
    roomyFree
  const anyTooSmall = mapTables.some(isTooSmall)

  /** Ledigt (går att välja), valt, eller upptaget den tiden (randigt, går inte att välja). */
  function tableView(t: TableElement): TableView {
    const selected = tableIds.includes(t.id)
    // Ett valt bord som hunnit bokas går ändå att välja bort.
    const open = freeIds.has(t.id) || selected
    const tooSmall = isTooSmall(t)
    return {
      state: open ? 'free' : 'full',
      selected,
      focusable: true,
      disabled: !open || tooSmall,
      name: `${tableTitle(label(t))}, ${t.seats} pl, ${selected ? 'valt' : tooSmall ? 'för litet' : open ? 'ledigt' : 'upptaget'}`,
      onPick: () => {
        if (open && !tooSmall) toggle(t.id)
      },
    }
  }

  return (
    <div className="slot-picker">
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="slot-date">Datum</label>
          <DateInput
            id="slot-date"
            value={date}
            min={today}
            max={lastBookableDate(today)}
            disabled={walkIn}
            onChange={(e) =>
              e.target.value && pick({ date: e.target.value, startTime: '', tableIds: [] })
            }
          />
          {walkIn && <p className="field-hint">Drop-in bokas alltid idag.</p>}
        </div>
        <div className="form-field">
          <label htmlFor="slot-time">Tid</label>
          <Select
            id="slot-time"
            value={startTime}
            disabled={loading || times.length === 0}
            onChange={(e) => {
              const same = ownSlot && ownSlot.startTime === e.target.value
              pick({ date, startTime: e.target.value, tableIds: same ? ownSlot.tableIds : [] })
            }}
          >
            <option value="">
              {loading ? 'Hämtar tider…' : times.length === 0 ? 'Inga lediga tider' : 'Välj tid'}
            </option>
            {times.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {notice && (
        <p className="field-hint" role="note">
          {notice}
        </p>
      )}
      {slotNotice && (
        <p className="form-error" role="status">
          {slotNotice}
        </p>
      )}
      {error && (
        <ErrorNote text={error} />
      )}
      {startTime && !loading && (
        <div className="table-picker slot-map floor-map-scope" role="group" aria-label="Bordskarta">
          <p className="form-section-label">Bord</p>
          {planState === 'loading' && <Loading label="Hämtar bordskartan" />}
          {/* Också utan nät går kartan att hämta igen (inget annat hämtar den). */}
          {planState === 'error' && <ErrorNote text={res?.error} onRetry={retryPlan} alwaysRetry />}
          {planState === 'none' && <NoLayoutNote />}
          {planState === 'ready' && floor && (
            <>
              {newVersion && <p className="field-hint">Ny bordskarta från den här dagen.</p>}
              {!mapTables.some((t) => freeIds.has(t.id)) && <p className="cell-muted">Inga lediga bord den tiden.</p>}
              <div className="slot-map-bar">
                {floors.length > 1 && (
                  <FloorTabs
                    floors={floors}
                    activeId={floor.id}
                    onPick={setFloorId}
                    className="slot-map-tabs"
                    markIds={tableIds}
                    markClass="has-selected"
                    markText="valda bord"
                  />
                )}
                <div className="floor-map-legend" aria-hidden="true">
                  <span className="legend-free">Ledigt</span>
                  <span className="legend-selected">Valt</span>
                  <span className="legend-full">Upptaget</span>
                </div>
              </div>
              <FloorMap floor={floor} label={label} view={tableView} hitPad={30} minHitPx={44} minSeatPx={9} />
              <p className="slot-map-chosen" aria-live="polite">
                {tableIds.length > 0 ? tableNames(tableIds, plan?.labels ?? null) : 'Inget bord valt'}
              </p>
            </>
          )}
          {offMap.length > 0 && (
            <ul className="slot-map-offmap" aria-label="Bord utanför kartan">
              {offMap.map((id) => (
                <li key={id}>
                  <button type="button" className="btn outline square" aria-label="Ta bort borttaget bord" onClick={() => toggle(id)}>
                    Borttaget bord
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {anyTooSmall && <p className="cell-muted">Ett ledigt bord rymmer sällskapet. Välj det först.</p>}
          {seatsKnown && (
            <p className={seats < partySize ? 'form-error' : 'cell-muted'}>
              {seats < partySize
                ? `Valda bord har ${seats} platser - sällskapet är ${partySize}.`
                : `Valda bord har ${seats} platser.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Ingen publicerad bordskarta: inga bord att boka förrän en layout publiceras. */
function NoLayoutNote() {
  const inRouter = useInRouterContext()
  return (
    <p className="cell-muted" role="note">
      Ingen bordskarta än. Publicera en layout under{' '}
      {inRouter ? <Link to="/layout">Layout</Link> : <a href="/layout">Layout</a>}.
    </p>
  )
}
