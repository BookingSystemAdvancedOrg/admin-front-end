import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import type { Course, SendResult, Tab, TableState, TabsResponse, VoidReason } from '../table-order/types'
import {
  closeTab,
  getFloorPlan,
  listTabs,
  moveTab,
  newRequestId,
  redispatchRound,
  reopenTab,
  sendHeld,
  TAB_POLL_MS,
  tabErrorText,
  voidItems,
} from '../table-order/tableOrderApi'
import { FloorMap } from '../table-order/FloorMap'
import { useLiveRefresh } from '../../../shared/live'
import { StatTile } from '../../../shared/motion/StatTile'
import { Num } from '../../../shared/motion/Num'
import { Loading } from '../../../shared/Loading'
import { ErrorNote } from '../../../shared/ErrorNote'
import { CtaButton } from '../../../shared/CtaButton'
import { Icon } from '../../../shared/Icon'
import { booqyFaultText } from '../../../shared/errors'
import type { ErrorInfo } from '../../../shared/errors'
import { clock, kronor } from '../ordersApi'
import { TabCard } from './TabCard'
import { TabDetail } from './TabDetail'
import { CloseTabDialog } from './CloseTabDialog'
import { MoveTabDialog } from './MoveTabDialog'
import { VoidDialog } from './VoidDialog'
import { addPath, boardTotals, canReopen, fireReady, NEW_ORDER_PATH, tabTitle } from './tabState'
import type { Floor } from '../../layout-editor/data'
import './tablesBoard.css'

/** Side panel from 1180 px (tablet landscape and up), bottom sheet below. */
const WIDE = '(min-width: 1180px)'
function subscribeWide(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const wideNow = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(WIDE).matches)

type Dialog = { kind: 'close' | 'move' | 'void'; tabId: string }
type Problem = { text: string; info?: ErrorInfo }

/** How long the "Ångra" bar stays after a close (Stängda idag keeps it for 15 minutes). */
const UNDO_BAR_MS = 15_000

function problemOf(err: unknown): Problem & { tab?: Tab } {
  const { text, who, tab } = tabErrorText(err)
  return {
    text,
    ...(who === 'booqy' ? { info: { text, actor: 'booqy' as const, code: 'table_order', status: 0 } } : {}),
    ...(tab ? { tab } : {}),
  }
}

/** "Skickat till Kök och Bar" from a send result. */
function sentText(result: SendResult): string | null {
  const names = [...new Set((result.round?.stations ?? []).map((s) => s.stationName))]
  if (!names.length) return null
  return `Skickat till ${names.length > 1 ? `${names.slice(0, -1).join(', ')} och ${names.at(-1)}` : names[0]}`
}

/**
 * Beställningar > Bord: every table with an open order (staff took it at
 * the table), as cards or on the floor map. Waiters add dishes, send the
 * next course when the kitchen is ready, void, move the guests, and close
 * the order once the guest has paid in the restaurant's own POS. Booqy
 * takes no payment here. Polls a cheap version every 5 seconds.
 */
