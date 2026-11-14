import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Bar, Button, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import CallDetail from './CallDetail'
import CallbacksTab from './CallbacksTab'
import CallsTab from './CallsTab'
import SettingsWizard from './SettingsWizard'
import { ERRORS, MODE_LABEL, getLocation, setKillSwitch, type LocationConfig } from './api'
import './telefon.css'

type Tab = 'samtal' | 'uppringningar' | 'installningar'

/**
 * Telefon (planfunktionen "phoneAgent", ägare och personal): samtalen med
 * utskrift, vem som vill bli uppringd och en knapp som stänger av assistenten
 * direkt. Inställningarna (kom igång och Fler inställningar) är ägarens.
 */
export default function TelefonPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.phoneAgent)

  return (
    <>
      <AdminTopbar title="Telefon" />
      <main className="admin-main">
        {enabled ? <Telefon /> : (
          <section className="admin-card table-card">
            <h2 className="card-title">Ingår inte i er plan</h2>
            <p className="cell-muted">Kontakta oss för att uppgradera.</p>
          </section>
        )}
      </main>
    </>
  )
}

function Telefon() {
  const state = useTenant()
  const owner = state.tenant?.role === 'owner_user'
  const location = currentLocation(state)
  const locationId = location?.locationId
  const { callId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('samtal')
  const [config, setConfig] = useState<LocationConfig | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!locationId) return
    try {
      setConfig(await getLocation(locationId))
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta telefoninställningarna.', ERRORS), { tone: 'danger' })
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => {
    if (locationId) setConfig(await getLocation(locationId))
  }, { enabled: Boolean(locationId) })

  if (!locationId) return <p className="cell-muted">Hämtar…</p>

  async function toggleKill() {
    if (!config || !locationId) return
    setBusy(true)
    try {
      const next = await setKillSwitch(locationId, !config.killSwitch, config.version)
      setConfig({ ...config, ...next })
      toast(next.killSwitch ? 'Assistenten är avstängd. Samtal går inte längre till den.' : 'Assistenten svarar igen.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Det gick inte.', ERRORS), { tone: 'danger' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (callId) return <CallDetail locationId={locationId} callId={callId} owner={owner} onBack={() => navigate('/telefon')} />

  const items = [
    { key: 'samtal', label: 'Samtal' },
    { key: 'uppringningar', label: 'Återuppringningar' },
    ...(owner ? [{ key: 'installningar', label: 'Inställningar' }] : []),
  ]
  return (
    <>
      {/* På först när numret är vidarekopplat: innan dess når inga samtal assistenten. */}
      {config?.enabled && (config.setup?.forwardedAt || config.killSwitch) ? (
        <Bar variant="banner" tone={config.killSwitch ? 'warning' : 'info'} action={
          <Button size="sm" variant={config.killSwitch ? 'primary' : 'danger'} busy={busy} busyLabel="Sparar…" onClick={() => void toggleKill()}>
            {config.killSwitch ? 'Slå på assistenten' : 'Stäng av assistenten nu'}
          </Button>
        }>
          {config.killSwitch ? 'Assistenten är avstängd. Samtalen går som vanligt till er.'
            : `Assistenten svarar ${MODE_LABEL[config.mode].toLowerCase()}.`}
        </Bar>
      ) : (
        <Bar variant="banner" tone="info" action={owner && tab !== 'installningar'
          ? <Button size="sm" variant="primary" onClick={() => setTab('installningar')}>Kom igång</Button> : undefined}>
          {owner ? (config?.enabled ? 'Assistenten är inte klar än.' : 'Assistenten är inte på än.') : 'Assistenten är inte på för den här platsen.'}
        </Bar>
      )}
      <div className="telefon-section">
        <Bar variant="tab" kind="track" label="Telefon" items={items} value={tab} onChange={(k) => setTab(k as Tab)}
          panelId={(k) => `telefon-panel-${k}`} />
      </div>
      <div id={`telefon-panel-${tab}`} role="tabpanel">
        {tab === 'samtal' ? <CallsTab locationId={locationId} owner={owner} /> : null}
        {tab === 'uppringningar' ? <CallbacksTab locationId={locationId} /> : null}
        {tab === 'installningar' && owner ? <SettingsWizard locationId={locationId} onSaved={(c) => setConfig(c)} /> : null}
      </div>
    </>
  )
}
