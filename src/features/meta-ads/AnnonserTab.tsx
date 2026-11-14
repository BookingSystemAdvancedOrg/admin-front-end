import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, Button, Card, Field, Input, Select, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import AdWizard from './AdWizard'
import {
  ERRORS,
  FAILED_LABEL,
  MISSING_LABEL,
  STATUS_LABEL,
  activate,
  disconnect,
  finishConnect,
  getAssets,
  getConnection,
  listCampaigns,
  pause,
  saveConnection,
  startConnect,
  type Assets,
  type Campaign,
  type Connection,
} from './api'
import { ErrorActions } from '../../shared/ErrorNote'

/** Marknadsföring > Annonser: koppla Meta, skapa annonser på två minuter, starta och pausa. */
export default function AnnonserTab() {
  const state = useTenant()
  const location = currentLocation(state)
  const [params, setParams] = useSearchParams()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const load = useCallback(async () => {
    try {
      setConnection(await getConnection())
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta annonserna.', ERRORS))
    }
  }, [])
  useLiveRefresh(async () => setConnection(await getConnection()))

  // Meta skickar tillbaka hit med ?code=&state= efter inloggningen.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = params.get('code')
    const oauthState = params.get('state')
    if (!code || !oauthState) {
      void load()
      return
    }
    const next = new URLSearchParams(params)
    next.delete('code')
    next.delete('state')
    setParams(next, { replace: true })
    finishConnect(code, oauthState)
      .then((c) => { setConnection(c); toast('Meta är kopplat. Välj konto och sida nedan.', { tone: 'success' }) })
      .catch((err) => setError(errorText(err, 'Det gick inte att koppla Meta.', ERRORS)))
  }, [params, setParams, load])

  async function connect() {
    setConnecting(true)
    try {
      const { authorizeUrl } = await startConnect()
      window.location.assign(authorizeUrl)
    } catch (err) {
      setError(errorText(err, 'Det gick inte att starta kopplingen.', ERRORS))
      setConnecting(false)
    }
  }

  return (
    <>
      {error ? <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng" action={<ErrorActions text={error} />}>{error}</Bar> : null}
      {connection?.killSwitch ? (
        <Bar variant="banner" tone="warning">Annonser är pausade av Booqy just nu. Inga nya annonser kan startas.</Bar>
      ) : null}
      {connection === null && !error ? <p className="cell-muted">Hämtar…</p> : null}
      {connection && connection.status !== 'connected' ? (
        <Card title="Koppla Meta">
          <p>
            Koppla restaurangens Facebook- och Instagramkonto för att annonsera. Ni loggar in hos Meta och väljer
            vilka konton Booqy får använda. Inga uppgifter om era gäster skickas till Meta.
          </p>
          <Button busy={connecting} busyLabel="Öppnar Meta…" onClick={connect}>Koppla Meta</Button>
        </Card>
      ) : null}
      {connection && connection.status === 'connected' ? (
        <>
          <ConnectionCard connection={connection} onSaved={setConnection} onDisconnected={load} />
          {connection.assets?.adAccountId && location ? (
            <Campaigns locationId={location.locationId} blocked={connection.killSwitch} />
          ) : null}
        </>
      ) : null}
    </>
  )
}

