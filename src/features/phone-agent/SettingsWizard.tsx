import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Printing, Select, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { useTenant } from '../../shared/tenant'
import SimulatorPanel from './SimulatorPanel'
import { DAYS, ERRORS, MODE_LABEL, getLocation, getOverview, saveConfig, saveLocation, type Config, type Day, type LocationConfig, type Mode, type Overview } from './api'

type Step = 'namn' | 'tider' | 'koppla' | 'inspelning' | 'nummer' | 'prova'
const STEPS: { key: Step; label: string }[] = [
  { key: 'namn', label: '1. Namn och ton' }, { key: 'tider', label: '2. Tider och läge' }, { key: 'koppla', label: '3. Vidarekoppling' },
  { key: 'inspelning', label: '4. Inspelning' }, { key: 'nummer', label: '5. Nummer' }, { key: 'prova', label: '6. Prova' },
]

/** "Så svarar vi i telefon": ägarens inställningar, ett steg i taget. Varje steg sparas för sig. */
export default function SettingsWizard({ locationId, onSaved }: { locationId: string; onSaved: (c: LocationConfig) => void }) {
  const { tenant } = useTenant()
  const restaurant = tenant?.locations?.find((l) => l.locationId === locationId)?.name ?? 'restaurangen'
  const [step, setStep] = useState<Step>('namn')
  const [config, setConfig] = useState<Config | null>(null)
  const [cap, setCap] = useState<{ cap: number; included: number } | null>(null)
  const [loc, setLoc] = useState<LocationConfig | null>(null)
  const [others, setOthers] = useState<Overview['locations']>([])
  const [share, setShare] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [overview, location] = await Promise.all([getOverview(), getLocation(locationId)])
      setConfig(overview.config)
      setCap({ cap: overview.usage.cap, included: overview.usage.includedMinutes })
      setLoc(location)
      setOthers(overview.locations.filter((l) => l.locationId !== locationId && l.enabled && l.number))
    } catch (err) {
      // Utan detta stod fliken på "Hämtar…" för alltid när hämtningen misslyckades.
      setLoadError(errorText(err, 'Kunde inte hämta inställningarna.', ERRORS))
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])

  if (loadError) {
    return (
      <Bar variant="banner" tone="danger">
        {loadError} <Button variant="secondary" onClick={() => void load()}>Försök igen</Button>
      </Bar>
    )
  }
  if (!config || !loc) return <Printing label="Hämtar inställningarna" />

  async function storeConfig(next: Config) {
    setSaving(true)
    try {
      setConfig(await saveConfig(next))
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function storeLocation(next: LocationConfig, ok = 'Sparat.', shareNumberWith?: string) {
    setSaving(true)
    try {
      const saved = await saveLocation(locationId, {
        enabled: next.enabled, mode: next.mode, agentHours: next.agentHours, greetingExtraSv: next.greetingExtraSv,
        greetingExtraEn: next.greetingExtraEn, transferTo: next.transferTo || null, maxCallSeconds: next.maxCallSeconds,
        counterOffers: next.counterOffers, version: next.version,
        ...(next.enabled && (shareNumberWith ?? next.numberSharedWith) ? { shareNumberWith: shareNumberWith ?? next.numberSharedWith } : {}),
      })
      setLoc(saved)
      onSaved(saved)
      toast(ok, { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const otherName = (id?: string | null) => others.find((o) => o.locationId === id)?.name
    ?? tenant?.locations?.find((l) => l.locationId === id)?.name ?? 'den andra platsen'

  function setHours(day: Day, field: 'from' | 'to', value: string) {
    if (!loc) return
    const span = { from: '17:00', to: '23:00', ...(loc.agentHours[day]?.[0] ?? {}), [field]: value }
    setLoc({ ...loc, agentHours: { ...loc.agentHours, [day]: value ? [span] : [] } })
  }

  const save = (label: string, onClick: () => void) => (
    <Bar variant="action" label={label}>
      <Button busy={saving} busyLabel="Sparar…" onClick={onClick}>Spara</Button>
    </Bar>
  )

  return (
    <Card title="Så svarar vi i telefon">
      <div className="telefon-section">
        <Bar variant="tab" kind="bare" label="Steg" items={STEPS} value={step} onChange={(k) => setStep(k as Step)} panelId={(k) => `telefon-step-${k}`} />
      </div>
      <div id={`telefon-step-${step}`} role="tabpanel" className="form-grid">
        {step === 'namn' ? (
          <>
            <Field label="Assistentens namn" required>
              <Input value={config.agentName} maxLength={40} onChange={(e) => setConfig({ ...config, agentName: e.target.value })} />
            </Field>
            <Field label="Ton">
              <Select value={config.tone} onChange={(e) => setConfig({ ...config, tone: e.target.value as Config['tone'] })}>
                <option value="friendly">Vänlig och personlig</option>
                <option value="formal">Saklig och formell</option>
              </Select>
            </Field>
            <p className="telefon-fixed">
              Assistenten börjar alltid med: ”Hej, du pratar med {config.agentName || 'assistenten'}, en AI-assistent för {restaurant}.”
              Den meningen går inte att ändra: den som ringer ska veta att det är en AI.
            </p>
            <Field label="Sedan säger den (svenska)" hint="Till exempel: Vad kan jag hjälpa dig med?">
              <Input value={loc.greetingExtraSv} maxLength={200} onChange={(e) => setLoc({ ...loc, greetingExtraSv: e.target.value })} />
            </Field>
            <Field label="Sedan säger den (engelska)">
              <Input value={loc.greetingExtraEn} maxLength={200} onChange={(e) => setLoc({ ...loc, greetingExtraEn: e.target.value })} />
            </Field>
            <p className="telefon-fixed">
              Språk: assistenten börjar alltid på svenska. Pratar den som ringer ett annat språk byter den direkt till det
              språket (över 30 språk, till exempel engelska, arabiska, turkiska och polska) och säger igen, på det språket,
              att den är en AI.
            </p>
            <Field label="Minuttak per månad" hint={cap ? `Ingår i er plan: ${cap.included} minuter.` : undefined}>
              <Input type="number" min={0} value={String(config.minutesCapPerMonth)}
                onChange={(e) => setConfig({ ...config, minutesCapPerMonth: Number(e.target.value) })} />
            </Field>
            {save('Spara namn och ton', () => { void storeConfig(config).then(() => storeLocation(loc)) })}
          </>
        ) : null}
        {step === 'tider' ? (
          <>
            <Field label="När ska assistenten svara?">
              <Select value={loc.mode} onChange={(e) => setLoc({ ...loc, mode: e.target.value as Mode })}>
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </Select>
            </Field>
            {loc.mode !== 'always' ? (
              <fieldset className="telefon-hours">
                <legend>Assistentens tider (tomt = svarar inte den dagen)</legend>
                {DAYS.map((d) => (
                  <div key={d.key} className="telefon-hours__row">
                    <span>{d.label}</span>
                    <Input type="time" aria-label={`${d.label} från`} value={loc.agentHours[d.key]?.[0]?.from ?? ''} onChange={(e) => setHours(d.key, 'from', e.target.value)} />
                    <Input type="time" aria-label={`${d.label} till`} value={loc.agentHours[d.key]?.[0]?.to ?? ''} onChange={(e) => setHours(d.key, 'to', e.target.value)} />
                  </div>
                ))}
              </fieldset>
            ) : null}
            <Field label="Längsta samtal (minuter)" hint="2 till 15 minuter.">
              <Input type="number" min={2} max={15} value={String(Math.round(loc.maxCallSeconds / 60))}
                onChange={(e) => setLoc({ ...loc, maxCallSeconds: Number(e.target.value) * 60 })} />
            </Field>
            <label className="telefon-check">
              <input type="checkbox" checked={loc.counterOffers.nearbyTables}
                onChange={(e) => setLoc({ ...loc, counterOffers: { ...loc.counterOffers, nearbyTables: e.target.checked } })} />
              Erbjud bord bredvid varandra eller ett större bord när tiden är full
            </label>
            <label className="telefon-check">
              <input type="checkbox" checked={loc.counterOffers.phoneOnlyTables}
                onChange={(e) => setLoc({ ...loc, counterOffers: { ...loc.counterOffers, phoneOnlyTables: e.target.checked } })} />
              Assistenten får också erbjuda bord ni bara bokar per telefon
            </label>
            {save('Spara tider', () => void storeLocation(loc))}
          </>
        ) : null}
        {step === 'koppla' ? (
          <>
            <Field label="Koppla till det här numret" hint="Om någon vill prata med er. Svarar ingen inom 25 sekunder erbjuder assistenten att ni ringer upp.">
              <Input type="tel" value={loc.transferTo ?? ''} placeholder="+46812345678" onChange={(e) => setLoc({ ...loc, transferTo: e.target.value })} />
            </Field>
            {save('Spara vidarekoppling', () => void storeLocation(loc))}
          </>
        ) : null}
        {step === 'inspelning' ? (
          <>
            <label className="telefon-check">
              <input type="checkbox" checked={config.recording.enabled}
                onChange={(e) => setConfig({ ...config, recording: { ...config.recording, enabled: e.target.checked } })} />
              Spela in samtalen (av som standard)
            </label>
            {config.recording.enabled ? (
              <>
                <p className="telefon-fixed">Den som ringer får höra ”Samtalet spelas in.” innan assistenten presenterar sig.</p>
                <Field label="Varför spelar ni in?" required>
                  <Input value={config.recording.purpose ?? ''} maxLength={300}
                    onChange={(e) => setConfig({ ...config, recording: { ...config.recording, purpose: e.target.value } })} />
                </Field>
                <Field label="Spara inspelningarna">
                  <Select value={String(config.recording.retentionDays ?? 30)}
                    onChange={(e) => setConfig({ ...config, recording: { ...config.recording, retentionDays: Number(e.target.value) } })}>
                    <option value="7">7 dagar</option><option value="30">30 dagar</option><option value="90">90 dagar</option>
                  </Select>
                </Field>
              </>
            ) : null}
            {save('Spara inspelning', () => void storeConfig(config))}
          </>
        ) : null}
        {step === 'nummer' ? (
          <>
            {loc.enabled && loc.number ? (
              <>
                <p>Ert Booqy-nummer: <strong className="telefon-mono">{loc.number}</strong></p>
                {loc.numberSharedWith ? (
                  <p className="telefon-fixed">
                    Platsen svarar på samma nummer som {otherName(loc.numberSharedWith)}. Assistenten frågar först vilken restaurang
                    det gäller och pratar sedan bara om den.
                  </p>
                ) : null}
                <p className="cell-muted">Vidarekoppla restaurangens nummer hit med koderna nedan, från telefonen som har restaurangens nummer.</p>
                <ul className="telefon-codes">
                  {(loc.forwarding?.codes ?? []).map((c) => (
                    <li key={c.on}><span>{c.label}</span><span className="telefon-mono">{c.on}</span><span className="cell-muted">Stäng av: {c.off}</span></li>
                  ))}
                </ul>
                <Bar variant="action" label="Stäng av">
                  <Button variant="danger" busy={saving} busyLabel="Sparar…" onClick={() => void storeLocation({ ...loc, enabled: false }, 'Assistenten är avstängd. Numret sparas i 30 dagar.')}>
                    Stäng av assistenten för platsen
                  </Button>
                </Bar>
              </>
            ) : (
              <>
                <p className="cell-muted">
                  När ni slår på assistenten får platsen ett eget Booqy-nummer, och assistenten vet då direkt vilken plats samtalet gäller.
                  Sedan vidarekopplar ni ert nummer dit.
                </p>
                {others.length ? (
                  <Field label="Nummer" hint="Med ett delat nummer frågar assistenten först vilken restaurang det gäller.">
                    <Select value={share} onChange={(e) => setShare(e.target.value)}>
                      <option value="">Eget nummer för platsen</option>
                      {others.map((o) => <option key={o.locationId} value={o.locationId}>Samma nummer som {o.name}</option>)}
                    </Select>
                  </Field>
                ) : null}
                <Bar variant="action" label="Slå på">
                  <Button busy={saving} busyLabel={share ? 'Sparar…' : 'Skaffar nummer…'}
                    onClick={() => void storeLocation({ ...loc, enabled: true }, share ? 'Klart. Platsen svarar nu på det delade numret.' : 'Klart. Vidarekoppla nu ert nummer.', share || undefined)}>
                    {share ? 'Slå på med delat nummer' : 'Slå på och skaffa nummer'}
                  </Button>
                </Bar>
              </>
            )}
          </>
        ) : null}
        {step === 'prova' ? <SimulatorPanel locationId={locationId} /> : null}
      </div>
    </Card>
  )
}
