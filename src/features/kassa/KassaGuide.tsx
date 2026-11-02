import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { Icon } from '../../shared/Icon'
import { useLocationId } from '../../shared/location'
import { useAuth } from '../auth/useAuth'
import { Dialog } from './KassaDialogs'
import {
  SKV_DRIFTSAVBROTT_URL,
  SKV_ETJANST_URL,
  errorText,
  getManual,
  getSetup,
  getState,
  kr,
  setSetup,
} from './kassaApi'
import type { Company, KassaState, Register, Setup, SetupItem } from './kassaApi'
import './kassa.css'
import { SkelCard, SkelRows } from '../../shared/Skeleton'

/** "HH:MM" i svensk tid. */
export function clockSv(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' }).format(d)
}

/** "ÅÅÅÅ-MM-DD" i svensk tid, `days` dagar senare. */
export function dateSv(iso?: string, days = 0): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + days)
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Stockholm' }).format(d)
}

/** Kassabeteckningen: tillverkningsnumret från kontrollsystemet, annars kassans namn. */
export function designationOf(register?: Register): string {
  return register ? register.designation || register.label : ''
}

// --- Markdown för bruksanvisningen ---------------------------------------------

/** **fet**, `kod` och [länk](url); övrig text som den är. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>)
    else if (m[2]) out.push(<code key={`${key}-${i++}`}>{m[2]}</code>)
    else if (/^https:\/\//.test(m[4])) out.push(<a key={`${key}-${i++}`} href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a>)
    else out.push(m[3])
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type ListItem = { text: string; children: ListBlock[] }
type ListBlock = { ordered: boolean; items: ListItem[] }

/** Listor med indrag (3 eller fler mellanslag = en nivå ner). */
function parseList(lines: string[]): ListBlock {
  const root: ListBlock = { ordered: /^\s*\d+\./.test(lines[0]), items: [] }
  const stack: { indent: number; block: ListBlock }[] = [{ indent: lines[0].search(/\S/), block: root }]
  for (const raw of lines) {
    const indent = raw.search(/\S/)
    const ordered = /^\s*\d+\./.test(raw)
    const text = raw.replace(/^\s*(\d+\.|-)\s+/, '')
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop()
    let top = stack[stack.length - 1]
    if (indent > top.indent) {
      const parent = top.block.items[top.block.items.length - 1]
      const child: ListBlock = { ordered, items: [] }
      parent?.children.push(child)
      stack.push({ indent, block: child })
      top = stack[stack.length - 1]
    }
    top.block.items.push({ text, children: [] })
  }
  return root
}