function ConnectionCard({ connection, onSaved, onDisconnected }: {
  connection: Connection
  onSaved: (c: Connection) => void
  onDisconnected: () => void
}) {
  const [assets, setAssets] = useState<Assets | null>(null)
  const [adAccountId, setAdAccountId] = useState(connection.assets?.adAccountId ?? '')
  const [pageId, setPageId] = useState(connection.assets?.pageId ?? '')
  const [instagramId, setInstagramId] = useState(connection.assets?.instagramId ?? '')
  const [beneficiary, setBeneficiary] = useState(connection.dsa.beneficiary)
  const [payor, setPayor] = useState(connection.dsa.payor)
  const [cap, setCap] = useState(String(connection.monthlyCapSek))
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(!connection.assets?.adAccountId)

  useEffect(() => {
    if (editing) getAssets().then(setAssets).catch(() => setAssets(null))
  }, [editing])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const saved = await saveConnection({
        adAccountId, pageId, instagramId: instagramId || null,
        dsa: { beneficiary: beneficiary.trim(), payor: payor.trim() }, monthlyCapSek: Number(cap),
        version: connection.version,
      })
      onSaved(saved)
      setEditing(false)
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara.', ERRORS, { dsa: 'annonsör och betalare', monthlyCapSek: 'månadstaket' }), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await disconnect()
      onDisconnected()
    } catch (err) {
      toast(errorText(err, 'Kunde inte koppla bort Meta.', ERRORS), { tone: 'danger' })
    }
  }

  const spent = connection.spendThisMonthSek
  return (
    <Card title="Meta" actions={!editing ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Ändra</Button> : undefined}>
      <Bar variant="meter" value={spent} max={Math.max(connection.monthlyCapSek, 1)} high={connection.monthlyCapSek * 0.8}
        label="Annonskostnad den här månaden"
        valueText={`${spent.toLocaleString('sv-SE')} av ${connection.monthlyCapSek.toLocaleString('sv-SE')} kr`} />
      {!editing ? (
        <p className="cell-muted">
          Annonsör: {connection.dsa.beneficiary}. Betalare: {connection.dsa.payor}. Booqy pausar alla annonser när
          månadstaket nås.
        </p>
      ) : (
        <form className="form-grid" onSubmit={save} aria-label="Meta-konton">
          {assets?.missing.length ? (
            <Bar variant="banner" tone="warning">
              <span>Något saknas hos Meta: </span>
              {assets.missing.map((m) => (
                <a key={m.kind} className="card-link" href={m.deepLink} target="_blank" rel="noreferrer">{MISSING_LABEL[m.kind]}</a>
              ))}
            </Bar>
          ) : null}
          <Field label="Annonskonto" required>
            <Select value={adAccountId} required onChange={(e) => setAdAccountId(e.target.value)}>
              <option value="">Välj</option>
              {assets?.adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Facebooksida" required>
            <Select value={pageId} required onChange={(e) => setPageId(e.target.value)}>
              <option value="">Välj</option>
              {assets?.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Instagramkonto">
            <Select value={instagramId} onChange={(e) => setInstagramId(e.target.value)}>
              <option value="">Inget</option>
              {assets?.instagram.map((i) => <option key={i.id} value={i.id}>{i.username ?? i.id}</option>)}
            </Select>
          </Field>
          <Field label="Annonsör" hint="Den som annonsen gör reklam för. Visas i annonsen enligt EU:s regler." required>
            <Input value={beneficiary} maxLength={120} required onChange={(e) => setBeneficiary(e.target.value)} />
          </Field>
          <Field label="Betalare" hint="Den som betalar annonsen." required>
            <Input value={payor} maxLength={120} required onChange={(e) => setPayor(e.target.value)} />
          </Field>
          <Field label="Månadstak (kr)" hint="Booqy pausar alla annonser när taket nås. Ni får ett mejl vid 80 %." required>
            <Input type="number" min={100} value={cap} required onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Bar variant="action" label="Spara Meta-konton">
            <Button type="button" variant="danger" onClick={remove}>Koppla bort Meta</Button>
            <Button type="submit" busy={saving} busyLabel="Sparar…" disabled={!adAccountId || !pageId}>Spara</Button>
          </Bar>
        </form>
      )}
    </Card>
  )
}

function Campaigns({ locationId, blocked }: { locationId: string; blocked: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [wizard, setWizard] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setCampaigns((await listCampaigns(locationId)).campaigns)
    } catch {
      setCampaigns([])
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => setCampaigns((await listCampaigns(locationId)).campaigns))

  // Medan en annons skapas hos Meta: fråga igen tills den är klar.
  useEffect(() => {
    if (!campaigns?.some((c) => c.status === 'publishing')) return
    const timer = window.setTimeout(() => void load(), 4000)
    return () => window.clearTimeout(timer)
  }, [campaigns, load])

  async function toggle(c: Campaign) {
    setBusy(c.campaignId)
    try {
      const next = c.status === 'active' ? await pause(locationId, c) : await activate(locationId, c)
      setCampaigns((list) => list?.map((x) => (x.campaignId === next.campaignId ? next : x)) ?? null)
    } catch (err) {
      toast(errorText(err, 'Det gick inte.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title="Annonser" actions={<Button size="sm" disabled={blocked} onClick={() => setWizard(true)}>Ny annons</Button>}>
      {campaigns && campaigns.length === 0 ? (
        <p className="admin-empty">Inga annonser än. Tryck på Ny annons, det tar ungefär två minuter.</p>
      ) : null}
      {campaigns && campaigns.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Annons</th><th scope="col">Period</th><th scope="col">Budget</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.campaignId}>
                  <td>
                    {c.creative.headline}
                    {/* In the first cell so it is on screen at phone width without scrolling the table sideways (F15). */}
                    {c.status === 'paused' || c.status === 'active' ? (
                      <div className="annonser-row-action">
                        <Button size="sm" variant={c.status === 'active' ? 'secondary' : 'primary'}
                          busy={busy === c.campaignId} disabled={blocked && c.status !== 'active'}
                          onClick={() => void toggle(c)}>
                          {c.status === 'active' ? 'Pausa' : 'Starta annonsen'}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                  <td>{c.startDate} - {c.endDate}</td>
                  <td>{c.budgetSek.toLocaleString('sv-SE')} kr</td>
                  <td>
                    <span className="status-badge">{STATUS_LABEL[c.status]}</span>
                    {c.status === 'failed' && c.error ? <span className="cell-muted"> {FAILED_LABEL[c.error.code] ?? ''}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {wizard ? (
        <AdWizard locationId={locationId} onClose={() => setWizard(false)} onCreated={() => { setWizard(false); void load() }} />
      ) : null}
    </Card>
  )
}
