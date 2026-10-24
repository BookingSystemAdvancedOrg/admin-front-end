import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { ApiError } from '../../shared/api'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { useLocationId } from '../../shared/location'
import { useAuth } from '../auth/useAuth'
import {
  MIN_ORE,
  act,
  failureText,
  getPayment,
  listReaders,
  newCheckoutId,
  parseKronor,
  rememberReader,
  rememberedReader,
  simulate,
} from '../tabetalt/cardApi'
import type { CardPayment, CardReader } from '../tabetalt/cardApi'
import {
  AmountDialog,
  DeliveryPicker,
  DiscountDialog,
  DoneDialog,
  ExportDialog,
  ReceiptsDialog,
  TextDialog,
} from './KassaDialogs'
import {
  CATEGORY_LABEL,
  billAction,
  createBill,
  createRegister,
  errorText,
  finalize,
  getBill,
  getMenu,
  getRegister,
  getState,
  kr,
  localTotals,
  mockPaymentSettled,
  registerAction,
  report,
  startPayment,
  updateBill,
} from './kassaApi'
import type { Bill, BillKind, DayStatus, Delivery, Discount, Done, KassaState, MenuChoice, Register } from './kassaApi'
import '../tabetalt/tabetalt.css'
import './kassa.css'

/** Hur ofta en pågående kortbetalning frågas om. */
export const POLL_MS = 2_000
/** Ändringar på notan skickas när personalen slutat trycka en kort stund. */
const SYNC_MS = 250

type Category = 'all' | MenuChoice['category']
type DraftLine = {
  key: string
  lineId?: string
  menuItemId: string
  name: string
  unitPrice: number
  quantity: number
  note?: string
  sent?: boolean
}
type Stage = 'bill' | 'pay' | 'waiting' | 'deliver'
type DialogName = 'table' | 'note' | 'discount' | 'openDay' | 'receipts' | 'export' | 'newRegister' | null

let keys = 0
const nextKey = () => `k${++keys}`

function fromBill(bill: Bill): DraftLine[] {
  return bill.lines.map((l) => ({
    key: l.lineId, lineId: l.lineId, menuItemId: l.menuItemId, name: l.name, unitPrice: l.unitPrice,
    quantity: l.quantity, note: l.note, sent: l.sent,
  }))
}

function billName(b: { kind: BillKind; tableLabel?: string }) {
  return b.kind === 'table' ? `Bord ${b.tableLabel ?? ''}`.trim() : 'Avhämtning'
}

/**
 * Kassa: kassaregistret för personal mitt i rusningen. Menyn som stora
 * knappar, notan bredvid (per bord eller avhämtning), kort på vald läsare,
 * kvitto ut på skrivaren eller mejl. Kvitton, retur, kopia, X- och
 * Z-rapport och export nås från raden överst. Testläge tills ett
 * certifierat kontrollsystem är kopplat (application/docs/KASSA-REQUIREMENTS.md).
 */