export function TablesBoard({ locationId, isOwner }: { locationId: string; isOwner: boolean }) {
  const navigate = useNavigate()
  const [data, setData] = useState<TabsResponse | null>(null)
  const version = useRef<number | undefined>(undefined)
  const seen = useRef<Set<string> | null>(null)
  const readyBefore = useRef<Set<string>>(new Set())
  const [loadError, setLoadError] = useState(false)
  const [view, setView] = useState<'kort' | 'karta'>('kort')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [dialogProblem, setDialogProblem] = useState<Problem | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Back from the order flow (?markera=<tabId>): that table lights up once.
  const [fresh, setFresh] = useState<Set<string>>(() => {
    const mark = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('markera')
    return new Set(mark ? [mark] : [])
  })
  const [announce, setAnnounce] = useState('')
  const [undo, setUndo] = useState<Tab | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => true)
  /** The published plan's geometry for Karta (loaded the first time the map is shown). */
  const [floors, setFloors] = useState<{ key: string; floors: Floor[] } | null>(null)
  const [mapError, setMapError] = useState(false)
  // A newly published plan changes the tables: the map geometry is fetched again.
  const tablesKey = (data?.tables ?? []).map((t) => t.tableId).sort().join(',')
  useEffect(() => {
    if (view !== 'karta' || (floors && floors.key === tablesKey)) return
    let off = false
    getFloorPlan(locationId)
      .then((f) => {
        if (off) return
        setFloors({ key: tablesKey, floors: f })
        setMapError(false)
      })
      .catch(() => !off && setMapError(true))
    return () => {
      off = true
    }
  }, [view, floors, tablesKey, locationId])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('markera')) return
    params.delete('markera')
    const q = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}`)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!undo) return
    const t = window.setTimeout(() => setUndo(null), UNDO_BAR_MS)
    return () => window.clearTimeout(t)
  }, [undo])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(t)
  }, [notice])

  const take = useCallback((next: TabsResponse) => {
    const ids = new Set(next.tabs.map((t) => t.tabId))
    const said: string[] = []
    if (seen.current) {
      const added = next.tabs.filter((t) => !seen.current!.has(t.tabId))
      if (added.length) {
        setFresh((prev) => new Set([...prev, ...added.map((t) => t.tabId)]))
        said.push(...added.map((t) => `Ny bordsbeställning, ${tabTitle(t)}`))
      }
    }
    const ready = new Set(next.tabs.filter(fireReady).map((t) => t.tabId))
    for (const t of next.tabs) {
      if (ready.has(t.tabId) && !readyBefore.current.has(t.tabId) && seen.current) said.push(`${tabTitle(t)}: dags att skicka`)
    }
    readyBefore.current = ready
    seen.current = ids
    if (said.length) setAnnounce(said.join('. '))
    version.current = next.version
    setData(next)
    setNow(Date.now())
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await listTabs(locationId, version.current)
      if (!('unchanged' in res)) take(res)
      setLoadError(false)
    } catch {
      setLoadError(true)
      return false
    }
  }, [locationId, take])

  useEffect(() => {
    version.current = undefined
    seen.current = null
    void refresh()
  }, [locationId, refresh])
  useLiveRefresh(refresh, { everyMs: TAB_POLL_MS })

  /** Puts a fresh copy of one tab into the board (after a write or a 409 with the tab). */
  function put(tab: Tab) {
    setData((prev) => {
      if (!prev) return prev
      const open = tab.status === 'open'
      const tabs = open
        ? prev.tabs.some((t) => t.tabId === tab.tabId)
          ? prev.tabs.map((t) => (t.tabId === tab.tabId ? tab : t))
          : [...prev.tabs, tab]
        : prev.tabs.filter((t) => t.tabId !== tab.tabId)
      const closedToday = open
        ? prev.closedToday.filter((t) => t.tabId !== tab.tabId)
        : [tab, ...prev.closedToday.filter((t) => t.tabId !== tab.tabId)]
      const tables = prev.tables.map((t) => {
        if (open && t.tableId === tab.tableId) return { ...t, tabId: tab.tabId }
        if (t.tabId === tab.tabId && (!open || t.tableId !== tab.tableId)) return { ...t, tabId: null }
        return t
      })
      return { ...prev, tabs, closedToday, tables }
    })
  }

  /** One write at a time: a second tap before React re-renders must not send twice. */
  const writing = useRef(false)
  async function act<T>(tabId: string, work: () => Promise<T>, inDialog = false): Promise<T | null> {
    if (writing.current) return null
    writing.current = true
    setBusy(tabId)
    setProblem(null)
    setDialogProblem(null)
    try {
      return await work()
    } catch (err) {
      const p = problemOf(err)
      if (p.tab) put(p.tab)
      if (inDialog) setDialogProblem(p)
      else setProblem(p)
      void refresh()
      return null
    } finally {
      writing.current = false
      setBusy(null)
    }
  }

  function afterSend(result: SendResult) {
    put(result.tab)
    const warn = result.warnings.map((w) => w.text).filter(Boolean)
    setNotice([sentText(result), ...warn].filter(Boolean).join('. ') || null)
  }

  async function fire(tab: Tab, course: Course) {
    const res = await act(tab.tabId, () => sendHeld(locationId, tab.tabId, { requestId: newRequestId(), courses: [course] }))
    if (res) afterSend(res)
  }

  async function redispatch(tab: Tab, round: number) {
    const res = await act(tab.tabId, () => redispatchRound(locationId, tab.tabId, round))
    if (res) afterSend(res)
  }

  async function voidSome(tab: Tab, items: { itemId: string; quantity: number }[], reason: VoidReason, note?: string) {
    const res = await act(tab.tabId, () => voidItems(locationId, tab.tabId, {
      requestId: newRequestId(), expectedVersion: tab.version, items, reason, ...(note ? { note } : {}),
    }), true)
    if (res) {
      afterSend(res)
      setDialog(null)
    }
  }

  async function move(tab: Tab, tableId: string) {
    const res = await act(tab.tabId, () => moveTab(locationId, tab.tabId, { requestId: newRequestId(), expectedVersion: tab.version, tableId }), true)
    if (res) {
      afterSend(res)
      setNotice(`Flyttad till ${tabTitle(res.tab)}`)
      setDialog(null)
    }
  }

  async function close(tab: Tab, dropHeld: boolean) {
    const res = await act(tab.tabId, () => closeTab(locationId, tab.tabId, { requestId: newRequestId(), expectedVersion: tab.version, dropHeld }), true)
    if (res) {
      put(res)
      setDialog(null)
      setSelected((s) => (s === tab.tabId ? null : s))
      setUndo(res)
    }
  }

  async function sendFirst(tab: Tab) {
    const res = await act(tab.tabId, () => sendHeld(locationId, tab.tabId, { requestId: newRequestId() }), true)
    if (res) afterSend(res)
  }

  async function reopen(tab: Tab) {
    const res = await act(tab.tabId, () => reopenTab(locationId, tab.tabId, { requestId: newRequestId() }))
    if (res) {
      put(res)
      setUndo(null)
      setNotice(`${tabTitle(res)} är öppen igen`)
    }
  }

  function pickTable(table: TableState) {
    if (table.tabId) setSelected(table.tabId)
    else navigate(`${NEW_ORDER_PATH}?bord=${encodeURIComponent(table.tableId)}`)
  }

  const tabs = [...(data?.tabs ?? [])].sort((a, b) => a.openedAt.localeCompare(b.openedAt))
  const totals = boardTotals(tabs)
  const current = tabs.find((t) => t.tabId === selected) ?? null
  const dialogTab = dialog ? tabs.find((t) => t.tabId === dialog.tabId) ?? null : null
  const closed = data?.closedToday ?? []
  const noTables = data !== null && data.tables.length === 0

  const tiles = [
    { label: 'Öppna bord', value: String(totals.open) },
    { label: 'Gäster', value: String(totals.guests) },
    { label: 'Väntar', value: String(totals.held), tone: totals.held ? ('attention' as const) : undefined },
  ]

  function dismissDialog() {
    setDialog(null)
    setDialogProblem(null)
  }

  return (
    <div className="tables-board">
      <p className="sr-only" aria-live="polite">{announce}</p>
      <section className="stats-row tables-stats" aria-label="Bord just nu">
        {tiles.map((t, i) => (
          <StatTile key={t.label} {...t} loading={data === null} index={i} />
        ))}
      </section>
      {loadError && <ErrorNote text={booqyFaultText('Bordsbeställningarna kunde inte visas.')} />}
      <ErrorNote text={problem?.text} info={problem?.info} />
      {notice && <p className="save-notice" role="status">{notice}</p>}

      {data === null ? (
        !loadError && <Loading label="Hämtar borden" />
      ) : noTables ? (
        <div className="admin-card tables-empty">
          <Icon name="table-round" size={28} />
          <p>Det finns inga bord. {isOwner ? 'Rita och publicera bord i Planritning.' : 'Be ägaren publicera bord i Planritning.'}</p>
          {isOwner && (
            <Link to="/layout" className="btn outline square">
              Öppna Planritning <Icon name="arrow-right" size={16} />
            </Link>
          )}
        </div>
      ) : (
        <div className={`tables-layout${current ? ' has-detail' : ''}`}>
          <div className="tables-main">
            <div className="tables-toolbar">
              <div className="orders-views tables-view" role="tablist" aria-label="Visa som">
                <button type="button" role="tab" aria-selected={view === 'kort'} className={view === 'kort' ? 'active' : ''}
                  onClick={() => setView('kort')}>
                  <Icon name="grid" size={16} /> Kort
                </button>
                <button type="button" role="tab" aria-selected={view === 'karta'} className={view === 'karta' ? 'active' : ''}
                  onClick={() => setView('karta')}>
                  <Icon name="tool-floor" size={16} /> Karta
                </button>
              </div>
            </div>
            {view === 'karta' ? (
              <div className="tables-map">
                {mapError ? (
                  <ErrorNote text={booqyFaultText('Bordskartan kunde inte visas.')} />
                ) : floors === null ? (
                  <Loading label="Hämtar bordskartan" />
                ) : (
                  <FloorMap floors={floors.floors} tables={data.tables} tabs={tabs} now={now} onPick={pickTable}
                    selectedId={current?.tableId ?? null} label="Bord"
                    highlightIds={new Set(tabs.filter((t) => fresh.has(t.tabId) || fireReady(t)).map((t) => t.tableId))} />
                )}
              </div>
            ) : tabs.length === 0 ? (
              <div className="admin-card tables-empty">
                <Icon name="table-round" size={28} />
                <p>Inga öppna bord</p>
                <CtaButton label="Ny bordsbeställning" icon="plus" win="Kör!" onClick={() => navigate(NEW_ORDER_PATH)} />
              </div>
            ) : (
              <div className="tab-grid">
                {tabs.map((t) => (
                  <TabCard key={t.tabId} tab={t} now={now} fresh={fresh.has(t.tabId)} busy={busy === t.tabId}
                    selected={t.tabId === selected}
                    onOpen={(tab) => {
                      setSelected(tab.tabId)
                      setFresh((prev) => {
                        const next = new Set(prev)
                        next.delete(tab.tabId)
                        return next
                      })
                    }}
                    onAdd={(tab) => navigate(addPath(tab.tabId))}
                    onFire={(tab, course) => void fire(tab, course)}
                    onClose={(tab) => setDialog({ kind: 'close', tabId: tab.tabId })} />
                ))}
              </div>
            )}

            {closed.length > 0 && (
              <details className="admin-card orders-done tables-closed">
                <summary>
                  Stängda idag (<Num>{String(closed.length)}</Num>)
                </summary>
                <ul>
                  {closed.map((t) => (
                    <li key={t.tabId}>
                      <span>
                        {tabTitle(t)}
                        {t.guestName ? ` · ${t.guestName}` : ''} · {clock(t.closedAt)}
                        {t.closedByName ? ` · ${t.closedByName}` : ''} · <Num>{kronor(t.referenceTotal)}</Num>
                      </span>
                      {canReopen(t, now) && !data.tables.find((x) => x.tableId === t.tableId)?.tabId && (
                        <button type="button" className="btn outline square orders-done-refund" disabled={busy === t.tabId}
                          aria-label={`Ångra stäng ${tabTitle(t)}`} onClick={() => void reopen(t)}>
                          <Icon name="undo" size={14} /> Ångra
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {current && (() => {
            const detail = (
              <TabDetail tab={current} now={now} busy={busy === current.tabId}
                onDismiss={() => setSelected(null)}
                onAdd={() => navigate(addPath(current.tabId))}
                onFire={(course) => void fire(current, course)}
                onVoid={() => setDialog({ kind: 'void', tabId: current.tabId })}
                onMove={() => setDialog({ kind: 'move', tabId: current.tabId })}
                onClose={() => setDialog({ kind: 'close', tabId: current.tabId })}
                onRedispatch={(round) => void redispatch(current, round)} />
            )
            if (wide) return detail
            // The sheet lives in <body>: the page's glass would otherwise make it fixed to the content area.
            return createPortal(
              <div className="tab-detail-sheet">
                <div className="tab-detail-scrim" aria-hidden="true" onClick={() => setSelected(null)} />
                {detail}
              </div>,
              document.body,
            )
          })()}
        </div>
      )}

      {dialog?.kind === 'close' && dialogTab && (
        <CloseTabDialog tab={dialogTab} error={dialogProblem?.text} errorInfo={dialogProblem?.info}
          onCancel={dismissDialog}
          onConfirm={(dropHeld) => close(dialogTab, dropHeld)}
          onSendFirst={() => sendFirst(dialogTab)} />
      )}
      {dialog?.kind === 'move' && dialogTab && data && (
        <MoveTabDialog tab={dialogTab} tables={data.tables} error={dialogProblem?.text} errorInfo={dialogProblem?.info}
          onCancel={dismissDialog} onConfirm={(tableId) => move(dialogTab, tableId)} />
      )}
      {dialog?.kind === 'void' && dialogTab && (
        <VoidDialog tab={dialogTab} error={dialogProblem?.text} errorInfo={dialogProblem?.info}
          onCancel={dismissDialog} onConfirm={(items, reason, note) => voidSome(dialogTab, items, reason, note)} />
      )}

      {undo && (
        <div className="tables-undo" role="status">
          <span>{tabTitle(undo)} stängd</span>
          <button type="button" className="btn outline square" disabled={busy === undo.tabId} onClick={() => void reopen(undo)}>
            <Icon name="undo" size={16} /> Ångra
          </button>
        </div>
      )}
    </div>
  )
}

