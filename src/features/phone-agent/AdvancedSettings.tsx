import { useState, type FormEvent, type ReactNode } from 'react'
import { Bar, Button, Field, Input, Select, toast } from '@booqy/brand'
import { Disclosure } from '../../shared/Disclosure'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { PhoneInput } from '../../shared/PhoneInput'
import { toE164 } from '../../shared/phone'
import { withBusy } from '../../shared/motion/busy'
import { errorText } from '../../shared/errors'
import { ApiError } from '../../shared/api'
import SimulatorPanel from './SimulatorPanel'
import {
  DAYS, ERRORS, saveConfigPatch, saveLocationPatch,
  type Config, type Day, type LocationConfig,
} from './api'

type Errors = Record<string, string | undefined>

/**
 * Ett avsnitt med egen Spara: felet hamnar på fältet servern pekar ut, annars
 * som en rad med Försök igen.
 */
function Group({ title, info, onSave, children, setFieldErrors }: {
  title: string
  info?: ReactNode
  onSave: () => Promise<Errors | void>
  children: ReactNode
  setFieldErrors: (e: Errors) => void
}) {
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  async function save(e?: FormEvent) {
    e?.preventDefault()
    setBanner(null)
    setBusy(true)
    try {
      const invalid = await withBusy(onSave)
      if (invalid && Object.values(invalid).some(Boolean)) {
        setFieldErrors(invalid)
        return
      }
      setFieldErrors({})
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      const text = errorText(err, 'Kunde inte spara.', ERRORS)
      const field = err instanceof ApiError ? err.field : undefined
      if (field) setFieldErrors({ [field]: text })
      else setBanner(text)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="telefon-group form-grid" noValidate onSubmit={(e) => void save(e)} aria-label={title}>
      <div className="telefon-q telefon-q--small">
        <h3>{title}</h3>
        {info ? <InfoTooltip label={title}>{info}</InfoTooltip> : null}
      </div>
      {children}
      {banner ? (
        <Bar variant="banner" tone="danger" action={<Button size="sm" variant="secondary" type="button" onClick={() => void save()}>Försök igen</Button>}>
          {banner}
        </Bar>
      ) : null}
      <div className="telefon-group__save">
        <Button type="submit" busy={busy} busyLabel="Sparar…">Spara</Button>
      </div>
    </form>
  )
}

/** "Fler inställningar": dagens fält, var och en med egen Spara. */
export default function AdvancedSettings({ locationId, config, loc, restaurantPhone, includedMinutes, onConfig, onLoc }: {
  locationId: string
  config: Config
  loc: LocationConfig
  restaurantPhone: string | null
  includedMinutes: number | null
  onConfig: (c: Config) => void
  onLoc: (l: LocationConfig) => void
}) {
  const [tone, setTone] = useState(config.tone)
  const [greetSv, setGreetSv] = useState(loc.greetingExtraSv)
  const [greetEn, setGreetEn] = useState(loc.greetingExtraEn)
  const [hours, setHours] = useState(loc.agentHours)
  const [transfer, setTransfer] = useState(loc.transferTo ?? '')
  const [maxMin, setMaxMin] = useState(String(Math.round(loc.maxCallSeconds / 60)))
  const [offers, setOffers] = useState(loc.counterOffers)
  const [cap, setCap] = useState(String(config.minutesCapPerMonth))
  const [rec, setRec] = useState(config.recording)
  const [errors, setErrors] = useState<Record<string, Errors>>({})
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  const errs = (group: string) => errors[group] ?? {}
  const setErrs = (group: string) => (e: Errors) => setErrors((prev) => ({ ...prev, [group]: e }))
  const saveLoc = async (patch: Parameters<typeof saveLocationPatch>[2]) => onLoc(await saveLocationPatch(locationId, loc, patch, onLoc))
  const saveCfg = async (patch: Parameters<typeof saveConfigPatch>[1]) => onConfig(await saveConfigPatch(config, patch, onConfig))

  function setDay(day: Day, field: 'from' | 'to', value: string) {
    const span = { from: '17:00', to: '23:00', ...(hours[day]?.[0] ?? {}), [field]: value }
    setHours({ ...hours, [day]: value ? [span] : [] })
  }

  async function stop() {
    setStopping(true)
    setStopError(null)
    try {
      onLoc(await withBusy(() => saveLocationPatch(locationId, loc, { enabled: false }, onLoc)))
      toast('Assistenten är avstängd. Numret sparas i 30 dagar.', { tone: 'success' })
    } catch (err) {
      setStopError(errorText(err, 'Kunde inte stänga av.', ERRORS))
    } finally {
      setStopping(false)
    }
  }

  return (
    <Disclosure title="Fler inställningar" className="telefon-more">
      <div className="telefon-groups">
        <Group title="Ton" setFieldErrors={setErrs('tone')} onSave={() => saveCfg({ tone })}>
          <Field label="Ton">
            <Select value={tone} onChange={(e) => setTone(e.target.value as Config['tone'])}>
              <option value="friendly">Vänlig</option>
              <option value="formal">Formell</option>
            </Select>
          </Field>
        </Group>

        <Group title="Hälsning" info="Det assistenten säger efter: Hej, du pratar med ..., en AI-assistent för ... Den meningen går inte att ändra."
          setFieldErrors={setErrs('greet')}
          onSave={() => saveLoc({ greetingExtraSv: greetSv, greetingExtraEn: greetEn })}>
          <Field label="Svenska" error={errs('greet').greetingExtraSv}>
            <Input value={greetSv} maxLength={200} placeholder="Vad kan jag hjälpa dig med?" onChange={(e) => setGreetSv(e.target.value)} />
          </Field>
          <Field label="Engelska" error={errs('greet').greetingExtraEn}>
            <Input value={greetEn} maxLength={200} placeholder="How can I help you?" onChange={(e) => setGreetEn(e.target.value)} />
          </Field>
        </Group>

        <Group title="Tider" info="Tomt betyder att assistenten inte svarar den dagen. Läget Alltid svarar dygnet runt."
          setFieldErrors={setErrs('hours')} onSave={() => saveLoc({ agentHours: hours })}>
          {loc.mode === 'always' ? <p className="telefon-hint">Läget är Alltid: assistenten svarar dygnet runt.</p> : (
            <fieldset className="telefon-hours">
              <legend className="bq-sr-only">Assistentens tider</legend>
              {DAYS.map((d) => (
                <div key={d.key} className="telefon-hours__row">
                  <span>{d.label}</span>
                  <Input type="time" aria-label={`${d.label} från`} value={hours[d.key]?.[0]?.from ?? ''} onChange={(e) => setDay(d.key, 'from', e.target.value)} />
                  <Input type="time" aria-label={`${d.label} till`} value={hours[d.key]?.[0]?.to ?? ''} onChange={(e) => setDay(d.key, 'to', e.target.value)} />
                </div>
              ))}
              {errs('hours').agentHours ? <span className="bq-field__msg">{errs('hours').agentHours}</span> : null}
            </fieldset>
          )}
        </Group>

        <Group title="Koppla samtal till" info="Vill den som ringer prata med er kopplar assistenten hit. Svarar ingen inom 25 sekunder erbjuder den att ni ringer upp. Tomt: ingen koppling."
          setFieldErrors={setErrs('transfer')}
          onSave={async () => {
            if (transfer && restaurantPhone && toE164(transfer) === toE164(restaurantPhone)) {
              document.getElementById('pa-transfer')?.focus()
              return { transferTo: ERRORS.transfer_is_forwarded }
            }
            await saveLoc({ transferTo: transfer || null })
          }}>
          <Field label="Nummer" error={errs('transfer').transferTo}>
            <PhoneInput id="pa-transfer" className="bq-input" value={transfer} onChange={setTransfer} />
          </Field>
        </Group>

        <Group title="Längsta samtal" info="2 till 15 minuter. Erbjudandena gäller när den tid gästen vill ha är full."
          setFieldErrors={setErrs('call')}
          onSave={async () => {
            const minutes = Number(maxMin)
            if (!Number.isInteger(minutes) || minutes < 2 || minutes > 15) {
              document.getElementById('pa-maxcall')?.focus()
              return { maxCallSeconds: ERRORS.invalid_max_call }
            }
            await saveLoc({ maxCallSeconds: minutes * 60, counterOffers: offers })
          }}>
          <Field label="Minuter" error={errs('call').maxCallSeconds}>
            <Input id="pa-maxcall" type="number" inputMode="numeric" min={2} max={15} value={maxMin} onChange={(e) => setMaxMin(e.target.value)} />
          </Field>
          <label className="telefon-check">
            <input type="checkbox" checked={offers.nearbyTables} onChange={(e) => setOffers({ ...offers, nearbyTables: e.target.checked })} />
            Erbjud bord bredvid varandra eller ett större bord
          </label>
          <label className="telefon-check">
            <input type="checkbox" checked={offers.phoneOnlyTables} onChange={(e) => setOffers({ ...offers, phoneOnlyTables: e.target.checked })} />
            Erbjud bord ni bara bokar per telefon
          </label>
        </Group>

        <Group title="Minuttak" info={includedMinutes !== null ? `Minuter per månad. Ingår i er plan: ${includedMinutes}.` : 'Minuter per månad.'}
          setFieldErrors={setErrs('cap')}
          onSave={async () => {
            const n = Number(cap)
            if (!Number.isInteger(n) || n < 0) {
              document.getElementById('pa-cap')?.focus()
              return { minutesCapPerMonth: ERRORS.invalid_cap }
            }
            await saveCfg({ minutesCapPerMonth: n })
          }}>
          <Field label="Minuter per månad" error={errs('cap').minutesCapPerMonth}>
            <Input id="pa-cap" type="number" inputMode="numeric" min={0} value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
        </Group>

        <Group title="Inspelning" info="Av som standard. När den är på hör den som ringer: Samtalet spelas in."
          setFieldErrors={setErrs('rec')}
          onSave={async () => {
            if (rec.enabled && (rec.purpose ?? '').trim().length < 5) {
              document.getElementById('pa-purpose')?.focus()
              return { 'recording.purpose': 'Skriv varför, minst 5 tecken.' }
            }
            await saveCfg({ recording: rec.enabled ? { enabled: true, purpose: (rec.purpose ?? '').trim(), retentionDays: rec.retentionDays ?? 30 } : { enabled: false } })
          }}>
          <label className="telefon-check">
            <input type="checkbox" checked={rec.enabled} onChange={(e) => setRec({ ...rec, enabled: e.target.checked })} />
            Spela in samtalen
          </label>
          {rec.enabled ? (
            <>
              <Field label="Varför spelar ni in?" error={errs('rec')['recording.purpose']}>
                <Input id="pa-purpose" value={rec.purpose ?? ''} maxLength={300} onChange={(e) => setRec({ ...rec, purpose: e.target.value })} />
              </Field>
              <Field label="Spara inspelningarna">
                <Select value={String(rec.retentionDays ?? 30)} onChange={(e) => setRec({ ...rec, retentionDays: Number(e.target.value) })}>
                  <option value="7">7 dagar</option><option value="30">30 dagar</option><option value="90">90 dagar</option>
                </Select>
              </Field>
            </>
          ) : null}
        </Group>

        <section className="telefon-group" aria-label="Prova att skriva">
          <div className="telefon-q telefon-q--small">
            <h3>Prova att skriva</h3>
            <InfoTooltip label="Prova att skriva">Skriv som om du ringde. Assistenten kollar riktiga lediga tider men bokar ingenting här.</InfoTooltip>
          </div>
          <SimulatorPanel locationId={locationId} />
        </section>

        {loc.enabled ? (
          <section className="telefon-group" aria-label="Stäng av">
            {stopError ? (
              <Bar variant="banner" tone="danger" action={<Button size="sm" variant="secondary" onClick={() => void stop()}>Försök igen</Button>}>{stopError}</Bar>
            ) : null}
            <Button variant="danger" busy={stopping} busyLabel="Sparar…" onClick={() => void stop()}>Stäng av assistenten för platsen</Button>
          </section>
        ) : null}
      </div>
    </Disclosure>
  )
}
