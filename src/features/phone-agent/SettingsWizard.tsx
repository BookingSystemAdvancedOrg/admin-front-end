import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Bar, Button, Card, Field, Input, Printing, Select } from '@booqy/brand'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { ApiError } from '../../shared/api'
import { errorText } from '../../shared/errors'
import { withBusy } from '../../shared/motion/busy'
import { useTenant } from '../../shared/tenant'
import type { BusinessHours } from '../installningar/locationApi'
import AdvancedSettings from './AdvancedSettings'
import ForwardingStep, { BigNumber } from './ForwardingStep'
import SetupChecklist from './SetupChecklist'
import TestCallStep, { type TestState } from './TestCallStep'
import {
  ERRORS, MODE_LABEL, SETUP, getLocation, getOverview, getPlaceBasics, postSetupPatch, saveConfigPatch, saveLocationPatch,
  type Config, type LocationConfig, type Mode, type Operator, type Overview,
} from './api'
import { STEPS, dialSteps, forwardTarget, hasBusinessHours, hoursFor, hoursSet, hoursSummary, type Step } from './setup'

interface Data {
  config: Config
  loc: LocationConfig
  others: Overview['locations']
  includedMinutes: number
  businessHours: BusinessHours | null
  restaurantPhone: string | null
}

/**
 * Telefon > Inställningar (ägaren): checklistan "Kom igång" tills allt är
 * klart, och guiden med en fråga per skärm. Fler inställningar ligger
 * hopfällt under checklistan.
 */
export default function SettingsWizard({ locationId, onSaved }: { locationId: string; onSaved: (c: LocationConfig) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [wizardAt, setWizardAt] = useState<Step | null>(null)
  // Fler inställningar förblir utfällt efter Spara och efter guiden.
  const [moreOpen, setMoreOpen] = useState(false)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const [overview, loc, place] = await Promise.all([getOverview(), getLocation(locationId), getPlaceBasics(locationId)])
      setData({
        config: overview.config, loc, includedMinutes: overview.usage.includedMinutes,
        others: overview.locations.filter((l) => l.locationId !== locationId && l.enabled && l.number),
        businessHours: place.businessHours, restaurantPhone: place.phoneNumber,
      })
    } catch {
      setLoadError(true)
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])

  if (loadError) {
    return (
      <Bar variant="banner" tone="danger" action={<Button size="sm" variant="secondary" onClick={() => void load()}>{SETUP.buttons.retry}</Button>}>
        Vi kunde inte hämta inställningarna. Det är vårt fel.
      </Bar>
    )
  }
  if (!data) return <Printing label="Hämtar inställningarna" />

  const setConfig = (config: Config) => setData((d) => (d ? { ...d, config } : d))
  const setLoc = (loc: LocationConfig) => {
    setData((d) => (d ? { ...d, loc } : d))
    onSaved(loc)
  }

  if (wizardAt) {
    return (
      <Wizard locationId={locationId} data={data} start={wizardAt} onConfig={setConfig} onLoc={setLoc}
        onExit={() => setWizardAt(null)} />
    )
  }
  return (
    <SetupChecklist config={data.config} loc={data.loc} restaurantPhone={data.restaurantPhone} onOpen={setWizardAt}>
      <AdvancedSettings key={locationId} locationId={locationId} config={data.config} loc={data.loc} open={moreOpen} onOpenChange={setMoreOpen}
        restaurantPhone={data.restaurantPhone} includedMinutes={data.includedMinutes} onConfig={setConfig} onLoc={setLoc} />
    </SetupChecklist>
  )
}

type Sub = 'operator' | 'code'
interface Draft {
  step: Step
  sub: Sub
  codeIndex: number
  name: string
  mode: Mode
  share: string
  operator: Operator | ''
  errors: Partial<Record<string, string>>
  saving: boolean
  bannerError: string | null
  test: TestState
}

/** Fälten som hör till ett steg: ett serverfel på dem visas på fältet, annars som en rad. */
const FIELD_ID: Record<string, string> = { agentName: 'pa-name', mode: 'pa-mode', operator: 'pa-operator', shareNumberWith: 'pa-share' }

