import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bar, Button, Modal } from '@booqy/brand'
import { AdminTopbar } from '../../../shared/AdminTopbar'
import { ApiError, isApiConfigured } from '../../../shared/api'
import { BackButton } from '../../../shared/BackButton'
import { usePhoneNav } from '../../../shared/dock'
import { ErrorNote } from '../../../shared/ErrorNote'
import { booqyFaultText } from '../../../shared/errors'
import { Icon } from '../../../shared/Icon'
import { useLiveRefresh } from '../../../shared/live'
import { Loading } from '../../../shared/Loading'
import { useLocationId } from '../../../shared/location'
import { NoLocation } from '../../../shared/NoLocation'
import { tableTitle } from '../../../shared/tables'
import { useTenant } from '../../../shared/tenant'
import { useAuth } from '../../auth/useAuth'
import type { Floor } from '../../layout-editor/data'
import { flyToPrinter } from '../../printers/fly'
import {
  addLine,
  cartCount,
  cartTotal,
  coursesIn,
  makeLine,
  MAX_LINES,
  needsOptions,
  reconcile,
  replaceLine,
  setQuantity,
  toNewItems,
} from './cart'
import type { CartLine, LineExtra } from './cart'
import { COURSE_LABEL, defaultHold } from './courses'
import { clearDraft, loadDraft, loadPickerView, saveDraft, savePickerView } from './draft'
import type { Draft, PickerView } from './draft'
import { ItemEditor } from './ItemEditor'
import { addToTabPath, boardPath, newOrderPath } from './links'
import { MenuGrid } from './MenuGrid'
import { OptionSheet } from './OptionSheet'
import { joinNames, OrderSummary, SendPreview } from './OrderSummary'
import { SendBar } from './SendBar'
import { TablePicker } from './TablePicker'
import {
  addItems,
  editTab,
  getFloorPlan,
  getTabMenu,
  listTabs,
  newRequestId,
  pollVersion,
  openTab,
  redispatchRound,
  TAB_POLL_MS,
  tabErrorText,
} from './tableOrderApi'
import type { Course, NewItem, SendResult, Tab, TableState, TabMenu, TabMenuItem, TabsResponse } from './types'
import './takeOrder.css'

/** Mock mode has no locations (local demo tenant); the mock store ignores the id. */
const MOCK_LOCATION = 'mock'
const GUEST_MAX = 60
const COVERS_MAX = 50
/** Back to the Bord view this long after a clean send. */
const DONE_MS = 1600

type Layout = 'phone' | 'sheet' | 'split' | 'monitor'

interface Inflight {
  requestId: string
  kind: 'open' | 'add'
  tabId: string | null
  tableId: string
  items: NewItem[]
  covers?: number
  guestName?: string
  reservationId?: string
  /** line key -> quantity sent, so only what was sent leaves the cart */
  sent: Map<string, number>
}

interface Done {
  result: SendResult
  stationNames: string[]
  held: { course: Course; quantity: number }[]
}

function covered(lines: CartLine[], sent: Map<string, number>): CartLine[] {
  return lines
    .map((l) => (sent.has(l.key) ? { ...l, quantity: l.quantity - sent.get(l.key)! } : l))
    .filter((l) => l.quantity > 0)
}

/** Network trouble or Booqy's fault: the request may have arrived, retry with the same id. */
function ambiguous(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true
  return err.status === 0 || err.status >= 500 || err.status === 429 || err.code === 'timeout'
}

/**
 * Ny bordsbeställning: a waiter at the table picks the table, taps what the
 * guests order from the whole active menu and sends it. Food goes to the
 * kitchen and drinks to the bar as tickets; courses can wait and be fired
 * later from Beställningar > Bord. Nobody pays here: the guests pay in the
 * restaurant's own POS afterwards and staff close the order there.
 */
