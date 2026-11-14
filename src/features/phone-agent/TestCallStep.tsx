import { useEffect, useRef, useState } from 'react'
import { Bar, Button, LinkButton, Printing } from '@booqy/brand'
import { Icon } from '../../shared/Icon'
import { HowTo } from './ForwardingStep'
import { formatPhoneNational } from '../../shared/phone'
import { errorText } from '../../shared/errors'
import { ERRORS, MODE_LABEL, REFUSED_LABEL, SETUP, listCalls, postSetupPatch, today, type LocationConfig } from './api'
import type { Step } from './setup'

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
          // Nekad för att det var utanför assistentens tider: samtalet kom ändå
          // fram till Booqy, så vidarekopplingen fungerar.
          if (hit.outcome === 'refused' && hit.refusedReason === 'hours') {
            report({ since, status: 'ok', reason: 'hours' })
            void latest.current.markTested(latest.current.loc)
          } else if (hit.outcome === 'refused') {
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
        <p className="telefon-line">
          {test.reason === 'hours' ? `Assistenten svarar ${MODE_LABEL[loc.mode].toLowerCase()}.` : 'Samtalet syns under Samtal.'}
        </p>
        {saveError ? (
          <Bar variant="banner" tone="danger" action={<Button size="sm" variant="secondary" onClick={() => void markTested(loc)}>{SETUP.buttons.retry}</Button>}>
            {saveError}
          </Bar>
        ) : null}
        <Button variant="primary" type="button" wide onClick={onDone}>{SETUP.buttons.done}</Button>
      </div>
    )
  }

  // Restaurangens telefon ringer först: ring från en annan och svara inte.
  const ringsFirst = !dev && loc.mode !== 'always'

  return (
    <div className="telefon-step-body">
      {target ? (
        <>
          <HowTo label="Så gör du" steps={[
            {
              icon: 'phone',
              text: (
                <>
                  {ringsFirst ? 'Ring det här numret från en annan telefon (inte restaurangens):' : 'Ring det här numret från valfri telefon:'}
                  <span className="telefon-bignumber">
                    <span className="telefon-bignumber__value telefon-mono">{formatPhoneNational(target)}</span>
                    {dev ? <span className="telefon-tag">Testlinje i dev</span> : null}
                  </span>
                </>
              ),
            },
            { text: <>Säg hej och fråga till exempel ”När har ni öppet?”.{ringsFirst ? ' Svara inte i restaurangens telefon.' : ''}</> },
            { text: 'Lägg på. Vi visar här när samtalet har kommit in.' },
          ]} />
          {status !== 'waiting' ? (
            <div className="telefon-row">
              <LinkButton variant="primary" className="telefon-call" href={`tel:${target}`} onClick={start}>
                <Icon name="phone" size={18} /> {SETUP.buttons.callNow}
              </LinkButton>
              <Button type="button" variant="secondary" onClick={start}>{SETUP.buttons.callingOther}</Button>
            </div>
          ) : null}
          {status !== 'waiting' && !dev && loc.number && target !== loc.number ? (
            <a className="telefon-link" href={`tel:${loc.number}`} onClick={start}>
              Eller ring Booqy-numret direkt: {formatPhoneNational(loc.number)}
            </a>
          ) : null}
        </>
      ) : null}
      {!target ? (
        <Button type="button" variant="secondary" onClick={() => onGoStep('nummer')}>Skaffa ert Booqy-nummer först</Button>
      ) : null}

      {status === 'waiting' ? <Printing label="Väntar på samtalet" /> : null}

      {status === 'refused' ? (
        <Bar variant="banner" tone="warning">
          Samtalet kom fram men assistenten svarade inte: {REFUSED_LABEL[test.reason ?? ''] ?? 'okänd orsak'}.
        </Bar>
      ) : null}

      {status === 'none' ? (
        <Bar variant="banner" tone="warning">
          <strong>Inget samtal ännu?</strong>
          <ul className="telefon-checks">
            {target ? <li>Ringde du rätt nummer? <span className="telefon-mono telefon-nowrap">{formatPhoneNational(target)}</span></li> : null}
            {dev ? null : (
              <li>
                Har ni gjort steg 4, Vidarekoppling?{' '}
                <button type="button" className="telefon-link" onClick={() => onGoStep('koppla')}>Till steg 4</button>
              </li>
            )}
            {ringsFirst ? <li>Svarade någon i restaurangens telefon? Låt den ringa tills assistenten svarar.</li> : null}
            <li>Ring en gång till och tryck sedan på Vänta igen.</li>
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