export default function KassaPage() {
  const { sub } = useAuth()
  const { locationId, resolving } = useLocationId(sub)

  const [state, setState] = useState<KassaState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuChoice[]>([])
  const [registerId, setRegisterId] = useState('')
  const [day, setDay] = useState<DayStatus | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [pane, setPane] = useState<'menu' | 'bill'>('menu')

  const [bill, setBill] = useState<Bill | null>(null)
  const [draft, setDraftState] = useState<DraftLine[]>([])
  const [discount, setDiscountState] = useState<Discount | null>(null)
  const draftRef = useRef<DraftLine[]>([])
  const discountRef = useRef<Discount | null>(null)
  const versionRef = useRef(0)
  const billIdRef = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const syncing = useRef(false)
  const again = useRef(false)
  const creating = useRef<Promise<Bill | null> | null>(null)
  const [saving, setSaving] = useState(false)

  const [stage, setStage] = useState<Stage>('bill')
  const [readers, setReaders] = useState<CardReader[]>([])
  const [readerId, setReaderId] = useState('')
  const [amountText, setAmountText] = useState('')
  const [payment, setPayment] = useState<CardPayment | null>(null)
  const checkoutId = useRef(newCheckoutId())

  const [dialog, setDialog] = useState<DialogName>(null)
  const [noteKey, setNoteKey] = useState<string | null>(null)
  const [done, setDone] = useState<{ done: Done; title: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const register: Register | undefined = state?.registers.find((r) => r.registerId === registerId)
  const csOk = register?.controlSystem.ok ?? false

  // --- laddning -----------------------------------------------------------

  const loadState = useCallback(async () => {
    if (!locationId) return
    try {
      const next = await getState(locationId)
      setState(next)
      setLoadError(null)
      setRegisterId((chosen) => (next.registers.some((r) => r.registerId === chosen) ? chosen : next.registers[0]?.registerId ?? ''))
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    void loadState()
    getMenu(locationId).then(setMenu).catch(() => setMenu([]))
    listReaders(locationId)
      .then((r) => {
        setReaders(r.readers)
        const remembered = rememberedReader(locationId)
        const pick = r.readers.find((x) => x.id === remembered) ?? r.readers.find((x) => x.status === 'online') ?? r.readers[0]
        setReaderId(pick?.id ?? '')
      })
      .catch(() => setReaders([]))
  }, [locationId, loadState])

  const loadDay = useCallback(async () => {
    if (!locationId || !registerId) return
    try {
      setDay((await getRegister(locationId, registerId)).day)
    } catch {
      setDay(null)
    }
  }, [locationId, registerId])

  useEffect(() => { void loadDay() }, [loadDay])

  // --- notan --------------------------------------------------------------

  function setDraft(next: DraftLine[]) {
    draftRef.current = next
    setDraftState(next)
  }

  function setDiscount(next: Discount | null) {
    discountRef.current = next
    setDiscountState(next)
  }

  function show(next: Bill | null) {
    window.clearTimeout(timer.current)
    setBill(next)
    billIdRef.current = next?.billId ?? null
    versionRef.current = next?.version ?? 0
    setDraft(next ? fromBill(next) : [])
    setDiscount(next?.discount ?? null)
  }

  const sync = useCallback(async () => {
    const billId = billIdRef.current
    if (!locationId || !billId) return
    if (syncing.current) {
      again.current = true
      return
    }
    syncing.current = true
    setSaving(true)
    try {
      do {
        again.current = false
        const sent = draftRef.current
        const res = await updateBill(locationId, billId, {
          version: versionRef.current,
          lines: sent.map((l) => (l.lineId
            ? { lineId: l.lineId, quantity: l.quantity, note: l.note ?? null }
            : { menuItemId: l.menuItemId, quantity: l.quantity, note: l.note ?? null })),
          discount: discountRef.current,
        })
        versionRef.current = res.version
        setBill(res)
        // Nya rader får sina id i samma ordning som de skickades.
        const ids = new Map(sent.map((l, i) => [l.key, res.lines[i]?.lineId]))
        setDraft(draftRef.current.map((l) => (l.lineId ? l : { ...l, lineId: ids.get(l.key) ?? undefined })))
      } while (again.current)
    } catch (err) {
      setError(errorText(err))
      if (err instanceof ApiError && billId) {
        getBill(locationId, billId).then(show).catch(() => undefined)
      }
    } finally {
      syncing.current = false
      setSaving(false)
    }
  }, [locationId])

  function changed(next: DraftLine[]) {
    setDraft(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void sync(), SYNC_MS)
  }

  async function newBill(kind: BillKind, tableLabel?: string): Promise<Bill | null> {
    if (!locationId || !registerId) return null
    setError(null)
    try {
      const created = await createBill(locationId, registerId, kind, tableLabel)
      show(created)
      setStage('bill')
      void loadState()
      return created
    } catch (err) {
      setError(errorText(err))
      return null
    }
  }

  async function openBill(billId: string) {
    if (!locationId) return
    setError(null)
    try {
      const b = await getBill(locationId, billId)
      show(b)
      setStage(b.paid > 0 && b.remaining === 0 ? 'deliver' : 'bill')
      setPane('bill')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function add(item: MenuChoice) {
    if (bill?.locked || stage !== 'bill') return
    if (!billIdRef.current) {
      // Snabba tryck innan notan finns väntar på samma nya nota.
      creating.current ??= newBill('takeaway').finally(() => { creating.current = null })
      if (!(await creating.current)) return
    }
    const lines = draftRef.current
    const same = lines.find((l) => l.menuItemId === item.menuItemId && !l.sent && !l.note)
    changed(same
      ? lines.map((l) => (l === same ? { ...l, quantity: Math.min(l.quantity + 1, 99) } : l))
      : [...lines, { key: nextKey(), menuItemId: item.menuItemId, name: item.name, unitPrice: item.price, quantity: 1 }])
  }

  function step(line: DraftLine, delta: number) {
    if (delta > 0 && line.sent) {
      // En skickad rad ändras inte: en ny rad går till köket.
      const item = menu.find((m) => m.menuItemId === line.menuItemId)
      if (item) void add(item)
      return
    }
    const quantity = line.quantity + delta
    changed(quantity <= 0
      ? draftRef.current.filter((l) => l.key !== line.key)
      : draftRef.current.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(quantity, 99) } : l)))
  }

  function saveNote(text: string) {
    changed(draftRef.current.map((l) => (l.key === noteKey ? { ...l, note: text || undefined } : l)))
    setNoteKey(null)
    setDialog(null)
  }

  function saveDiscount(next: Discount | null) {
    setDiscount(next)
    setDialog(null)
    window.clearTimeout(timer.current)
    void sync()
  }

  async function bill_action(action: 'send' | 'void') {
    if (!locationId || !bill) return
    window.clearTimeout(timer.current)
    await sync()
    setBusy(true)
    setError(null)
    try {
      const res = await billAction(locationId, bill.billId, action)
      if (action === 'void') {
        show(null)
        void loadState()
      } else {
        show(res as Bill)
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  // --- betalning ------------------------------------------------------------

  async function toPay() {
    window.clearTimeout(timer.current)
    await sync()
    setError(null)
    if (bill?.training) {
      setStage('deliver')
      return
    }
    checkoutId.current = newCheckoutId()
    if (locationId && billIdRef.current) {
      const fresh = await getBill(locationId, billIdRef.current).catch(() => null)
      if (fresh) {
        show(fresh)
        setAmountText(kr(fresh.remaining))
      }
    }
    setStage('pay')
  }

  const amount = parseKronor(amountText)
  const amountOk = amount !== null && bill !== null && amount >= MIN_ORE && amount <= bill.remaining

  async function charge() {
    if (!locationId || !bill || !amountOk || amount === null || !readerId) return
    setBusy(true)
    setError(null)
    rememberReader(locationId, readerId)
    try {
      const p = await startPayment(locationId, bill.billId, { checkoutId: checkoutId.current, readerId, amount })
      setPayment(p)
      setStage('waiting')
    } catch (err) {
      setError(errorText(err))
      if (err instanceof ApiError && err.status < 500) checkoutId.current = newCheckoutId()
      void loadState()
    } finally {
      setBusy(false)
    }
  }

  const settle = useCallback(async (p: CardPayment) => {
    if (!locationId || !billIdRef.current) return
    mockPaymentSettled(billIdRef.current, p)
    const fresh = await getBill(locationId, billIdRef.current)
    show(fresh)
    if (p.status === 'succeeded') {
      setPayment(null)
      checkoutId.current = newCheckoutId()
      setAmountText(kr(fresh.remaining))
      setStage(fresh.remaining <= 0 ? 'deliver' : 'pay')
    }
  }, [locationId])

  const pollId = payment?.status === 'processing' ? `${payment.paymentId}:${payment.attempt ?? 1}` : null
  useEffect(() => {
    if (!locationId || !pollId) return
    const id = pollId.split(':')[0]
    const t = window.setInterval(async () => {
      try {
        const next = await getPayment(locationId, id)
        if (next.status !== 'processing') {
          setPayment(next)
          void settle(next)
        }
      } catch {
        // Nätet hackar: nästa fråga om två sekunder.
      }
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [locationId, pollId, settle])

  async function cardAction(action: 'cancel' | 'retry') {
    if (!locationId || !payment) return
    setBusy(true)
    setError(null)
    try {
      const next = await act(locationId, payment.paymentId, action)
      setPayment(next)
      if (next.status === 'succeeded') void settle(next)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function close(delivery: Delivery, email?: string) {
    if (!locationId || !bill) return
    setBusy(true)
    setError(null)
    try {
      const result = await finalize(locationId, bill.billId, delivery, email)
      setDone({ done: result, title: bill.training ? 'Övningskvitto' : 'Kvitto' })
      show(null)
      setStage('bill')
      setPane('menu')
      void loadState()
      void loadDay()
    } catch (err) {
      setError(errorText(err))
      void loadState()
    } finally {
      setBusy(false)
    }
  }

  // --- kassan ---------------------------------------------------------------

  async function registerDo(action: 'open-day' | 'training' | 'simulate', body: object) {
    if (!locationId || !registerId) return
    setBusy(true)
    setError(null)
    try {
      await registerAction(locationId, registerId, action, body)
      await loadState()
      void loadDay()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
      setDialog(null)
    }
  }

  async function runReport(kind: 'x' | 'z') {
    if (!locationId || !registerId) return
    if (kind === 'z' && !window.confirm('Ta Z-rapport och stänga dagen för den här kassan?')) return
    setBusy(true)
    setError(null)
    try {
      const result = await report(locationId, registerId, kind, Boolean(state?.printer))
      setDone({ done: result, title: kind === 'z' ? 'Z-dagrapport' : 'X-dagrapport' })
      void loadState()
      void loadDay()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function addRegister(label: string) {
    if (!locationId || !label) return
    setBusy(true)
    setError(null)
    try {
      const r = await createRegister(locationId, label)
      setRegisterId(r.register.registerId)
      await loadState()
      setDialog(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const items = useMemo(() => menu.filter((m) => category === 'all' || m.category === category), [menu, category])
  const categories = useMemo(() => (['starters', 'mains', 'desserts', 'drinks'] as const).filter((c) => menu.some((m) => m.category === c)), [menu])
  const totals = localTotals(draft, discount)
  const count = draft.reduce((s, l) => s + l.quantity, 0)
  const unsent = draft.some((l) => !l.sent)
  const myBills = state?.openBills.filter((b) => b.registerId === registerId) ?? []
  const noteLine = draft.find((l) => l.key === noteKey)

  // --- vyer -----------------------------------------------------------------

  if (!locationId) {
    return (
      <>
        <AdminTopbar title="Kassa" />
        <div className="admin-main">{resolving ? <Loading label="Hämtar platsen" /> : <p className="cell-muted">Ingen plats är vald.</p>}</div>
      </>
    )
  }
  if (!state) {
    return (
      <>
        <AdminTopbar title="Kassa" />
        <div className="admin-main">
          {loadError ? (
            <div className="kassa-empty">
              <p className="kassa-alert danger" role="alert">{loadError}</p>
              <button type="button" className="btn outline" onClick={() => void loadState()}>Försök igen</button>
            </div>
          ) : <Loading label="Öppnar kassan" />}
        </div>
      </>
    )
  }

  const testBanner = state.testMode && <p className="kassa-test" role="note">{state.testNotice}</p>

  if (!register) {
    return (
      <>
        <AdminTopbar title="Kassa" />
        <div className="admin-main kassa">
          {testBanner}
          <div className="kassa-empty admin-card">
            <Icon name="receipt" size={32} />
            <h2>Ingen kassa än</h2>
            {state.isOwner ? (
              <>
                <p className="cell-muted">Skapa platsens första kassa. Namnet står på varje kvitto och rapport och kan inte ändras.</p>
                {error && <p className="kassa-alert danger" role="alert">{error}</p>}
                <button type="button" className="btn primary kassa-big" disabled={busy} onClick={() => void addRegister('Kassa 1')}>Skapa Kassa 1</button>
              </>
            ) : <p className="cell-muted">Be restaurangens ägare skapa en kassa för platsen.</p>}
          </div>
        </div>
      </>
    )
  }

  const payDisabled = !bill || saving || draft.length === 0 || (!bill.training && !csOk) || totals.total <= 0

  return (
    <>
      <AdminTopbar title="Kassa" />
      <div className="admin-main kassa">
        {testBanner}

        <div className="kassa-bar">
          <div className="kassa-bar-id">
            {state.registers.length > 1 ? (
              <select aria-label="Kassa" value={registerId} onChange={(e) => { setRegisterId(e.target.value); show(null) }}>
                {state.registers.map((r) => <option key={r.registerId} value={r.registerId}>{r.label}</option>)}
              </select>
            ) : <strong>{register.label}</strong>}
            <span className={`kassa-pill ${csOk ? 'ok' : 'bad'}`} title={`Kontrollsystem ${register.controlSystem.serial}`}>
              <span className="dot" aria-hidden="true" />
              {csOk ? 'Kontrollsystem anslutet' : 'Kontrollsystemet svarar inte'}
            </span>
            {register.training && <span className="kassa-pill training">Övningsläge</span>}
          </div>
          <div className="kassa-bar-actions">
            {day && !day.dayOpen && (
              <button type="button" className="btn primary" onClick={() => setDialog('openDay')}>Öppna dagen</button>
            )}
            <button type="button" className="btn outline" onClick={() => setDialog('receipts')}>Kvitton</button>
            <button type="button" className="btn outline" disabled={busy} onClick={() => void runReport('x')}>X-rapport</button>
            <button type="button" className="btn outline" disabled={busy} onClick={() => void runReport('z')}>Z-rapport</button>
            <button type="button" className={`btn outline${register.training ? ' on' : ''}`} disabled={busy}
              aria-pressed={Boolean(register.training)} onClick={() => void registerDo('training', { on: !register.training })}>
              Övningsläge
            </button>
            {state.isOwner && <button type="button" className="btn outline" onClick={() => setDialog('export')}>Exportera</button>}
            {state.isOwner && state.registers.length < 5 && (
              <button type="button" className="btn outline" onClick={() => setDialog('newRegister')}>Ny kassa</button>
            )}
            {state.canSimulate && (
              <button type="button" className="btn outline kassa-quiet" disabled={busy}
                onClick={() => void registerDo('simulate', { down: !register.simulateDown })}>
                {register.simulateDown ? 'Starta kontrollsystemet (test)' : 'Stäng kontrollsystemet (test)'}
              </button>
            )}
          </div>
        </div>

        {day && day.unclosedDays.length > 0 && (
          <p className="kassa-alert warn" role="alert">
            Z-rapport saknas för {day.unclosedDays.join(', ')}. Ta en Z-rapport för att stänga dagen.
          </p>
        )}
        {!csOk && (
          <p className="kassa-alert danger" role="alert">
            Kontrollsystemet svarar inte, så inga kvitton kan skapas och inga kort dras. Försök igen om en stund.
            Vid längre avbrott: anteckna försäljningen för hand och felanmäl kassan till Skatteverket.
          </p>
        )}
        {error && <p className="kassa-alert danger" role="alert">{error}</p>}

        <div className="kassa-switch" role="tablist" aria-label="Visa">
          <button type="button" role="tab" aria-selected={pane === 'menu'} className={pane === 'menu' ? 'active' : ''} onClick={() => setPane('menu')}>Meny</button>
          <button type="button" role="tab" aria-selected={pane === 'bill'} className={pane === 'bill' ? 'active' : ''} onClick={() => setPane('bill')}>
            Nota{count ? ` (${count})` : ''}{bill ? ` ${kr(totals.total)}` : ''}
          </button>
        </div>

        <div className={`kassa-layout show-${pane}`}>
          <section className="kassa-menu" aria-label="Meny">
            <div className="kassa-cats" role="tablist" aria-label="Kategorier">
              {(['all', ...categories] as Category[]).map((c) => (
                <button key={c} type="button" role="tab" aria-selected={category === c} className={category === c ? 'active' : ''}
                  onClick={() => setCategory(c)}>{c === 'all' ? 'Alla' : CATEGORY_LABEL[c]}</button>
              ))}
            </div>
            {menu.length === 0 ? (
              <p className="cell-muted">Menyn är tom. Lägg till rätter under Meny.</p>
            ) : (
              <div className="kassa-tiles">
                {items.map((m) => (
                  <button key={m.menuItemId} type="button" className="kassa-tile"
                    disabled={Boolean(bill?.locked) || stage !== 'bill' || (m.alcohol && bill?.kind === 'takeaway')}
                    onClick={() => void add(m)}>
                    <span className="name">{m.name}</span>
                    <span className="price">{kr(m.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="kassa-bill admin-card" aria-label="Nota">
            <div className="kassa-bills" aria-label="Öppna notor">
              {myBills.map((b) => (
                <button key={b.billId} type="button" className={`kassa-chip${bill?.billId === b.billId ? ' on' : ''}`}
                  onClick={() => void openBill(b.billId)}>
                  {billName(b)} <small>{kr(bill?.billId === b.billId ? totals.total : b.total)}</small>
                </button>
              ))}
              <button type="button" className="kassa-chip add" onClick={() => setDialog('table')}><Icon name="plus" size={16} /> Bord</button>
              <button type="button" className="kassa-chip add" onClick={() => void newBill('takeaway')}><Icon name="plus" size={16} /> Avhämtning</button>
            </div>

            {!bill ? (
              <div className="kassa-bill-empty">
                <Icon name="dish" size={28} />
                <p>Tryck på en rätt för en avhämtning, eller välj bord.</p>
              </div>
            ) : (
              <>
                <div className="kassa-bill-head">
                  <h2>{billName(bill)}{bill.training ? ' (övning)' : ''}</h2>
                  <span className="cell-muted" aria-live="polite">{saving ? 'Sparar' : bill.paid > 0 && bill.remaining <= 0 ? 'Betald' : bill.locked ? 'Betalning pågår' : ''}</span>
                </div>

                {stage === 'bill' && (
                  <>
                    <ul className="kassa-lines">
                      {draft.length === 0 && <li className="cell-muted kassa-hint">Notan är tom. Tryck på rätter i menyn.</li>}
                      {draft.map((l) => (
                        <li key={l.key} className={l.sent ? 'sent' : ''}>
                          <div className="what">
                            <span className="name">{l.name}</span>
                            <span className="meta">
                              {kr(l.unitPrice)}{l.sent ? ' · i köket' : ''}
                              {l.note && <em> · {l.note}</em>}
                            </span>
                          </div>
                          <div className="kassa-stepper">
                            <button type="button" aria-label={`En färre ${l.name}`} disabled={bill.locked} onClick={() => step(l, -1)}>
                              <Icon name={l.quantity === 1 ? 'trash' : 'minus'} size={20} />
                            </button>
                            <output aria-label="Antal">{l.quantity}</output>
                            <button type="button" aria-label={`En till ${l.name}`} disabled={bill.locked} onClick={() => step(l, 1)}>
                              <Icon name="plus" size={20} />
                            </button>
                          </div>
                          <span className="sum">{kr(l.unitPrice * l.quantity)}</span>
                          {!l.sent && !bill.locked && (
                            <button type="button" className="kassa-icon-btn" aria-label={`Notering för ${l.name}`}
                              onClick={() => { setNoteKey(l.key); setDialog('note') }}>
                              <Icon name="note" size={18} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>

                    <div className="kassa-sum">
                      {totals.discount > 0 && (
                        <div className="row"><span>Rabatt ({discount?.label})</span><span>-{kr(totals.discount)}</span></div>
                      )}
                      {bill.paid > 0 && <div className="row"><span>Betalt med kort</span><span>{kr(bill.paid)}</span></div>}
                      <div className="row total"><span>Att betala</span><span>{kr(totals.total - bill.paid)}</span></div>
                    </div>

                    <div className="kassa-actions">
                      <div className="kassa-row">
                        <button type="button" className="btn outline" disabled={busy || bill.locked || draft.length === 0}
                          onClick={() => setDialog('discount')}>{discount ? 'Ändra rabatt' : 'Rabatt'}</button>
                        <button type="button" className="btn outline" disabled={busy || !unsent || !state.printer}
                          title={!state.printer ? 'Ingen skrivare kopplad' : undefined}
                          onClick={() => void bill_action('send')}><Icon name="tool-kitchen" size={18} /> Till köket</button>
                        <button type="button" className="btn outline danger-outline" disabled={busy || bill.locked}
                          onClick={() => { if (window.confirm('Makulera notan? Det som skickats till köket registreras.')) void bill_action('void') }}>
                          Makulera
                        </button>
                      </div>
                      <button type="button" className="btn primary kassa-pay" disabled={payDisabled} onClick={() => void toPay()}>
                        {bill.training ? 'Skapa övningskvitto' : bill.paid > 0 ? `Betala resten ${kr(totals.total - bill.paid)} kr` : `Ta betalt ${kr(totals.total)} kr`}
                      </button>
                      {!bill.training && !state.cardReaders && <p className="cell-muted">Kortläsare är inte kopplade för platsen ännu.</p>}
                    </div>
                  </>
                )}

                {stage === 'pay' && (
                  <div className="kassa-pay-panel">
                    <div className="kassa-sum">
                      <div className="row total"><span>Kvar att betala</span><span>{kr(bill.remaining)}</span></div>
                    </div>
                    <div className="kassa-chips" aria-label="Dela notan">
                      <button type="button" className={`kassa-chip${amount === bill.remaining ? ' on' : ''}`} onClick={() => setAmountText(kr(bill.remaining))}>Hela</button>
                      {[2, 3, 4].map((n) => {
                        const part = Math.ceil(bill.total / n)
                        return part <= bill.remaining && part >= MIN_ORE ? (
                          <button key={n} type="button" className={`kassa-chip${amount === part ? ' on' : ''}`} onClick={() => setAmountText(kr(part))}>
                            1/{n} · {kr(part)}
                          </button>
                        ) : null
                      })}
                    </div>
                    <div className="form-field">
                      <label htmlFor="kassa-pay-amount">Belopp på det här kortet</label>
                      <div className="pay-amount">
                        <input id="kassa-pay-amount" inputMode="decimal" autoComplete="off" value={amountText}
                          aria-invalid={!amountOk} onChange={(e) => setAmountText(e.target.value)} />
                        <span aria-hidden="true">kr</span>
                      </div>
                      {!amountOk && <p className="pay-field-error">Minst {kr(MIN_ORE)} kr och högst det som är kvar.</p>}
                    </div>
                    <div className="form-field">
                      <label htmlFor="kassa-reader">Kortläsare</label>
                      <select id="kassa-reader" value={readerId} onChange={(e) => setReaderId(e.target.value)}>
                        {readers.length === 0 && <option value="">Ingen kortläsare</option>}
                        {readers.map((r) => <option key={r.id} value={r.id}>{r.label}{r.status === 'offline' ? ' (offline)' : ''}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn primary kassa-pay" disabled={busy || !amountOk || !readerId || !csOk} onClick={() => void charge()}>
                      <Icon name="card" size={22} /> Skicka {amount !== null ? kr(amount) : ''} kr till läsaren
                    </button>
                    {bill.paid === 0 && (
                      <button type="button" className="btn outline" onClick={() => setStage('bill')}>Tillbaka till notan</button>
                    )}
                  </div>
                )}

                {stage === 'waiting' && payment && (
                  <div className={`pay-stage ${payment.status === 'processing' ? 'waiting' : payment.status === 'succeeded' ? 'paid' : 'declined'}`}>
                    <div className="pay-stage-mark"><Icon name={payment.status === 'processing' ? 'card' : payment.status === 'succeeded' ? 'check' : 'close'} size={44} /></div>
                    <p className="kassa-big-amount">{kr(payment.amount)} kr</p>
                    <h2>{payment.status === 'processing' ? 'Väntar på kort' : payment.status === 'succeeded' ? 'Betald' : 'Inte betald'}</h2>
                    {payment.status === 'processing' ? (
                      <>
                        <p className="cell-muted">Be gästen blippa eller sätta i kortet på {payment.readerLabel ?? 'läsaren'}.</p>
                        {payment.simulated && (
                          <div className="kassa-row">
                            <button type="button" className="btn outline" onClick={() => void simulate(locationId, payment.paymentId, 'approve')}>Simulera godkänt kort</button>
                            <button type="button" className="btn outline" onClick={() => void simulate(locationId, payment.paymentId, 'decline')}>Simulera nekat kort</button>
                          </div>
                        )}
                        <button type="button" className="btn outline kassa-big" disabled={busy} onClick={() => void cardAction('cancel')}>Avbryt</button>
                      </>
                    ) : payment.status !== 'succeeded' ? (
                      <>
                        <p className="kassa-alert danger" role="alert">{failureText(payment)}</p>
                        <div className="kassa-row">
                          <button type="button" className="btn outline kassa-big" onClick={() => { setPayment(null); checkoutId.current = newCheckoutId(); setAmountText(kr(bill.remaining)); setStage('pay') }}>Annat belopp eller läsare</button>
                          <button type="button" className="btn primary kassa-big" disabled={busy} onClick={() => void cardAction('retry')}>Försök igen</button>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {stage === 'deliver' && (
                  <div className="kassa-deliver">
                    {!bill.training && (
                      <div className="pay-stage paid">
                        <div className="pay-stage-mark"><Icon name="check" size={44} /></div>
                        <h2>Betalt {kr(bill.paid)} kr</h2>
                      </div>
                    )}
                    <p className="cell-muted">Kvittot skapas med kontrollkod och skrivs ut eller mejlas. Gästen får välja att inte ta det.</p>
                    <DeliveryPicker testMode={state.testMode} printer={state.printer} busy={busy || !csOk}
                      label={bill.training ? 'Övningskvitto' : 'Kvitto'} onPick={(d, e) => void close(d, e)} />
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <p className="kassa-about cell-muted">
          {register.model} · {register.program} {register.version} · Tillverkningsnummer {register.serialNumber}
          {' '}· Kontrollsystem {register.controlSystem.serial}
        </p>
      </div>

      {done && <DoneDialog done={done.done} title={done.title} onClose={() => setDone(null)} />}
      {dialog === 'table' && (
        <TextDialog title="Ny nota för bord" label="Bord" initial="" max={20} submit="Öppna nota"
          quick={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']}
          onSubmit={(t) => { if (t) { setDialog(null); void newBill('table', t) } }} onClose={() => setDialog(null)} />
      )}
      {dialog === 'note' && noteLine && (
        <TextDialog title={`Notering: ${noteLine.name}`} label="Till köket" initial={noteLine.note ?? ''} max={80} submit="Spara"
          quick={['Utan lök', 'Glutenfri', 'Laktosfri', 'Extra sås']} onSubmit={saveNote}
          onClose={() => { setDialog(null); setNoteKey(null) }} />
      )}
      {dialog === 'discount' && <DiscountDialog current={discount} onSave={saveDiscount} onClose={() => setDialog(null)} />}
      {dialog === 'openDay' && (
        <AmountDialog title="Öppna dagen" label="Växelkassa" initial="0" submit="Öppna dagen" allowZero
          text="Registrera växelkassan när dagen börjar. Kassan tar bara kort, så den är oftast 0 kr."
          onSubmit={(ore) => void registerDo('open-day', { float: ore })} onClose={() => setDialog(null)} />
      )}
      {dialog === 'receipts' && (
        <ReceiptsDialog locationId={locationId} registerId={registerId} testMode={state.testMode} printer={state.printer}
          onClose={() => setDialog(null)} onChanged={() => void loadState()} />
      )}
      {dialog === 'export' && <ExportDialog locationId={locationId} registerId={registerId} onClose={() => setDialog(null)} />}
      {dialog === 'newRegister' && (
        <TextDialog title="Ny kassa" label="Namn (står på kvitton, kan inte ändras)" initial={`Kassa ${state.registers.length + 1}`}
          max={16} submit="Skapa kassa" onSubmit={(t) => void addRegister(t)} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