export default function TakeOrderPage() {
  const { sub } = useAuth()
  const { locationId: realLocation, resolving } = useLocationId(sub)
  const locationId = realLocation ?? (isApiConfigured() ? null : MOCK_LOCATION)
  const isOwner = useTenant().tenant?.role === 'owner_user'
  const { tabId: routeTabId } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const phone = usePhoneNav()

  const [data, setData] = useState<TabsResponse | null>(null)
  const version = useRef<number | undefined>(undefined)
  const lastFull = useRef<{ at: number; tabs: Tab[] }>({ at: 0, tabs: [] })
  const [menu, setMenu] = useState<TabMenu | null>(null)
  const [floors, setFloors] = useState<Floor[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [menuError, setMenuError] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const [lines, setLines] = useState<CartLine[]>([])
  const [holdOverride, setHoldOverride] = useState<Partial<Record<Course, boolean>>>({})
  const [covers, setCovers] = useState<number | null>(null)
  const [guestName, setGuestName] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const dirty = useRef(false)

  const [pickerView, setPickerView] = useState<PickerView>('karta')
  const [changingTable, setChangingTable] = useState(false)
  const [tableSheet, setTableSheet] = useState(false)
  const [optionFor, setOptionFor] = useState<TabMenuItem | null>(null)
  const [editing, setEditing] = useState<{ item: TabMenuItem; line: CartLine | null } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const inflight = useRef<Inflight | null>(null)
  const [retry, setRetry] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const sendButton = useRef<HTMLButtonElement | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  const [frame, setFrame] = useState<{ left: number; width: number } | null>(null)

  /* --- Data ---------------------------------------------------------------- */

  const refresh = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await listTabs(locationId, pollVersion(version.current, lastFull.current.tabs, lastFull.current.at))
      if ('unchanged' in res) return
      version.current = res.version
      lastFull.current = { at: Date.now(), tabs: res.tabs }
      setData(res)
      setLoadError(false)
    } catch {
      setLoadError(true)
      return false
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    version.current = undefined
    // Phones and tablets in portrait: the list (a whole floor plan is small there) unless the waiter chose the map.
    setPickerView(loadPickerView(locationId, window.innerWidth < 900 ? 'lista' : 'karta'))
    setDraft(loadDraft(locationId))
    void refresh()
    let cancelled = false
    getTabMenu(locationId).then(
      (m) => !cancelled && (setMenu(m), setMenuError(false)),
      () => !cancelled && setMenuError(true),
    )
    getFloorPlan(locationId).then(
      (f) => !cancelled && setFloors(f),
      () => !cancelled && setFloors([]),
    )
    return () => {
      cancelled = true
    }
  }, [locationId, refresh])

  // The table picker and the open order follow other waiters live (5 s, visible tab only).
  useLiveRefresh(refresh, { enabled: Boolean(locationId), everyMs: TAB_POLL_MS })
  // The menu follows Meny (a dish sold out) on the normal pulse.
  useLiveRefresh(
    () => locationId && getTabMenu(locationId).then((m) => setMenu(m)),
    { enabled: Boolean(locationId) },
  )

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  /* --- Layout -------------------------------------------------------------- */

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0) setWidth(r.width)
      setFrame((f) => (f && f.left === r.left && f.width === r.width ? f : { left: r.left, width: r.width }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const layout: Layout = phone ? 'phone' : width < 760 ? 'sheet' : width < 1250 ? 'split' : 'monitor'
  const sheetMode = layout === 'phone' || layout === 'sheet'

  // Side panel: from its top to the bottom of the screen, so Skicka never needs a scroll.
  const panelRef = useRef<HTMLElement | null>(null)
  const [panelKey, setPanelKey] = useState(0)
  const setPanel = useCallback((el: HTMLElement | null) => {
    if (el && el !== panelRef.current) {
      panelRef.current = el
      setPanelKey((k) => k + 1)
    }
  }, [])
  useEffect(() => {
    const el = panelRef.current
    if (!el || sheetMode) return
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = Math.max(el.getBoundingClientRect().top, 12)
        el.style.setProperty('--to-panel-h', `${Math.max(360, Math.round(window.innerHeight - top - 12))}px`)
      })
    }
    fit()
    window.addEventListener('scroll', fit, { capture: true, passive: true })
    window.addEventListener('resize', fit)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', fit, { capture: true })
      window.removeEventListener('resize', fit)
    }
  }, [sheetMode, panelKey])

  /* --- Selection ----------------------------------------------------------- */

  const tabs = useMemo(() => data?.tabs ?? [], [data])
  const tables = useMemo(() => data?.tables ?? [], [data])
  const routeTab = routeTabId ? tabs.find((t) => t.tabId === routeTabId) ?? null : null
  const tableId = routeTab ? routeTab.tableId : routeTabId ? null : search.get('bord')
  const table: TableState | null = tableId ? tables.find((t) => t.tableId === tableId) ?? null : null
  // A table with an open order always adds to it (even when reached by ?bord=).
  const tab: Tab | null = routeTab ?? (table?.tabId ? tabs.find((t) => t.tabId === table.tabId) ?? null : null)
  const routeTabGone = Boolean(routeTabId && data && !routeTab)
  const step: 'table' | 'menu' = !table || changingTable ? 'table' : 'menu'

  // A new table: covers and name from today's booking there (staff can change them).
  const prefilled = useRef<string | null>(null)
  useEffect(() => {
    if (!table || tab || prefilled.current === table.tableId) return
    prefilled.current = table.tableId
    const g = table.guest && !table.guest.upcoming ? table.guest : null
    // A restored draft marks its table as prefilled, so its own covers and name stay.
    setCovers(g?.partySize ?? null)
    setGuestName(g?.name ?? '')
  }, [table, tab])

  function pickTable(t: TableState) {
    setChangingTable(false)
    inflight.current = null
    setRetry(false)
    setError(null)
    setNotice(null)
    setDone(null)
    prefilled.current = null
    if (t.tabId) navigate(addToTabPath(t.tabId), { replace: Boolean(routeTabId || tableId) })
    else navigate(newOrderPath(t.tableId), { replace: Boolean(routeTabId || tableId) })
  }

  function changeView(v: PickerView) {
    setPickerView(v)
    if (locationId) savePickerView(locationId, v)
  }

  /* --- Cart ---------------------------------------------------------------- */

  const hold = useMemo(
    () => ({ ...defaultHold(coursesIn(lines), tab), ...holdOverride }),
    [lines, tab, holdOverride],
  )

  useEffect(() => {
    if (!locationId || !dirty.current) return
    saveDraft(locationId, {
      tableId: tableId ?? null,
      tabId: tab?.tabId ?? null,
      covers,
      guestName,
      lines,
      holds: holdOverride,
    })
  }, [locationId, lines, holdOverride, covers, guestName, tableId, tab])

  // The cart follows Meny: new prices and stations, sold out or deleted dishes
  // leave with a notice. Not while a failed send waits for Försök igen: that
  // retry must stay the very same request (the server answers for the dish).
  useEffect(() => {
    if (!menu || inflight.current || lines.length === 0) return
    const next = reconcile(lines, menu)
    if (!next.changed) return
    setLines(next.lines)
    if (next.dropped.length) {
      dirty.current = true
      setNotice(`${next.dropped.join(', ')} går inte att beställa just nu och togs bort.`)
    }
  }, [menu, lines])

  function edit(next: (prev: CartLine[]) => CartLine[]) {
    dirty.current = true
    setDone(null)
    setLines((prev) => {
      const out = next(prev)
      // Taking away something a failed send carried: that send is void, the next is new.
      const job = inflight.current
      if (job && [...job.sent].some(([key, q]) => (out.find((l) => l.key === key)?.quantity ?? 0) < q)) {
        inflight.current = null
        setRetry(false)
      }
      return out
    })
  }

  function add(item: TabMenuItem, extra: LineExtra = {}) {
    const line = makeLine(item, extra)
    if (!lines.some((l) => l.key === line.key) && lines.length >= MAX_LINES) {
      setNotice(`Högst ${MAX_LINES} rader per gång. Skicka först, lägg sedan till resten.`)
      return
    }
    setNotice(null)
    edit((prev) => addLine(prev, line))
  }

  function onTileAdd(item: TabMenuItem) {
    if (needsOptions(item)) setOptionFor(item)
    else add(item)
  }

  function onTileRemove(item: TabMenuItem) {
    const last = [...lines].reverse().find((l) => l.menuItemId === item.menuItemId)
    if (last) edit((prev) => setQuantity(prev, last.key, last.quantity - 1))
  }

  function restoreDraft() {
    if (!draft) return
    dirty.current = true
    setLines(draft.lines)
    setHoldOverride(draft.holds ?? {})
    setCovers(draft.covers)
    setGuestName(draft.guestName ?? '')
    setDraft(null)
    const target = draft.tabId && tabs.some((t) => t.tabId === draft.tabId)
      ? addToTabPath(draft.tabId)
      : draft.tableId ? newOrderPath(draft.tableId) : null
    prefilled.current = draft.tableId
    if (target) navigate(target, { replace: true })
  }

  /* --- Send ---------------------------------------------------------------- */

  async function send() {
    if (sendingRef.current || !locationId || !table || lines.length === 0) return
    let job = inflight.current
    if (!job || job.tableId !== table.tableId) {
      const g = table.guest && !table.guest.upcoming ? table.guest : null
      job = {
        requestId: newRequestId(),
        kind: tab ? 'add' : 'open',
        tabId: tab?.tabId ?? null,
        tableId: table.tableId,
        items: toNewItems(lines, hold),
        ...(!tab && covers ? { covers } : {}),
        ...(!tab && guestName.trim() ? { guestName: guestName.trim().slice(0, GUEST_MAX) } : {}),
        ...(!tab && g ? { reservationId: g.reservationId } : {}),
        sent: new Map(lines.map((l) => [l.key, l.quantity])),
      }
      inflight.current = job
    }
    sendingRef.current = true
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      const result = job.kind === 'open'
        ? await openTab(locationId, {
          requestId: job.requestId,
          tableId: job.tableId,
          items: job.items,
          ...(job.covers ? { covers: job.covers } : {}),
          ...(job.guestName ? { guestName: job.guestName } : {}),
          ...(job.reservationId ? { reservationId: job.reservationId } : {}),
        })
        : await addItems(locationId, job.tabId!, { requestId: job.requestId, items: job.items })
      const sent = job.sent
      inflight.current = null
      setRetry(false)
      // The ticket flies to where it went (the "Skickas till" chips), before they leave the screen.
      const from = sendButton.current
      if (from) for (const st of result.round?.stations ?? []) flyToPrinter(from, st.stationId)
      const rest = covered(lines, sent)
      setLines(rest)
      setHoldOverride({})
      if (rest.length === 0) {
        clearDraft(locationId)
        dirty.current = false
      }
      setSheetOpen(false)
      const held = coursesFor(result.tab)
      setDone({
        result,
        stationNames: (result.round?.stations ?? []).map((s) => s.stationName),
        held,
      })
      mergeTab(result.tab)
      if (routeTabId !== result.tab.tabId && job.kind === 'open') {
        navigate(addToTabPath(result.tab.tabId), { replace: true })
      }
      void refresh()
    } catch (err) {
      const info = tabErrorText(err)
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'table_has_open_order' && info.tab) {
        // Another waiter opened this table a moment ago: add to theirs, keep every tap.
        inflight.current = null
        setRetry(false)
        mergeTab(info.tab)
        navigate(addToTabPath(info.tab.tabId), { replace: true })
        setNotice(`${tableTitle(info.tab.tableLabel)} har redan en öppen beställning. Tryck Skicka så läggs rätterna till på den.`)
      } else if (code === 'tab_closed') {
        inflight.current = null
        setRetry(false)
        if (info.tab) mergeTab(info.tab)
        navigate(newOrderPath(job.tableId), { replace: true })
        setNotice('Beställningen på bordet är stängd. Tryck Skicka så öppnas en ny.')
      } else if (ambiguous(err)) {
        // It may have arrived: Försök igen sends the very same request (same requestId).
        setRetry(true)
        setError(info.text)
      } else {
        inflight.current = null
        setRetry(false)
        setError(info.text)
        if (code === 'menu_item_unavailable' && err instanceof ApiError) {
          const id = err.details?.menuItemId
          const name = lines.find((l) => l.menuItemId === id)?.name
          if (name) setError(`${name} går inte att beställa just nu. Ta bort den och skicka igen.`)
        }
        void refresh()
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  function mergeTab(next: Tab) {
    setData((d) => {
      if (!d) return d
      const others = d.tabs.filter((t) => t.tabId !== next.tabId)
      return {
        ...d,
        tabs: next.status === 'open' ? [...others, next] : others,
        tables: d.tables.map((t) =>
          t.tableId === next.tableId ? { ...t, tabId: next.status === 'open' ? next.tabId : null }
            : t.tabId === next.tabId ? { ...t, tabId: null } : t),
      }
    })
  }

  // Cmd/Ctrl+Enter sends from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        void sendRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })

  // After a clean send: back to the Bord view with the order highlighted.
  const doneTab = done?.result.tab.tabId
  const doneClean = Boolean(done && done.result.warnings.length === 0 && lines.length === 0)
  useEffect(() => {
    if (!doneClean || !doneTab) return
    const id = window.setTimeout(() => navigate(boardPath(doneTab)), DONE_MS)
    return () => window.clearTimeout(id)
  }, [doneClean, doneTab, navigate])

  async function redispatch() {
    if (!locationId || !done?.result.round) return
    try {
      const result = await redispatchRound(locationId, done.result.tab.tabId, done.result.round.round)
      setDone({ ...done, result })
    } catch (err) {
      setError(tabErrorText(err).text)
    }
  }

  async function saveTableSheet(next: { covers: number | null; guestName: string }) {
    setTableSheet(false)
    if (!tab || !locationId) {
      dirty.current = true
      setCovers(next.covers)
      setGuestName(next.guestName)
      return
    }
    try {
      const updated = await editTab(locationId, tab.tabId, {
        requestId: newRequestId(),
        expectedVersion: tab.version,
        ...(next.covers ? { covers: next.covers } : {}),
        guestName: next.guestName,
      })
      mergeTab(updated)
    } catch (err) {
      const info = tabErrorText(err)
      if (info.tab) mergeTab(info.tab)
      setError(info.text)
    }
  }

  /* --- Render -------------------------------------------------------------- */

  const title = tab ? `Lägg till på ${tableTitle(tab.tableLabel)}` : 'Ny bordsbeställning'
  const shownCovers = tab ? tab.covers : covers
  const shownGuest = tab ? tab.guestName : guestName.trim() || null

  const chip = table && (
    <button type="button" className="to-table-chip" onClick={() => setTableSheet(true)} aria-label={`${tableTitle(table.label)}, ändra bord, gäster eller namn`}>
      <Icon name="table-round" size={20} />
      <span className="to-table-chip-name">{tableTitle(table.label)}</span>
      {shownGuest && <span className="to-table-chip-guest">{shownGuest}</span>}
      <span className="to-table-chip-covers">
        <Icon name="users" size={16} />
        {shownCovers ?? '-'}
      </span>
      {tab && <span className="to-chip to-chip--open">Öppen</span>}
    </button>
  )

  const sendLabel = retry ? 'Försök igen' : 'Skicka'
  const sendBtn = (
    <button
      ref={sendButton}
      type="button"
      className={`btn primary to-send${retry ? ' is-retry' : ''}`}
      disabled={!table || lines.length === 0 || sending}
      aria-busy={sending || undefined}
      onClick={() => void send()}
    >
      <Icon name={retry ? 'rotate' : 'send'} size={20} />
      {sending ? 'Skickar…' : sendLabel}
    </button>
  )

  const doneBox = done && (
    <div className="to-done" role="status">
      <p className="to-done-title">
        <Icon name="check" size={20} />
        {done.stationNames.length ? `Skickat till ${joinNames(done.stationNames)}` : 'Sparat'}
      </p>
      {done.held.length > 0 && (
        <p className="cell-muted">Väntar: {done.held.map((h) => `${COURSE_LABEL[h.course]} ${h.quantity}`).join(' · ')}</p>
      )}
      {(done.result.round?.stations ?? []).filter((s) => s.fallback).map((s) => (
        <p key={s.stationId} className="to-done-note">
          {s.stationName} har ingen skrivare, bongen skrevs ut i köket.
        </p>
      ))}
      {done.result.warnings.map((w, i) => (
        <p key={`${w.code}-${i}`} className="to-done-note is-warning">
          {w.code === 'dispatch_failed'
            ? 'Bongen kom inte fram till köket. Tryck Skicka igen.'
            : w.text || 'En station saknar skrivare. Bongen syns på köksskärmen.'}
        </p>
      ))}
      <div className="to-done-actions">
        {done.result.warnings.some((w) => w.code === 'dispatch_failed') && (
          <button type="button" className="btn outline square" onClick={() => void redispatch()}>
            <Icon name="rotate" size={16} />
            Skicka igen
          </button>
        )}
        <Link className="btn outline square" to={boardPath(done.result.tab.tabId)}>Till Bord</Link>
      </div>
    </div>
  )

  const footer = (
    <>
      {notice && <p className="to-notice" role="status">{notice}</p>}
      {error && <ErrorNote text={error} onRetry={retry ? () => void send() : undefined} />}
      {done && lines.length === 0 ? doneBox : (
        <>
          <SendPreview lines={lines} hold={hold} menu={menu} />
          {sendBtn}
        </>
      )}
    </>
  )

  const summary = (
    <OrderSummary
      head={sheetMode ? undefined : chip}
      lines={lines}
      hold={hold}
      onHold={(course, h) => {
        dirty.current = true
        // A failed send carried this course the other way: the retry would fire
        // (or hold) it against the waiter's choice, so the next send is new.
        const job = inflight.current
        if (job && job.items.some((i) => i.course === course && Boolean(i.hold) !== h)) {
          inflight.current = null
          setRetry(false)
          setError(null)
        }
        setHoldOverride((o) => ({ ...o, [course]: h }))
      }}
      onQuantity={(key, q) => edit((prev) => setQuantity(prev, key, q))}
      onEdit={(key) => {
        const line = lines.find((l) => l.key === key)
        const item = line && menu?.items.find((i) => i.menuItemId === line.menuItemId)
        if (line && item) setEditing({ item, line })
      }}
      tab={tab}
      footer={footer}
    />
  )

  const frameStyle = frame && !phone
    ? ({ '--to-left': `${frame.left}px`, '--to-width': `${frame.width}px` } as CSSProperties)
    : undefined

  let body: ReactNode
  if (!locationId) {
    body = resolving ? <Loading label="Hämtar platsen" /> : <NoLocation />
  } else if (!data) {
    body = loadError ? <ErrorNote text={booqyFaultText('Borden kunde inte visas.')} onRetry={() => void refresh()} /> : <Loading label="Hämtar borden" />
  } else if (tables.length === 0) {
    body = (
      <div className="admin-card to-empty-card">
        <Icon name="table-square" size={32} />
        <p>{isOwner ? 'Det finns inga bord. Rita och publicera bord i Planritning.' : 'Det finns inga bord. Be ägaren publicera bord i Planritning.'}</p>
        {isOwner && <Link className="btn outline square" to="/layout">Öppna Planritning</Link>}
      </div>
    )
  } else if (step === 'table') {
    body = (
      <>
        {routeTabGone && <p className="to-notice" role="status">Beställningen är stängd. Välj bord för en ny.</p>}
        {draft && lines.length === 0 && <DraftChip draft={draft} tables={tables} onRestore={restoreDraft} onDrop={() => {
          clearDraft(locationId)
          setDraft(null)
        }} />}
        {changingTable && table && (
          <BackButton onClick={() => setChangingTable(false)}>{tableTitle(table.label)}</BackButton>
        )}
        <TablePicker tables={tables} tabs={tabs} floors={floors} now={now} view={pickerView} onView={changeView}
          onPick={pickTable} selectedId={tableId} />
      </>
    )
  } else {
    body = (
      <div className={`to-work${sheetMode ? '' : ' to-work--split'}`}>
        <div className="to-work-main">
          {(sheetMode || draft) && (
            <div className="to-work-head">
              {sheetMode && chip}
              {draft && lines.length === 0 && <DraftChip draft={draft} tables={tables} onRestore={restoreDraft} onDrop={() => {
                clearDraft(locationId)
                setDraft(null)
              }} />}
            </div>
          )}
          {menu ? (
            <MenuGrid menu={menu} lines={lines} onAdd={onTileAdd} onRemoveOne={onTileRemove}
              onEdit={(item) => setEditing({ item, line: null })} />
          ) : menuError ? (
            <ErrorNote text={booqyFaultText('Menyn kunde inte visas.')} onRetry={() => locationId && getTabMenu(locationId).then(setMenu, () => setMenuError(true))} />
          ) : (
            <Loading label="Hämtar menyn" />
          )}
        </div>
        {sheetMode ? (
          <>
            {sheetOpen && createPortal(<div className="to-scrim" onClick={() => setSheetOpen(false)} aria-hidden="true" />, document.body)}
            {sheetOpen && createPortal(
              <div id="to-sheet" className={`to-sheet to-sheet--${layout}`} style={frameStyle} role="dialog" aria-modal="true"
                aria-label="Beställning" data-dock-hide={layout === 'phone' ? '' : undefined}
                onKeyDown={(e) => e.key === 'Escape' && setSheetOpen(false)}>
                <div className="to-sheet-grip">
                  <button type="button" className="to-sheet-close" onClick={() => setSheetOpen(false)} aria-label="Dölj beställningen">
                    <Icon name="chevron-down" size={22} />
                  </button>
                  {chip}
                </div>
                {summary}
              </div>,
              document.body,
            )}
            {!sheetOpen && !(done && lines.length === 0) && (
              <SendBar count={cartCount(lines)} total={cartTotal(lines)} open={sheetOpen} onToggle={() => setSheetOpen((o) => !o)}
                send={layout === 'sheet' ? sendBtn : null} label={tableTitle(table!.label)} style={frameStyle} />
            )}
          </>
        ) : (
          <aside className="to-panel admin-card" aria-label="Beställning" ref={setPanel}>{summary}</aside>
        )}
      </div>
    )
  }

  return (
    <>
      <AdminTopbar title={title} actions={<BackButton to={boardPath(null)}>Bord</BackButton>} />
      <div className={`admin-main to-root to-root--${layout}`} ref={rootRef} style={frameStyle}>
        {body}
        {sheetMode && step === 'menu' && !sheetOpen && ((done && lines.length === 0) || error || notice) && createPortal(
          <div className="to-float" style={frameStyle}>
            {notice && <p className="to-notice" role="status">{notice}</p>}
            {error && <ErrorNote text={error} onRetry={retry ? () => void send() : undefined} />}
            {done && lines.length === 0 && doneBox}
          </div>,
          document.body,
        )}
      </div>
      {optionFor && (
        <OptionSheet item={optionFor} onClose={() => setOptionFor(null)} onAdd={(options) => {
          add(optionFor, { options })
          setOptionFor(null)
        }} />
      )}
      {editing && (
        <ItemEditor item={editing.item} line={editing.line} onClose={() => setEditing(null)} onSave={(extra) => {
          const { item, line } = editing
          setEditing(null)
          if (line) edit((prev) => replaceLine(prev, line.key, makeLine(item, extra)))
          else add(item, extra)
        }} />
      )}
      {tableSheet && table && (
        <TableSheet
          label={tableTitle(table.label)}
          covers={shownCovers}
          guestName={shownGuest ?? ''}
          seats={table.seats}
          onClose={() => setTableSheet(false)}
          onChangeTable={() => {
            setTableSheet(false)
            setChangingTable(true)
          }}
          onSave={(next) => void saveTableSheet(next)}
        />
      )}
    </>
  )
}

