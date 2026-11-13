import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { KassaMenu } from './KassaMenu'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { ApiError } from '../../shared/api'
import { Icon } from '../../shared/Icon'
import { Slot } from '../../shared/slots'
import { useLocationId } from '../../shared/location'
import { useAuth } from '../auth/useAuth'
import {
  AmountDialog,
  DeliveryPicker,
  DiscountDialog,
  DoneDialog,
  ExportDialog,
  ReceiptsDialog,
  TextDialog,
} from './KassaDialogs'
import { AboutDialog, OutageBanner, SetupDialog } from './KassaGuide'
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
  newCheckoutId,
  outageNotice,
  parseKronor,
  recordCardPayment,
  registerAction,
  report,
  undoPayment,
  updateBill,
} from './kassaApi'
import type {
  Bill, BillKind, DayStatus, Delivery, Discount, Done, KassaPayment, KassaState, MenuChoice, Register,
} from './kassaApi'
import './kassa.css'
import { SkelBlock, SkelBox, SkelCard, SkelPage } from '../../shared/Skeleton'
import { Num } from '../../shared/motion/Num'

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
type Stage = 'bill' | 'pay' | 'deliver'
type DialogName = 'table' | 'note' | 'discount' | 'openDay' | 'receipts' | 'export' | 'newRegister' | 'setup' | 'about' | null
/** Hur ofta kassan frågar om kontrollsystemet medan det inte svarar. */
const OUTAGE_POLL_MS = 60_000

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
 * knappar, notan bredvid (per bord eller avhämtning), kort på restaurangens
 * egen terminal (beloppet registreras här när kortet är godkänt), kvitto ut
 * på skrivaren eller mejl. Kvitton, retur, kopia, X- och
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
  const [amountText, setAmountText] = useState('')
  const checkoutId = useRef(newCheckoutId())

  const [dialog, setDialog] = useState<DialogName>(null)
  const [noteKey, setNoteKey] = useState<string | null>(null)
  const [done, setDone] = useState<{ done: Done; title: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Avbrott (csDownSince) där meddelandet om felanmälan redan stängts på den här skärmen. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const shownFor = useRef<string | null>(null)

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

  // Medan kontrollsystemet inte svarar frågar kassan om det varje minut,
  // så att den märker när det är tillbaka och när det är dags att felanmäla.
  const down = Boolean(register && !csOk)
  useEffect(() => {
    if (!down) return
    const t = window.setInterval(() => void loadState(), OUTAGE_POLL_MS)
    return () => window.clearInterval(t)
  }, [down, loadState])

  const banner = register?.felanmal && register.csDownSince && dismissed !== register.csDownSince
    && register.controlSystem.connected !== false ? register : null
  useEffect(() => {
    if (!locationId || !banner?.csDownSince || shownFor.current === banner.csDownSince) return
    shownFor.current = banner.csDownSince
    void outageNotice(locationId, banner.registerId, 'shown').catch(() => undefined)
  }, [locationId, banner])

  function dismissBanner() {
    if (!locationId || !banner?.csDownSince) return
    setDismissed(banner.csDownSince)
    void outageNotice(locationId, banner.registerId, 'dismissed').catch(() => undefined)
  }

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
  const amountOk = amount !== null && bill !== null && amount > 0 && amount <= bill.remaining

  /** Kortet är godkänt på terminalen: beloppet registreras på notan. */
  async function cardApproved() {
    if (!locationId || !bill || !amountOk || amount === null) return
    setBusy(true)
    setError(null)
    try {
      await recordCardPayment(locationId, bill.billId, { checkoutId: checkoutId.current, amount })
      const fresh = await getBill(locationId, bill.billId)
      show(fresh)
      checkoutId.current = newCheckoutId()
      setAmountText(kr(fresh.remaining))
      setStage(fresh.remaining <= 0 ? 'deliver' : 'pay')
    } catch (err) {
      setError(errorText(err))
      if (err instanceof ApiError && err.status < 500) checkoutId.current = newCheckoutId()
      void loadState()
    } finally {
      setBusy(false)
    }
  }

  // Presentkort (giftCards) drogs på notan: hämta den igen, som efter en kortbetalning.
  async function giftCardPaid() {
    if (!locationId || !billIdRef.current) return
    try {
      const fresh = await getBill(locationId, billIdRef.current)
      show(fresh)
      checkoutId.current = newCheckoutId()
      setAmountText(kr(fresh.remaining))
      setStage(fresh.remaining <= 0 ? 'deliver' : 'pay')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function undo(p: KassaPayment) {
    if (!locationId || !bill) return
    const how = p.method === 'Presentkort' ? 'till presentkortet' : 'på kortterminalen, och ta bort betalningen från notan'
    if (!window.confirm(`Återbetala ${kr(p.amount)} kr ${how}?`)) return
    setBusy(true)
    setError(null)
    try {
      await undoPayment(locationId, bill.billId, p.paymentId)
      const fresh = await getBill(locationId, bill.billId)
      show(fresh)
      setAmountText(kr(fresh.remaining))
      setStage(fresh.locked ? 'pay' : 'bill')
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
        <div className="admin-main">{resolving ? <KassaSkeleton label="Hämtar platsen" /> : <p className="cell-muted">Ingen plats är vald.</p>}</div>
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
          ) : <KassaSkeleton label="Öppnar kassan" />}
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

  // ANV 4 kap. 2 §: the float is registered at the start of every sales day; the Z ends the day.
  const dayClosed = !register?.dayOpen
  const payDisabled = !bill || saving || draft.length === 0 || (!bill.training && (!csOk || dayClosed)) || totals.total <= 0

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
            <span className={`kassa-pill ${csOk ? 'ok' : 'bad'}`} title={`${register.controlSystem.name || 'Kontrollsystem'} ${register.controlSystem.serial}`}>
              <span className="dot" aria-hidden="true" />
              {csOk ? 'Kontrollsystem anslutet' : 'Kontrollsystemet svarar inte'}
            </span>
            {register.training && <span className="kassa-pill training">Övningsläge</span>}
          </div>
          <div className="kassa-bar-actions">
            {day && !day.dayOpen && (
              <button type="button" className="btn primary" onClick={() => setDialog('openDay')}>Öppna dagen</button>
            )}
            <KassaMenu
              label="Rapporter"
              items={[
                { label: 'Kvitton', hint: 'Se och skriv ut kvitton och rapporter för en dag', onSelect: () => setDialog('receipts') },
                { label: 'X-rapport', hint: 'Dagens försäljning hittills. Stänger inte dagen', disabled: busy, onSelect: () => void runReport('x') },
                { label: 'Z-rapport', hint: 'Stänger dagen. Görs när ni stänger för kvällen', disabled: busy, onSelect: () => void runReport('z') },
                { label: 'Manuell försäljningslista', hint: 'Lista att skriva på om kassan inte fungerar', to: `/kassa/utskrift/manuell-lista?kassa=${register.registerId}` },
                ...(state.isOwner
                  ? [{ label: 'Exportera', hint: 'Kassans uppgifter till revisorn eller Skatteverket', onSelect: () => setDialog('export') }]
                  : []),
              ]}
            />
            <KassaMenu
              label="Kassan"
              items={[
                {
                  label: 'Övningsläge',
                  hint: 'Öva utan att något räknas som riktig försäljning',
                  on: Boolean(register.training),
                  disabled: busy,
                  onSelect: () => void registerDo('training', { on: !register.training }),
                },
                { label: 'Kom igång', hint: 'Det som ska vara klart innan kassan används', onSelect: () => setDialog('setup') },
                { label: 'Bruksanvisning', hint: 'Så använder ni kassan, steg för steg', to: '/kassa/bruksanvisning' },
                { label: 'Om kassan', hint: 'Kassans beteckning, version och kontrollsystem', onSelect: () => setDialog('about') },
                ...(state.isOwner && state.registers.length < 5
                  ? [{ label: 'Ny kassa', hint: 'Lägg till en kassa till på platsen (högst fem)', onSelect: () => setDialog('newRegister') }]
                  : []),
                ...(state.canSimulate
                  ? [{
                      label: register.simulateDown ? 'Starta kontrollsystemet (test)' : 'Stäng kontrollsystemet (test)',
                      hint: 'Bara i testmiljön: prova vad som händer när kontrollsystemet inte svarar',
                      quiet: true,
                      disabled: busy,
                      onSelect: () => void registerDo('simulate', { down: !register.simulateDown }),
                    }]
                  : []),
              ]}
            />
          </div>
        </div>

        {day && day.unclosedDays.length > 0 && (
          <p className="kassa-alert warn" role="alert">
            Z-rapport saknas för {day.unclosedDays.join(', ')}. Ta en Z-rapport för att stänga dagen.
          </p>
        )}
        {banner && <OutageBanner register={banner} onDismiss={dismissBanner} onRetry={() => void loadState()} />}
        {register.controlSystem.connected === false && (
          <p className="kassa-alert danger" role="alert">
            Kassan är inte kopplad till kontrollsystemet {register.controlSystem.name}. Ägaren skapar en ny kassa med Ny kassa under Kassan.
          </p>
        )}
        {!csOk && !banner && register.controlSystem.connected !== false && (
          <div className="kassa-alert danger kassa-down" role="alert">
            <p>
              Kontrollsystemet svarar inte{register.csDownSince ? ` sedan ${new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' }).format(new Date(register.csDownSince))}` : ''}, så inga kvitton kan skapas och inga kort dras.
              Skriv upp försäljningen på den manuella listan tills det fungerar igen.
            </p>
            <div className="kassa-row">
              <Link className="btn outline" to={`/kassa/utskrift/manuell-lista?kassa=${register.registerId}`}>
                <Icon name="printer" size={18} /> Manuell försäljningslista
              </Link>
              <button type="button" className="btn outline" disabled={busy} onClick={() => void loadState()}>Försök igen</button>
            </div>
          </div>
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
                    <span className="price"><Num>{kr(m.price)}</Num></span>
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
                  {billName(b)} <small><Num>{kr(bill?.billId === b.billId ? totals.total : b.total)}</Num></small>
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
                  <span className="cell-muted" aria-live="polite">{saving ? 'Sparar' : bill.paid > 0 && bill.remaining <= 0 ? 'Betald' : bill.locked ? 'Delvis betald' : ''}</span>
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
                          <span className="sum"><Num>{kr(l.unitPrice * l.quantity)}</Num></span>
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
                        <div className="row"><span>Rabatt ({discount?.label})</span><span><Num>{`-${kr(totals.discount)}`}</Num></span></div>
                      )}
                      {bill.paid > 0 && <div className="row"><span>Betalt med kort</span><span><Num>{kr(bill.paid)}</Num></span></div>}
                      <div className="row total"><span>Att betala</span><span><Num>{kr(totals.total - bill.paid)}</Num></span></div>
                    </div>

                    <div className="kassa-actions">
                      <div className="kassa-row">
                        <button type="button" className="btn outline" disabled={busy || bill.locked || draft.length === 0}
                          onClick={() => setDialog('discount')}>{discount ? 'Ändra rabatt' : 'Rabatt'}</button>
                        <button type="button" className="btn outline" disabled={busy || !unsent || !state.printer}
                          title={!state.printer ? 'Ingen skrivare kopplad' : undefined}
                          onClick={() => void bill_action('send')}><Icon name="tool-kitchen" size={18} /> Till köket</button>
                        <button type="button" className="btn outline danger-outline" disabled={busy || bill.locked}
                          title={bill.locked ? 'Notan har en kortbetalning. Återbetala den först.' : undefined}
                          onClick={() => { if (window.confirm('Ta bort notan? Det som redan skickats till köket registreras i journalen.')) void bill_action('void') }}>
                          <Icon name="trash" size={18} /> Ta bort nota
                        </button>
                      </div>
                      <button type="button" className="btn primary kassa-pay" disabled={payDisabled} onClick={() => void toPay()}>
                        {bill.training ? 'Skapa övningskvitto' : bill.paid > 0 ? `Betala resten ${kr(totals.total - bill.paid)} kr` : `Ta betalt ${kr(totals.total)} kr`}
                      </button>
                      {!bill.training && dayClosed && (
                        <p className="cell-muted">Öppna dagen först. Växelkassan registreras när försäljningsdagen börjar.</p>
                      )}
                    </div>
                  </>
                )}

                {stage === 'pay' && (
                  <div className="kassa-pay-panel">
                    <div className="kassa-sum">
                      <div className="row total"><span>Kvar att betala</span><span><Num>{kr(bill.remaining)}</Num></span></div>
                    </div>
                    <div className="kassa-chips" aria-label="Dela notan">
                      <button type="button" className={`kassa-chip${amount === bill.remaining ? ' on' : ''}`} onClick={() => setAmountText(kr(bill.remaining))}>Hela</button>
                      {[2, 3, 4].map((n) => {
                        const part = Math.ceil(bill.total / n)
                        return part <= bill.remaining && part > 0 ? (
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
                      {!amountOk && <p className="pay-field-error">Högst det som är kvar att betala.</p>}
                    </div>
                    <p className="cell-muted kassa-terminal-hint" data-help="kassa.payment.terminal">
                      Ta betalt {amount !== null && amountOk ? `${kr(amount)} kr ` : ''}på restaurangens kortterminal.
                      Registrera beloppet här först när terminalen visar att kortet är godkänt.
                    </p>
                    <button type="button" className="btn primary kassa-pay" disabled={busy || !amountOk || !csOk} onClick={() => void cardApproved()}>
                      <Icon name="card" size={22} /> Kortet godkänt, registrera {amount !== null && amountOk ? kr(amount) : ''} kr
                    </button>
                    {!csOk && <p className="cell-muted">Kontrollsystemet svarar inte. Ta inte betalt på terminalen förrän kassan fungerar igen.</p>}
                    {locationId && (
                      <Slot
                        id="kassa.payment.giftcard"
                        props={{ locationId, billId: bill.billId, remainingOre: bill.remaining, onPaid: () => void giftCardPaid() }}
                      />
                    )}
                    <PaidParts bill={bill} busy={busy} onUndo={(p) => void undo(p)} />
                    {bill.paid === 0 && (
                      <button type="button" className="btn outline" onClick={() => setStage('bill')}>Tillbaka till notan</button>
                    )}
                  </div>
                )}

                {stage === 'deliver' && (
                  <div className="kassa-deliver">
                    {!bill.training && (
                      <div className="pay-stage paid">
                        <div className="pay-stage-mark"><Icon name="check" size={44} /></div>
                        <h2>Betalt <Num>{`${kr(bill.paid)} kr`}</Num></h2>
                      </div>
                    )}
                    <p className="cell-muted">Kvittot skapas med kontrollkod och skrivs ut eller mejlas. Gästen får välja att inte ta det.</p>
                    <DeliveryPicker testMode={state.testMode} printer={state.printer} busy={busy || !csOk}
                      label={bill.training ? 'Övningskvitto' : 'Kvitto'} onPick={(d, e) => void close(d, e)} />
                    {!csOk ? <PaidParts bill={bill} busy={busy} onUndo={(p) => void undo(p)} /> : (
                      <details className="kassa-undo">
                        <summary>Ångrade sig gästen? Återbetala</summary>
                        <PaidParts bill={bill} busy={busy} onUndo={(p) => void undo(p)} />
                      </details>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <p className="kassa-about cell-muted">
          {register.model} · {register.program} {register.version} · Kassabeteckning {register.designation || register.label}
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
      {dialog === 'setup' && <SetupDialog locationId={locationId} state={state} register={register} onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog register={register} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog locationId={locationId} registerId={registerId} onClose={() => setDialog(null)} />}
      {dialog === 'newRegister' && (
        <TextDialog title="Ny kassa" label="Namn (står på kvitton, kan inte ändras)" initial={`Kassa ${state.registers.length + 1}`}
          max={16} submit="Skapa kassa" onSubmit={(t) => void addRegister(t)} onClose={() => setDialog(null)} />
      )}
    </>
  )
}

/** Betalda delar före kvittot; kan återbetalas om gästen ångrar sig. */
function PaidParts({ bill, busy, onUndo }: { bill: Bill; busy: boolean; onUndo: (p: KassaPayment) => void }) {
  const paid = bill.payments.filter((p) => p.status === 'succeeded')
  if (!paid.length) return null
  return (
    <ul className="kassa-paid">
      {paid.map((p) => (
        <li key={p.paymentId}>
          <span>Betalt {kr(p.amount)} kr, {p.method === 'Presentkort' ? `presentkort **** ${p.last4 ?? ''}` : 'kort'}</span>
          <button type="button" className="btn outline" disabled={busy} onClick={() => onUndo(p)}>Återbetala</button>
        </li>
      ))}
    </ul>
  )
}

/** Medan kassan öppnas: kategorier, rätter och notan, som suddigt glas. */
function KassaSkeleton({ label }: { label: string }) {
  return (
    <SkelPage label={label}>
      <div className="kassa-layout show-menu" aria-hidden="true">
        <section className="kassa-menu">
          <SkelBlock w="70%" h={46} round />
          <div className="kassa-tiles">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <SkelBox key={i} className="admin-card kassa-tile" h={80}>
                <SkelBlock w="70%" />
                <SkelBlock w="36%" style={{ marginTop: 'auto' }} />
              </SkelBox>
            ))}
          </div>
        </section>
        <SkelCard className="kassa-bill" aside={false} lines={6} />
      </div>
    </SkelPage>
  )
}
