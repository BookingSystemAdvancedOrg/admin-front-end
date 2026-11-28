import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Bar, Button, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import { NoLocation } from '../../shared/NoLocation'
import { PlanLocked } from '../../shared/PlanLocked'
import { Loading } from '../../shared/Loading'
import CallDetail from './CallDetail'
import CallbacksTab from './CallbacksTab'
import CallsTab from './CallsTab'
import SettingsWizard from './SettingsWizard'
import { ERRORS, MODE_LABEL, getLocation, setKillSwitch, type LocationConfig } from './api'
import { STEPS, type Step } from './setup'
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
        {enabled ? <Telefon /> : <PlanLocked />}
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
  // Från Kom igång på Översikt: /telefon?flik=installningar&steg=koppla öppnar guiden på steget.
  const [params, setParams] = useSearchParams()
  const linkedStep = STEPS.find((s) => s === params.get('steg')) ?? null
  const [tab, setTab] = useState<Tab>(owner && params.get('flik') === 'installningar' ? 'installningar' : 'samtal')
  const [startAt] = useState<Step | null>(linkedStep)
  const [config, setConfig] = useState<LocationConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const tabs = useRef<HTMLDivElement>(null)

  // Länken är läst: ta bort flik och steg, så att en omladdning inte öppnar guiden på ett gammalt steg.
  useEffect(() => {
    if (params.has('flik') || params.has('steg')) setParams({}, { replace: true })
  }, [params, setParams])

  // På en smal skärm rullar flikarna i sidled: visa den valda helt.
  useEffect(() => {
    // Flikraden själv rullar (brand), annars rutan runt den. [role=tablist]
    // utan citattecken med flit: brand-lints bar-regel läser annars
    // väljarsträngen som en egenbyggd flikrad.
    const el = tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const bar = [el?.closest<HTMLElement>('[role=tablist]'), tabs.current].find((b) => b && b.scrollWidth > b.clientWidth)
    if (!el || !bar) return
    const at = el.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft
    bar.scrollLeft = at - (bar.clientWidth - el.offsetWidth) / 2
  }, [tab, config])

  const load = useCallback(async () => {
    if (!locationId) return
    try {
      setConfig(await getLocation(locationId))
    } catch (err) {
      toast(errorText(err, 'Telefoninställningarna kunde inte visas.', ERRORS), { tone: 'danger' })
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => {
    if (locationId) setConfig(await getLocation(locationId))
  }, { enabled: Boolean(locationId) })

  // Restaurangen är hämtad men har ingen (eller en borttagen) plats: inget att vänta på.
  if (!locationId) return state.tenant ? <NoLocation /> : <Loading label="Hämtar" />

  async function toggleKill() {
    if (!config || !locationId) return
    setBusy(true)
    try {
      const next = await setKillSwitch(locationId, !config.killSwitch, config.version)
      setConfig({ ...config, ...next })
      toast(next.killSwitch ? 'Assistenten är avstängd. Samtal går inte längre till den.' : 'Assistenten svarar igen.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, config.killSwitch ? 'Assistenten slogs inte på.' : 'Assistenten stängdes inte av.', ERRORS), { tone: 'danger' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (callId) return <CallDetail locationId={locationId} callId={callId} owner={owner} />

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
      <div className="telefon-section" ref={tabs}>
        <Bar variant="tab" kind="track" label="Telefon" items={items} value={tab} onChange={(k) => setTab(k as Tab)}
          panelId={(k) => `telefon-panel-${k}`} />
      </div>
      <div id={`telefon-panel-${tab}`} role="tabpanel">
        {tab === 'samtal' ? <CallsTab locationId={locationId} owner={owner} /> : null}
        {tab === 'uppringningar' ? <CallbacksTab locationId={locationId} /> : null}
        {tab === 'installningar' && owner ? <SettingsWizard locationId={locationId} startAt={startAt} onSaved={(c) => setConfig(c)} /> : null}
      </div>
    </>
  )
}