function Wizard({ locationId, data, start, onConfig, onLoc, onExit }: {
  locationId: string
  data: Data
  start: Step
  onConfig: (c: Config) => void
  onLoc: (l: LocationConfig) => void
  onExit: () => void
}) {
  const { tenant } = useTenant()
  const restaurant = tenant?.locations?.find((l) => l.locationId === locationId)?.name ?? 'restaurangen'
  const { config, loc, others, businessHours, includedMinutes } = data
  const hasHours = hasBusinessHours(businessHours)
  const target = forwardTarget(loc)
  const [d, setD] = useState<Draft>(() => ({
    step: start,
    sub: loc.setup?.operator ? 'code' : 'operator',
    codeIndex: 0,
    name: config.agentName || 'Booqy',
    mode: !hasHours ? 'always' : hoursSet(loc) ? loc.mode : 'after_hours',
    share: '',
    operator: loc.setup?.operator ?? '',
    errors: {},
    saving: false,
    bannerError: null,
    test: { since: null, status: 'idle' },
  }))
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const retry = useRef<(() => Promise<void>) | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  const n = STEPS.indexOf(d.step) + 1
  useEffect(() => {
    // Ny skärm: läs upp frågan (steg 1 fokuserar fältet själv).
    if (first.current) { first.current = false; if (d.step === 'namn') return }
    heading.current?.focus()
  }, [d.step, d.sub])

  function go(step: Step) {
    set({ step, errors: {}, bannerError: null, sub: step === 'koppla' ? (loc.setup?.operator ? 'code' : 'operator') : d.sub, codeIndex: 0 })
  }

  function after(step: Step) {
    const i = STEPS.indexOf(step)
    if (i === STEPS.length - 1) onExit()
    else go(STEPS[i + 1])
  }

  function invalid(field: string, text: string) {
    set({ errors: { [field]: text }, saving: false })
    setTimeout(() => document.getElementById(FIELD_ID[field] ?? field)?.focus(), 0)
  }

  /** Sparar, går vidare vid OK; vid fel stannar steget med felet på fältet eller som en rad med Försök igen. */
  async function run(save: () => Promise<void>) {
    retry.current = () => run(save)
    set({ saving: true, errors: {}, bannerError: null })
    try {
      await withBusy(save)
      set({ saving: false })
    } catch (err) {
      const text = errorText(err, 'Kunde inte spara.', ERRORS)
      const field = err instanceof ApiError && err.fromServer ? err.field : undefined
      if (field && FIELD_ID[field]) invalid(field, text)
      else set({ saving: false, bannerError: text })
    }
  }

  function next(e?: FormEvent) {
    e?.preventDefault()
    if (d.saving) return
    switch (d.step) {
      case 'namn': {
        const name = d.name.trim()
        if (!name) return invalid('agentName', ERRORS.agent_name_required)
        return void run(async () => {
          onConfig(await saveConfigPatch(config, { agentName: name }, onConfig))
          after('namn')
        })
      }
      case 'tider': {
        const mode = !hasHours ? 'always' : d.mode
        return void run(async () => {
          onLoc(await saveLocationPatch(locationId, loc, { mode, agentHours: hoursFor(mode, businessHours) }, onLoc))
          after('tider')
        })
      }
      case 'nummer':
        if (loc.enabled && loc.number) return after('nummer')
        return void run(async () => {
          // Tider hoppades över: spara läget och tiderna nu, annars svarar assistenten aldrig.
          const mode = !hasHours ? 'always' : d.mode
          const hours = hoursSet(loc) ? {} : { mode, agentHours: hoursFor(mode, businessHours) }
          onLoc(await saveLocationPatch(locationId, loc, { ...hours, enabled: true, shareNumberWith: d.share || null }, onLoc))
          after('nummer')
        })
      case 'koppla': {
        if (!loc.forwarding?.number) return go('nummer')
        if (d.sub === 'operator') {
          if (!d.operator) return invalid('operator', ERRORS.invalid_operator)
          const operator = d.operator
          return void run(async () => {
            onLoc(await postSetupPatch(locationId, loc, { operator }, onLoc))
            set({ sub: 'code', codeIndex: 0 })
          })
        }
        const codes = dialSteps(loc)
        if (d.codeIndex < codes.length - 1) return set({ codeIndex: d.codeIndex + 1 })
        return void run(async () => {
          onLoc(await postSetupPatch(locationId, loc, { forwarded: true }, onLoc))
          after('koppla')
        })
      }
      case 'prova':
        return onExit()
    }
  }

  function back() {
    if (d.step === 'koppla' && d.sub === 'code') {
      if (d.codeIndex > 0) return set({ codeIndex: d.codeIndex - 1 })
      return set({ sub: 'operator', errors: {}, bannerError: null })
    }
    const i = STEPS.indexOf(d.step)
    if (i > 0) go(STEPS[i - 1])
  }

  // Huvudknappens text per skärm.
  const vaxel = (loc.forwarding?.operator ?? d.operator) === 'vaxel'
  let primary: string = SETUP.buttons.next
  let busyLabel: string = SETUP.buttons.saving
  if (d.step === 'nummer' && !(loc.enabled && loc.number)) { primary = SETUP.buttons.getNumber; busyLabel = SETUP.buttons.gettingNumber }
  if (d.step === 'koppla' && d.sub === 'code' && loc.forwarding?.number) {
    const codes = dialSteps(loc)
    primary = vaxel ? SETUP.buttons.doneSwitch : d.codeIndex < codes.length - 1 ? SETUP.buttons.next : SETUP.buttons.called
  }
  // Steg 5 har ingen Klar i foten: man kommer ut genom att det fungerar (Klar där) eller med Hoppa över.
  const hidePrimary = (d.step === 'koppla' && !loc.forwarding?.number) || d.step === 'prova'

  const info: Partial<Record<Step, string>> = {
    namn: `Assistenten säger alltid: Hej, du pratar med ${d.name.trim() || 'Booqy'}, en AI-assistent för ${restaurant}.`,
    tider: 'Ni kan ändra tiderna under Fler inställningar.',
    nummer: [
      includedMinutes > 0 ? `Numret ingår i er plan, med ${includedMinutes} samtalsminuter per månad.` : 'Numret ingår i er plan.',
      others.length && !(loc.enabled && loc.number) ? 'Med samma nummer frågar assistenten först vilken restaurang det gäller.' : '',
    ].filter(Boolean).join(' '),
  }
  const question = d.step === 'koppla' && d.sub === 'operator' ? 'Vilken operatör har restaurangens telefon?' : SETUP.QUESTIONS[n - 1]

  return (
    <Card className="telefon-wizard">
      <p className="telefon-steps">{SETUP.progress(n)}</p>
      <Bar variant="progress" value={n / 5} label={SETUP.progress(n)} className="telefon-stepline" />
      <form noValidate onSubmit={next} className="telefon-wizard__form">
        <div className="telefon-q">
          <h2 ref={heading} tabIndex={-1}>{question}</h2>
          {info[d.step] ? <InfoTooltip label={SETUP.STEP_LABEL[n - 1]}>{info[d.step]}</InfoTooltip> : null}
        </div>

        {d.step === 'namn' ? (
          <div className="telefon-step-body">
            <Field label="Namn" error={d.errors.agentName}>
              <Input id="pa-name" value={d.name} maxLength={40} autoFocus enterKeyHint="next" autoComplete="off"
                onChange={(e) => set({ name: e.target.value, errors: {} })} />
            </Field>
            <p className="telefon-preview">”Hej, du pratar med {d.name.trim() || 'Booqy'}, en AI-assistent för {restaurant}.”</p>
          </div>
        ) : null}

        {d.step === 'tider' ? (
          <div className="telefon-step-body">
            <fieldset className="telefon-cards">
              <legend className="bq-sr-only">{SETUP.QUESTIONS[1]}</legend>
              {(['after_hours', 'overflow', 'always'] as Mode[]).map((m) => {
                const off = !hasHours && m !== 'always'
                return (
                  <label key={m} className={`telefon-card${off ? ' is-disabled' : ''}`}>
                    <input type="radio" name="pa-mode" value={m} id={m === 'after_hours' ? 'pa-mode' : undefined} disabled={off}
                      checked={(hasHours ? d.mode : 'always') === m} onChange={() => set({ mode: m })} />
                    <span>{MODE_LABEL[m]}</span>
                  </label>
                )
              })}
            </fieldset>
            {hasHours ? (
              <p className="telefon-hint">{d.mode === 'always' ? 'Dygnet runt' : hoursSummary(hoursFor(d.mode, businessHours))}</p>
            ) : (
              <p className="telefon-hint">Lägg in öppettider först. <Link to="/installningar">Öppna Inställningar</Link></p>
            )}
          </div>
        ) : null}

        {d.step === 'nummer' ? (
          <div className="telefon-step-body">
            {loc.enabled && loc.number && target ? (
              <BigNumber number={target} extra={loc.simulated ? <span className="telefon-tag">Testnummer i dev</span> : null} />
            ) : others.length ? (
              <Field label="Nummer" error={d.errors.shareNumberWith}>
                <Select id="pa-share" value={d.share} onChange={(e) => set({ share: e.target.value })}>
                  <option value="">Eget nummer</option>
                  {others.map((o) => <option key={o.locationId} value={o.locationId}>Samma som {o.name}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}

        {d.step === 'koppla' ? (
          <ForwardingStep loc={loc} sub={d.sub} codeIndex={d.codeIndex} operator={d.operator} error={d.errors.operator}
            onOperator={(operator) => set({ operator, errors: {} })} onGetNumber={() => go('nummer')} />
        ) : null}

        {d.step === 'prova' ? (
          <TestCallStep locationId={locationId} loc={loc} restaurantPhone={data.restaurantPhone} test={d.test}
            onTest={(test) => setD((prev) => ({ ...prev, test }))} onTested={onLoc} onGoStep={go} onDone={onExit} />
        ) : null}

        {d.bannerError ? (
          <Bar variant="banner" tone="danger" action={
            <Button size="sm" variant="secondary" type="button" onClick={() => void retry.current?.()}>{SETUP.buttons.retry}</Button>
          }>{d.bannerError}</Bar>
        ) : null}

        <div className="telefon-foot">
          {n > 1 ? <Button type="button" variant="secondary" onClick={back}>{SETUP.buttons.back}</Button> : <span />}
          {hidePrimary ? null : <Button variant="primary" type="submit" busy={d.saving} busyLabel={busyLabel}>{primary}</Button>}
        </div>
      </form>
      <button type="button" className="telefon-link telefon-tolist" onClick={onExit}>{SETUP.buttons.toList}</button>
    </Card>
  )
}