function renderList(block: ListBlock, key: string): ReactNode {
  const items = block.items.map((item, i) => (
    <li key={i}>
      {inline(item.text, `${key}-${i}`)}
      {item.children.map((c, j) => renderList(c, `${key}-${i}-${j}`))}
    </li>
  ))
  return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const content = inline(heading[2], `h${i}`)
      out.push(level === 1 ? <h1 key={i}>{content}</h1> : level === 2 ? <h2 key={i}>{content}</h2> : <h3 key={i}>{content}</h3>)
      i++
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()))
        i++
      }
      const [head, ...body] = rows
      out.push(
        <div key={`t${i}`} className="kassa-md-table">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${i}-${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, `td${i}-${k}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++].trim())
      i++
      out.push(<pre key={`c${i}`}><code>{code.join('\n')}</code></pre>)
      continue
    }
    if (/^\s*(\d+\.|-)\s+/.test(line)) {
      const block: string[] = []
      while (i < lines.length && (/^\s*(\d+\.|-)\s+/.test(lines[i]) || (/^\s{3,}\S/.test(lines[i]) && !/^\s*```/.test(lines[i])))) {
        block.push(lines[i++])
      }
      out.push(renderList(parseList(block), `l${i}`))
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*(\d+\.|-)\s|\s*```)/.test(lines[i])) para.push(lines[i++])
    out.push(<p key={`p${i}`}>{inline(para.join(' '), `p${i}`)}</p>)
  }
  return <div className="kassa-md">{out}</div>
}

/** Bruksanvisningen (application/docs/kassa/BRUKSANVISNING.md via API:t). */
export function KassaManualPage() {
  const { sub } = useAuth()
  const { locationId } = useLocationId(sub)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!locationId) return
    getManual(locationId).then((r) => setMarkdown(r.markdown)).catch((err) => setError(errorText(err)))
  }, [locationId])
  return (
    <>
      <AdminTopbar title="Bruksanvisning" />
      <div className="admin-main kassa">
        <Link to="/kassa" className="kassa-back"><Icon name="arrow-right" size={16} className="flip" /> Till kassan</Link>
        {error ? <p className="kassa-alert danger" role="alert">{error}</p>
          : markdown === null ? <SkelCard className="kassa-manual" head={false} lines={8} />
            : <article className="admin-card kassa-manual"><Markdown source={markdown} /></article>}
      </div>
    </>
  )
}

// --- utskrifter (A4) --------------------------------------------------------

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="kassa-print-field">
      <span>{label}</span>
      <strong>{value || ' '}</strong>
    </div>
  )
}

function ManualSalesSheet({ company, register, date }: { company?: Company | null; register?: Register; date: string }) {
  return (
    <div className="kassa-print">
      <h1>Manuell försäljningslista</h1>
      <p className="kassa-print-lead">Används när kassan inte kan registrera försäljning (driftsavbrott). Spara listan i bokföringen. Slå inte in försäljningen i kassan i efterhand.</p>
      <div className="kassa-print-grid">
        <Field label="Restaurang" value={company?.restaurant || company?.name} />
        <Field label="Företag" value={company?.name} />
        <Field label="Organisationsnummer" value={company?.orgText || company?.org} />
        <Field label="Kassabeteckning" value={designationOf(register)} />
        <Field label="Datum" value={date} />
        <Field label="Kontrollsystemet nere sedan" value={register?.csDownSince ? clockSv(register.csDownSince) : ''} />
      </div>
      <table className="kassa-print-table">
        <thead>
          <tr><th>Tid</th><th>Vara eller tjänst, antal</th><th>Belopp inkl. moms</th><th>Momssats</th><th>Betalningssätt</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: 18 }, (_, i) => <tr key={i}><td /><td /><td /><td /><td /></tr>)}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Summa</td><td /><td colSpan={2} /></tr>
        </tfoot>
      </table>
      <div className="kassa-print-sign">
        <Field label="Namn" />
        <Field label="Underskrift" />
      </div>
      <p className="kassa-print-foot">Momssats: 6, 12 eller 25 %. Betalningssätt: kort (kassan tar inte kontanter). Vid längre avbrott: felanmäl kassan i Skatteverkets e-tjänst "Anmäl, ändra, felanmäl och avanmäl kassaregister".</p>
    </div>
  )
}

function RegisterInfoSheet({ company, register }: { company?: Company | null; register?: Register }) {
  return (
    <div className="kassa-print">
      <h1>Kassans uppgifter</h1>
      <p className="kassa-print-lead">Förteckning över kassans delar. Förvara den tillsammans med skylten med id-nummer från Skatteverket, om skylten inte kan sättas fast på kassan (SKVFS 2014:10 3 kap. 8 §).</p>
      <div className="kassa-print-grid">
        <Field label="Verksamhet" value={company?.restaurant || company?.name} />
        <Field label="Företag och organisationsnummer" value={company ? `${company.name}, ${company.orgText || company.org}` : ''} />
        <Field label="Adress där kassan används" value={company?.address} />
        <Field label="Kassabeteckning" value={designationOf(register)} />
        {register?.designation && register.designation !== register.label && <Field label="Kassans namn" value={register.label} />}
      </div>
      <h2>Kassaregister (registreringsenhet)</h2>
      <div className="kassa-print-grid">
        <Field label="Tillverkare" value={register?.manufacturer || 'Booqy'} />
        <Field label="Modell" value={register?.model} />
        <Field label="Program och version" value={register ? `${register.program} ${register.version}` : ''} />
        <Field label="Tillverkningsnummer" value={register?.serialNumber} />
        <Field label="Registrering" value="Journalminne" />
        <Field label="Id-nummer från Skatteverket" />
      </div>
      <h2>Kontrollsystem</h2>
      <div className="kassa-print-grid">
        {register?.controlSystem.unit ? (
          <>
            <Field label="Kontrollsystem" value={register.controlSystem.name} />
            <Field label="Tillverkare och modell" value={`${register.controlSystem.unit.manufacturer}, ${register.controlSystem.unit.model}`} />
            <Field label="Adress" value={register.controlSystem.unit.address} />
            <Field label="Kontrollserverns id" value={register.controlSystem.unit.serverId} />
          </>
        ) : <Field label="Tillverkningsnummer" value={register?.controlSystem.serial} />}
        <Field label="Id-nummer från Skatteverket" />
      </div>
      <h2>Övriga delar</h2>
      <p>Surfplattor eller datorer där kassan används, kortläsare och skrivare:</p>
      <table className="kassa-print-table short">
        <thead><tr><th>Del</th><th>Modell</th><th>Placering</th></tr></thead>
        <tbody>{Array.from({ length: 4 }, (_, i) => <tr key={i}><td /><td /><td /></tr>)}</tbody>
      </table>
      <div className="kassa-print-sign"><Field label="Datum" /><Field label="Underskrift" /></div>
    </div>
  )
}

/** /kassa/utskrift/manuell-lista och /kassa/utskrift/kassans-uppgifter. */
export function KassaPrintPage() {
  const { kind } = useParams()
  const [params] = useSearchParams()
  const { sub } = useAuth()
  const { locationId } = useLocationId(sub)
  const [state, setState] = useState<KassaState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!locationId) return
    getState(locationId).then(setState).catch((err) => setError(errorText(err)))
  }, [locationId])
  const register = state?.registers.find((r) => r.registerId === params.get('kassa')) ?? state?.registers[0]
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())
  const title = kind === 'kassans-uppgifter' ? 'Kassans uppgifter' : 'Manuell försäljningslista'
  return (
    <>
      <AdminTopbar title={title} />
      <div className="admin-main kassa">
        <div className="kassa-print-bar">
          <Link to="/kassa" className="kassa-back"><Icon name="arrow-right" size={16} className="flip" /> Till kassan</Link>
          <button type="button" className="btn primary kassa-big" disabled={!state} onClick={() => window.print()}>
            <Icon name="printer" size={20} /> Skriv ut
          </button>
        </div>
        {error && <p className="kassa-alert danger" role="alert">{error}</p>}
        {!state ? !error && <SkelCard aside={false} lines={6} /> : (() => {
          const sheet = kind === 'kassans-uppgifter'
            ? <RegisterInfoSheet company={state.company} register={register} />
            : <ManualSalesSheet company={state.company} register={register} date={date} />
          return (
            <>
              <div className="kassa-sheet">{sheet}</div>
              {/* Utskriften: bara arket, direkt under body, så att inget annat blir tomma sidor. */}
              {createPortal(<div className="kassa-print-root">{sheet}</div>, document.body)}
            </>
          )
        })()}
      </div>
    </>
  )
}

// --- dialoger ------------------------------------------------------------------

const SETUP_TEXT: Record<SetupItem, { title: string; text: string }> = {
  anmalan: {
    title: 'Anmäl kassan till Skatteverket',
    text: 'Varje kassa ska anmälas innan den används, i e-tjänsten "Anmäl, ändra, felanmäl och avanmäl kassaregister". Ändringar anmäls inom två veckor.',
  },
  skylt: {
    title: 'Sätt upp skylten med id-nummer',
    text: 'Skatteverket skickar en skylt med id-nummer för kassan och kontrollsystemet. Sätt upp den synligt vid kassan, eller förvara den ordnat i lokalen tillsammans med utskriften "Kassans uppgifter".',
  },
  zrapport: {
    title: 'Ta en Z-rapport varje dag',
    text: 'Det ska finnas en Z-rapport för varje försäljningsdag. Kassan påminner om en dag saknas.',
  },
  journal: {
    title: 'Journalen sparas i sju år',
    text: 'Booqy sparar kassans journal i minst sju år och den kan inte ändras. Du kan exportera den som XML under Exportera.',
  },
  avbrott: {
    title: 'Vet vad ni gör vid driftsavbrott',
    text: 'Svarar inte kontrollsystemet: skriv upp försäljningen på den manuella listan. Är det nere länge: felanmäl kassan till Skatteverket. Skriv gärna ut några listor i förväg.',
  },
}

export function SetupDialog({
  locationId, state, register, onClose,
}: { locationId: string; state: KassaState; register: Register; onClose: () => void }) {
  const [items, setItems] = useState<Setup | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getSetup(locationId).then((r) => setItems(r.items)).catch((err) => setError(errorText(err)))
  }, [locationId])

  async function toggle(item: SetupItem, done: boolean) {
    setError(null)
    try {
      setItems((await setSetup(locationId, item, done)).items)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const c = state.company
  const done = items ? Object.values(items).filter((i) => i.done).length : 0
  return (
    <Dialog title="Kom igång med kassan" onClose={onClose} wide>
      <p className="modal-text">{done} av 5 klart. {state.isOwner ? 'Bocka av när det är gjort.' : 'Ägaren bockar av listan.'}</p>
      {error && <p className="kassa-alert danger" role="alert">{error}</p>}
      {!items ? <SkelRows n={5} cols={2} /> : (
        <ol className="kassa-setup">
          {(Object.keys(SETUP_TEXT) as SetupItem[]).map((key) => (
            <li key={key} className={items[key].done ? 'done' : ''}>
              <label className="kassa-setup-check">
                <input type="checkbox" checked={items[key].done} disabled={!state.isOwner}
                  onChange={(e) => void toggle(key, e.target.checked)} />
                <span>
                  <strong>{SETUP_TEXT[key].title}</strong>
                  <span className="cell-muted">{SETUP_TEXT[key].text}</span>
                </span>
              </label>
              {key === 'anmalan' && (
                <div className="kassa-setup-more">
                  {register.csEnrolledAt && !register.controlSystem.simulated && (
                    <p className="kassa-alert warn">Anmäl senast {dateSv(register.csEnrolledAt, 14)} (14 dagar efter att kassan kopplades till kontrollsystemet {dateSv(register.csEnrolledAt)}).</p>
                  )}
                  {register.controlSystem.unit && (
                    <>
                      <h3 className="kassa-subhead">1. Kontrollenheten</h3>
                      <dl className="kassa-facts">
                        <dt>Tillverkare</dt><dd>{register.controlSystem.unit.manufacturer}</dd>
                        <dt>Modell</dt><dd>{register.controlSystem.unit.model}</dd>
                        <dt>Adress</dt><dd>{register.controlSystem.unit.address}</dd>
                        <dt>Kontrollserverns id</dt><dd>{register.controlSystem.unit.serverId}</dd>
                      </dl>
                      <h3 className="kassa-subhead">2. Kassaregistret</h3>
                    </>
                  )}
                  <dl className="kassa-facts">
                    <dt>Verksamhet</dt><dd>{c?.restaurant || c?.name || 'Saknas'}</dd>
                    <dt>Adress där kassan används</dt><dd>{c?.address || 'Saknas'}</dd>
                    <dt>Kassabeteckning</dt><dd>{designationOf(register)}</dd>
                    <dt>Modell eller program</dt><dd>{register.model}, {register.program}</dd>
                    <dt>Tillverkningsnummer (Booqy)</dt><dd>{register.serialNumber}</dd>
                    <dt>Kontrollremsa eller journalminne</dt><dd>Journalminne</dd>
                    <dt>{register.controlSystem.unit ? 'Kontrollserverns id' : 'Kontrollsystemets tillverkningsnummer'}</dt><dd>{register.controlSystem.serial}</dd>
                  </dl>
                  {register.controlSystem.simulated && (
                    <p className="kassa-alert warn">Kassan är i testläge. Anmäl den först när ett certifierat kontrollsystem är kopplat.</p>
                  )}
                  {register.controlSystem.connected === false && (
                    <p className="kassa-alert danger">Kassan är inte kopplad till kontrollsystemet {register.controlSystem.name}. Skapa en ny kassa med Ny kassa.</p>
                  )}
                  <a className="btn outline" href={SKV_ETJANST_URL} target="_blank" rel="noreferrer">Till Skatteverkets e-tjänst</a>
                </div>
              )}
              {key === 'skylt' && (
                <div className="kassa-setup-more">
                  <Link className="btn outline" to={`/kassa/utskrift/kassans-uppgifter?kassa=${register.registerId}`}>
                    <Icon name="printer" size={18} /> Skriv ut Kassans uppgifter
                  </Link>
                </div>
              )}
              {key === 'avbrott' && (
                <div className="kassa-setup-more kassa-row">
                  <Link className="btn outline" to={`/kassa/utskrift/manuell-lista?kassa=${register.registerId}`}>
                    <Icon name="printer" size={18} /> Manuell försäljningslista
                  </Link>
                  <a className="btn outline" href={SKV_DRIFTSAVBROTT_URL} target="_blank" rel="noreferrer">Skatteverket om driftsavbrott</a>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  )
}

export function AboutDialog({ register, onClose }: { register: Register; onClose: () => void }) {
  return (
    <Dialog title="Om kassan" onClose={onClose}>
      <dl className="kassa-facts">
        <dt>Tillverkare</dt><dd>{register.manufacturer || 'Booqy'}</dd>
        <dt>Modell</dt><dd>{register.model}</dd>
        <dt>Program</dt><dd>{register.program}</dd>
        <dt>Version</dt><dd>{register.version}</dd>
        <dt>Kassans namn</dt><dd>{register.label}</dd>
        <dt>Kassabeteckning</dt><dd>{designationOf(register)}</dd>
        <dt>Tillverkningsnummer (Booqy)</dt><dd>{register.serialNumber}</dd>
        <dt>Kontrollsystem</dt><dd>{register.controlSystem.name || register.controlSystem.provider}{register.controlSystem.simulated ? '' : register.controlSystem.connected === false ? ' (inte kopplad)' : ''}</dd>
        <dt>{register.controlSystem.unit ? 'Kontrollserverns id' : 'Kontrollsystemets tillverkningsnummer'}</dt><dd>{register.controlSystem.serial}</dd>
        {register.csEnrolledAt && <><dt>Kopplad till kontrollsystemet</dt><dd>{dateSv(register.csEnrolledAt)}</dd></>}
        <dt>Registrering</dt><dd>Journalminne</dd>
      </dl>
      <h3 className="kassa-subhead">Inställningar</h3>
      <dl className="kassa-facts">
        <dt>Övningsläge</dt><dd>{register.training ? 'På' : 'Av'}</dd>
        <dt>Växelkassa</dt><dd>{kr(register.float ?? 0)} kr{register.dayOpen ? `, dagen öppnad ${register.dayOpen}` : ''}</dd>
        <dt>Senaste Z-rapport</dt><dd>{register.zSeq ? `Nr ${register.zSeq}${register.lastZDay ? `, ${register.lastZDay}` : ''}` : 'Ingen än'}</dd>
        <dt>Senaste kvittonummer</dt><dd>{register.receiptSeq || 'Inget än'}</dd>
      </dl>
    </Dialog>
  )
}

/** Visas när kontrollsystemet varit nere länge: felanmäl och använd listan. */
export function OutageBanner({ register, onDismiss, onRetry }: { register: Register; onDismiss: () => void; onRetry: () => void }) {
  return (
    <div className="kassa-outage" role="alert">
      <p>
        <strong>Kontrollsystemet har varit nere sedan {clockSv(register.csDownSince)}.</strong>{' '}
        Felanmäl till Skatteverket och använd den manuella listan.
      </p>
      <div className="kassa-row">
        <a className="btn primary" href={SKV_ETJANST_URL} target="_blank" rel="noreferrer">Felanmäl i Skatteverkets e-tjänst</a>
        <Link className="btn outline" to={`/kassa/utskrift/manuell-lista?kassa=${register.registerId}`}>
          <Icon name="printer" size={18} /> Manuell försäljningslista
        </Link>
        <button type="button" className="btn outline" onClick={onRetry}>Försök igen</button>
        <button type="button" className="btn outline" onClick={onDismiss}>Stäng</button>
      </div>
    </div>
  )
}
