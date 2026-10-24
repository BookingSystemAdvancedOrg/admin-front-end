import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import { Icon } from '../../shared/Icon'
import {
  ACCOUNT_ROLES,
  accountError,
  exportAccounting,
  getAccounting,
  saveAccounting,
  saveFile,
} from './accountingApi'
import type { AccountRole, Accounts, AccountingSettings, ExportFormat, ExportResult } from './accountingApi'
import './bokforing.css'

/**
 * Bokföring: dagens försäljning som en verifikation per dag, till Fortnox,
 * Visma eller ett annat bokföringsprogram.
 *
 *  - Exportera: en månad eller egen period som SIE-fil (SIE 4) eller CSV.
 *    Varningarna (t.ex. differens mot Stripe) visas efter nedladdningen.
 *  - Konton: BAS-konton per rad i verifikationen. Ägaren eller
 *    redovisningskonsulten ändrar dem; fyra siffror, återställ till standard.
 */

const GROUPS: { title: string; roles: AccountRole[] }[] = [
  { title: 'Försäljning', roles: ['sales25', 'sales12', 'sales6'] },
  { title: 'Utgående moms', roles: ['vat25', 'vat12', 'vat6'] },
  { title: 'Betalningar', roles: ['stripe', 'bank', 'receivables'] },
  { title: 'Avgifter och övrigt', roles: ['cardFees', 'guaranteeFees', 'tips', 'refundsOwed', 'unclassified', 'rounding'] },
]

const LABEL: Record<AccountRole, string> = {
  sales25: '25 % (alkohol)',
  sales12: '12 % (mat på plats)',
  sales6: '6 % (avhämtning)',
  vat25: '25 %',
  vat12: '12 %',
  vat6: '6 %',
  stripe: 'Stripe-avräkning',
  bank: 'Bank',
  receivables: 'Kundfordringar (cateringfakturor)',
  cardFees: 'Kortavgifter (Stripe)',
  guaranteeFees: 'Avgifter uteblivna gäster',
  tips: 'Dricks',
  refundsOwed: 'Återbetalningar att göra',
  unclassified: 'Oklart (OBS-konto)',
  rounding: 'Öresavrundning',
}

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober',
  'november', 'december']
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const CUSTOM = 'egen'

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** De senaste 13 månaderna, nyast först: värde "yyyy-mm". */
function monthOptions(today = new Date()): { value: string; label: string }[] {
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    return { value: iso(d).slice(0, 7), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
  })
}

function monthRange(value: string): [string, string] {
  const [y, m] = value.split('-').map(Number)
  return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
}

