import { useEffect, useRef, useState } from 'react'
import { Bar, Button, LinkButton, Printing } from '@booqy/brand'
import { Icon } from '../../shared/Icon'
import { formatPhone } from '../../shared/phone'
import { errorText } from '../../shared/errors'
import { ERRORS, REFUSED_LABEL, SETUP, listCalls, postSetupPatch, today, type LocationConfig } from './api'
import { insideHours, type Step } from './setup'

/** Hur ofta och hur länge steg 5 tittar efter provsamtalet. */
export const POLL_MS = 4000
export const WAIT_MS = 3 * 60 * 1000
/** Ett samtal som började strax innan man tryckte räknas också. */
const EARLY_MS = 30000

export type TestStatus = 'idle' | 'waiting' | 'ok' | 'refused' | 'none' | 'failed'
export interface TestState { since: number | null; status: TestStatus; reason?: string }

/**
 * Steg 5: ring och se att det fungerar. I prod ringer man restaurangens eget
 * nummer (då provas vidarekopplingen också), i dev testlinjen. Samtalslistan
 * hämtas var fjärde sekund i högst tre minuter, bara medan fliken syns.
 */
export default function TestCallStep({ locationId, loc, restaurantPhone, test, onTest, onTested, onGoStep, onDone }: {
  locationId: string
  loc: LocationConfig
  restaurantPhone: string | null
  test: TestState
  onTest: (t: TestState) => void
  onTested: (loc: LocationConfig) => void
  onGoStep: (s: Step) => void
  onDone: () => void
}) {
  const [round, setRound] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dev = Boolean(loc.simulated)
  const target = dev ? (loc.testNumber ?? loc.number) : (restaurantPhone ?? loc.number)

  function start() {
    onTest({ since: Date.now() - EARLY_MS, status: 'waiting' })
    setRound((r) => r + 1)
  }

  async function markTested(current: LocationConfig) {
    setSaveError(null)
    try {
      onTested(await postSetupPatch(locationId, current, { tested: true }))
    } catch (err) {
      setSaveError(errorText(err, 'Vi kunde inte spara att det fungerar.', ERRORS))
    }
  }

  const { status, since } = test
  const waiting = status === 'waiting'
  // Det senaste läget för pollningen, utan att starta om den vid varje rendering.
  const latest = useRef({ onTest, markTested, loc })
  useEffect(() => { latest.current = { onTest, markTested, loc } })
  useEffect(() => {
    if (!waiting || since === null) return
    const report = (t: TestState) => latest.current.onTest(t)
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let fails = 0
    const deadline = Date.now() + WAIT_MS
    async function tick() {
      timer = undefined
      if (stopped || document.hidden) return
      try {
        const { calls } = await listCalls(locationId, today(), today())
        if (stopped) return
        fails = 0
        const hit = calls.find((c) => Date.parse(c.startedAt) >= (since as number))
        if (hit) {
          if (hit.outcome === 'refused') {
            report({ since, status: 'refused', reason: hit.refusedReason ?? undefined })
          } else {
            report({ since, status: 'ok' })
            void latest.current.markTested(latest.current.loc)
          }
          return
        }
      } catch {
        if (stopped) return
        fails += 1
        if (fails >= 3) {
          report({ since, status: 'failed' })
          return
        }
      }
      if (Date.now() >= deadline) {
        report({ since, status: 'none' })
        return
      }
      timer = setTimeout(() => void tick(), POLL_MS)
    }
    function onVisible() {
      if (document.hidden) {
        if (timer) clearTimeout(timer)
        timer = undefined
      } else if (!timer) {
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // Startas om bara när man trycker Ring nu, Jag ringer nu eller Vänta igen.
  }, [waiting, since, round, locationId])

  if (status === 'ok') {
    return (
      <div className="telefon-step-body">
        <Bar variant="banner" tone="success">
          <span className="telefon-done"><Icon name="check" size={22} /> <strong>Det fungerar!</strong></span>
        </Bar>
        <p className="telefon-line">Samtalet syns under Samtal.</p>
        {saveError ? (
          <Bar variant="banner" tone="danger" action={<Button size="sm" variant="secondary" onClick={() => void markTested(loc)}>{SETUP.buttons.retry}</Button>}>
            {saveError}
          </Bar>
        ) : null}
        <Button variant="primary" type="button" wide onClick={onDone}>{SETUP.buttons.done}</Button>
      </div>
    )
  }

  const offHint = loc.mode === 'after_hours' && !insideHours(loc.agentHours, new Date())

  return (
    <div className="telefon-step-body">
      {status === 'idle' || status === 'none' || status === 'failed' || status === 'refused' ? (
        <>
          {target ? (
            <>
              <p className="telefon-line">Ring det här numret</p>
              <div className="telefon-bignumber">
                <span className="telefon-bignumber__value telefon-mono">{formatPhone(target)}</span>
                {dev ? <span className="telefon-tag">Testlinje i dev</span> : null}
              </div>
              <div className="telefon-row">
                <LinkButton variant="primary" className="telefon-call" href={`tel:${target}`} onClick={start}>
                  <Icon name="phone" size={18} /> {SETUP.buttons.callNow}
                </LinkButton>
                <Button type="button" variant="secondary" onClick={start}>{SETUP.buttons.callingOther}</Button>
              </div>
              {!dev && loc.number && target !== loc.number ? (
                <a className="telefon-link" href={`tel:${loc.number}`} onClick={start}>
                  Eller ring Booqy-numret direkt: {formatPhone(loc.number)}
                </a>
              ) : null}
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => onGoStep('nummer')}>Skaffa ert Booqy-nummer först</Button>
          )}
        </>
      ) : null}

      {status === 'waiting' ? (
        <>
          <Printing label="Väntar på samtalet" />
          <p className="telefon-line">Säg till exempel: Jag vill boka bord.</p>
        </>
      ) : null}

      {status === 'refused' ? (
        <Bar variant="banner" tone="warning" action={test.reason === 'hours'
          ? <Button size="sm" variant="secondary" onClick={() => onGoStep('tider')}>Ändra tider</Button> : undefined}>
          Samtalet kom fram men assistenten svarade inte: {REFUSED_LABEL[test.reason ?? ''] ?? 'okänd orsak'}.
        </Bar>
      ) : null}

      {status === 'none' ? (
        <Bar variant="banner" tone="warning">
          <strong>Inget samtal ännu</strong>
          <ul className="telefon-checks">
            <li>
              Har ni ringt koden i steg 4?{' '}
              <button type="button" className="telefon-link" onClick={() => onGoStep('koppla')}>Till steg 4</button>
            </li>
            <li>Ringde ni från en annan telefon än restaurangens?</li>
            {offHint ? <li>Står läget på När ni har stängt? Då svarar den bara när ni har stängt.</li> : null}
          </ul>
          <span className="telefon-row">
            <Button size="sm" variant="primary" onClick={start}>{SETUP.buttons.waitAgain}</Button>
            <Button size="sm" variant="secondary" onClick={onDone}>{SETUP.buttons.skip}</Button>
          </span>
        </Bar>
      ) : null}

      {status === 'failed' ? (
        <Bar variant="banner" tone="danger" action={<Button size="sm" variant="secondary" onClick={start}>{SETUP.buttons.retry}</Button>}>
          Vi kan inte se samtalen just nu. Det är vårt fel.
        </Bar>
      ) : null}
    </div>
  )
}