function coursesFor(tab: Tab): { course: Course; quantity: number }[] {
  const out = new Map<Course, number>()
  for (const i of tab.items) if (i.state === 'held') out.set(i.course, (out.get(i.course) ?? 0) + i.quantity)
  return [...out].map(([course, quantity]) => ({ course, quantity }))
}

function DraftChip({ draft, tables, onRestore, onDrop }: { draft: Draft; tables: TableState[]; onRestore: () => void; onDrop: () => void }) {
  const t = draft.tableId ? tables.find((x) => x.tableId === draft.tableId) : null
  const n = cartCount(draft.lines)
  return (
    <div className="to-draft">
      <button type="button" className="to-draft-go" onClick={onRestore}>
        <Icon name="undo" size={18} />
        Fortsätt där du var
        <span className="cell-muted">{t ? `${tableTitle(t.label)} · ` : ''}{n === 1 ? '1 rätt' : `${n} rätter`}</span>
      </button>
      <button type="button" className="to-draft-drop" onClick={onDrop} aria-label="Släng det osända">
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}

/** The header chip's sheet: guests (covers), the guest's name for walk-ins, change table. */
function TableSheet({
  label,
  covers,
  guestName,
  seats,
  onClose,
  onChangeTable,
  onSave,
}: {
  label: string
  covers: number | null
  guestName: string
  seats: number
  onClose: () => void
  onChangeTable: () => void
  onSave: (next: { covers: number | null; guestName: string }) => void
}) {
  const [n, setN] = useState<number | null>(covers)
  const [name, setName] = useState(guestName)
  return (
    <Modal
      open
      title={label}
      onClose={onClose}
      closeLabel="Stäng"
      footer={
        <Bar variant="action" label={`Ändra ${label}`}>
          <Button variant="ghost" onClick={onChangeTable}>Byt bord</Button>
          <Button onClick={() => onSave({ covers: n, guestName: name.trim() })}>Klar</Button>
        </Bar>
      }
    >
      <div className="to-editor">
        <div className="to-editor-qty">
          <span className="to-label" id="to-covers">Gäster</span>
          <div className="to-stepper" role="group" aria-labelledby="to-covers">
            <button type="button" aria-label="En gäst färre" disabled={!n || n <= 1} onClick={() => setN((c) => Math.max(1, (c ?? 1) - 1))}>
              <Icon name="minus" size={18} />
            </button>
            <output aria-live="polite">{n ?? '-'}</output>
            <button type="button" aria-label="En gäst till" disabled={(n ?? 0) >= COVERS_MAX}
              onClick={() => setN((c) => Math.min(COVERS_MAX, (c ?? Math.max(0, seats - 1)) + 1))}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </div>
        <label className="to-field">
          <span className="to-label">Namn (valfritt)</span>
          <input type="text" value={name} maxLength={GUEST_MAX} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
    </Modal>
  )
}