function kr(ore: number): string {
  return (ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const ERRORS: Record<string, string> = {
  stripe_refused: 'Stripe svarade inte på frågan om avgifter och utbetalningar. Kontakta Booqy.',
  stripe_unavailable: 'Stripe går inte att nå just nu. Försök igen om en stund.',
  changed_retry: 'Någon annan sparade samtidigt. Ladda om sidan och försök igen.',
}

function message(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return ERRORS[err.message] ?? (err.status === 400 ? err.message : fallback)
  return fallback
}

export function BokforingCard({ locationId }: { locationId: string | null }) {
  const months = monthOptions()
  const [period, setPeriod] = useState(months[1].value)
  const [from, setFrom] = useState(monthRange(months[1].value)[0])
  const [to, setTo] = useState(monthRange(months[1].value)[1])
  const [format, setFormat] = useState<ExportFormat>('sie')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)

  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [accounts, setAccounts] = useState<Accounts | null>(null)
  const [series, setSeries] = useState('B')
  const [yearStart, setYearStart] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getAccounting(locationId)
      .then((s) => {
        if (cancelled) return
        setSettings(s)
        setAccounts(s.accounts)
        setSeries(s.series)
        setYearStart(s.fiscalYearStartMonth)
      })
      .catch(() => !cancelled && setLoadError('Kunde inte hämta kontona just nu.'))
    return () => {
      cancelled = true
    }
  }, [locationId])

  const errors = accounts
    ? Object.fromEntries(ACCOUNT_ROLES.map((r) => [r, accountError(accounts[r])]))
    : {}
  const invalid = Object.values(errors).some(Boolean)
  const dirty = Boolean(
    settings && accounts &&
      (ACCOUNT_ROLES.some((r) => accounts[r] !== settings.accounts[r]) ||
        series !== settings.series || yearStart !== settings.fiscalYearStartMonth),
  )
  const isDefault = Boolean(settings && accounts && ACCOUNT_ROLES.every((r) => accounts[r] === settings.defaults[r]))
  const rangeError = period === CUSTOM && (!from || !to || from > to) ? 'Välj ett från-datum före till-datumet.' : null

  function choosePeriod(value: string) {
    setPeriod(value)
    setResult(null)
    if (value !== CUSTOM) {
      const [f, t] = monthRange(value)
      setFrom(f)
      setTo(t)
    }
  }

  async function download(e: FormEvent) {
    e.preventDefault()
    if (!locationId || rangeError) return
    setExporting(true)
    setExportError(null)
    setResult(null)
    try {
      const res = await exportAccounting(locationId, from, to, format)
      saveFile(res)
      setResult(res)
    } catch (err) {
      setExportError(message(err, 'Kunde inte skapa filen just nu. Försök igen om en stund.'))
    } finally {
      setExporting(false)
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!locationId || !settings || !accounts || invalid) return
    setSaving(true)
    setSaveError(null)
    setNotice(null)
    try {
      const next = await saveAccounting(locationId, {
        accounts, series, fiscalYearStartMonth: yearStart, version: settings.version,
      })
      setSettings(next)
      setAccounts(next.accounts)
      setNotice('Sparat.')
    } catch (err) {
      setSaveError(message(err, 'Kunde inte spara just nu. Försök igen om en stund.'))
    } finally {
      setSaving(false)
    }
  }

  function setAccount(role: AccountRole, value: string) {
    setAccounts((prev) => (prev ? { ...prev, [role]: value.replace(/\D/g, '').slice(0, 4) } : prev))
    setNotice(null)
  }

  if (!locationId) {
    return (
      <section id="bokforing" className="admin-card table-card bokforing-card">
        <h2 className="card-title">Bokföring</h2>
        <p className="cell-muted">Välj en plats först.</p>
      </section>
    )
  }

  return (
    <>
      <section id="bokforing" className="admin-card table-card bokforing-card">
        <h2 className="card-title">Exportera till bokföringen</h2>
        <div style={{ height: 8 }} />
        <p className="cell-muted">
          En verifikation per dag med försäljning per momssats, betalningar, återbetalningar, Stripes avgifter och
          utbetalningar till banken. Läs in SIE-filen i Fortnox, Visma eller ett annat bokföringsprogram.
        </p>
        <div style={{ height: 16 }} />
        <form onSubmit={download} className="notifications-form">
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="bokforing-period">Period</label>
              <select id="bokforing-period" value={period} onChange={(e) => choosePeriod(e.target.value)}>
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
                <option value={CUSTOM}>Egen period</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="bokforing-format">Filformat</label>
              <select id="bokforing-format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="sie">SIE-fil (Fortnox, Visma m.fl.)</option>
                <option value="csv">CSV (Excel)</option>
              </select>
            </div>
            {period === CUSTOM && (
              <>
                <div className="form-field">
                  <label htmlFor="bokforing-from">Från och med</label>
                  <input id="bokforing-from" type="date" value={from} max={to || undefined}
                    onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="form-field">
                  <label htmlFor="bokforing-to">Till och med</label>
                  <input id="bokforing-to" type="date" value={to} min={from || undefined}
                    onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            )}
          </div>
          {rangeError && <p className="form-error" role="alert">{rangeError}</p>}
          {exportError && <p className="form-error" role="alert">{exportError}</p>}
          <span className="row-actions">
            <button type="submit" className="btn primary square" disabled={exporting || Boolean(rangeError)}>
              <Icon name="download" />
              {exporting ? 'Skapar filen…' : format === 'sie' ? 'Ladda ner SIE-fil' : 'Ladda ner CSV-fil'}
            </button>
          </span>
        </form>

        {result && (
          <div className="bokforing-result" role="status">
            <p className="bokforing-result-title">
              <Icon name="check" size={16} /> {result.filename}
            </p>
            <dl className="bokforing-facts">
              <div>
                <dt>Verifikationer</dt>
                <dd>{result.summary.bookedDays} av {result.summary.days} dagar</dd>
              </div>
              <div>
                <dt>Försäljning exkl. moms</dt>
                <dd>{kr(result.summary.sales)} kr</dd>
              </div>
              <div>
                <dt>Utgående moms</dt>
                <dd>{kr(result.summary.vat)} kr</dd>
              </div>
            </dl>
            {result.summary.warnings.length > 0 && (
              <>
                <p className="bokforing-warn-title">Att stämma av med redovisningskonsulten</p>
                <ul className="bokforing-warnings">
                  {result.summary.warnings.map((w, i) => (
                    <li key={i}>
                      {w.date && <span className="bokforing-warn-date">{w.date}</span>}
                      {w.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <section className="admin-card table-card bokforing-card">
        <h2 className="card-title">Konton</h2>
        <div style={{ height: 8 }} />
        <p className="cell-muted">
          Standardkonton enligt BAS-kontoplanen. Stäm av dem med er redovisningskonsult och ändra det som ska bokas
          på andra konton.
        </p>
        <div style={{ height: 16 }} />
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
        {!accounts && !loadError && <p className="cell-muted">Hämtar kontona…</p>}
        {accounts && settings && (
          <form onSubmit={save} className="notifications-form" noValidate>
            {GROUPS.map((group) => (
              <fieldset key={group.title} className="bokforing-group">
                <legend>{group.title}</legend>
                {group.roles.map((role) => {
                  const error = touched || accounts[role].length === 4 ? errors[role] : null
                  return (
                    <div key={role} className="bokforing-row">
                      <label htmlFor={`konto-${role}`}>
                        <span className="bokforing-row-label">{LABEL[role]}</span>
                        <span className="bokforing-row-hint">
                          {accounts[role] === settings.defaults[role]
                            ? settings.names[role]
                            : `Standard ${settings.defaults[role]}`}
                        </span>
                      </label>
                      <div className="bokforing-input">
                        <input
                          id={`konto-${role}`}
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={4}
                          value={accounts[role]}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? `konto-${role}-fel` : undefined}
                          onChange={(e) => setAccount(role, e.target.value)}
                          onBlur={() => accounts[role] && setTouched(true)}
                          disabled={saving}
                        />
                        {error && (
                          <span id={`konto-${role}-fel`} className="bokforing-input-error">
                            {error}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </fieldset>
            ))}

            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="bokforing-serie">Verifikationsserie</label>
                <select id="bokforing-serie" value={series} disabled={saving}
                  onChange={(e) => { setSeries(e.target.value); setNotice(null) }}>
                  {LETTERS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="bokforing-ar">Räkenskapsåret börjar</label>
                <select id="bokforing-ar" value={yearStart} disabled={saving}
                  onChange={(e) => { setYearStart(Number(e.target.value)); setNotice(null) }}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      1 {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {saveError && <p className="form-error" role="alert">{saveError}</p>}
            <span className="row-actions">
              <button type="submit" className="btn primary square" disabled={saving || !dirty}>
                {saving ? 'Sparar…' : 'Spara'}
              </button>
              <button
                type="button"
                className="btn outline square"
                disabled={saving || isDefault}
                onClick={() => {
                  setAccounts({ ...settings.defaults })
                  setNotice(null)
                }}
              >
                Återställ standardkonton
              </button>
              {notice && (
                <span className="save-notice" role="status">
                  {notice}
                </span>
              )}
            </span>
          </form>
        )}
      </section>
    </>
  )
}
