import { useEffect, useState } from 'react'
import { Bar } from '@booqy/brand'
import { useBusy } from './busy'

const DONE_MS = 900

/**
 * Strimman överst medan något sparas: vinrött rinner in från vänster, med
 * en liten vågig yta som rör sig så länge anropet pågår, och fyller ut
 * hela bredden och tonar bort när det är klart. Syns vid varje skrivning
 * (spara, publicera, skicka, bjuda in ...) så ingen tror att sidan hängt
 * sig. Skärmläsare får "Sparar" och "Sparat". Själva strimman är busy-varianten
 * av Bar i @booqy/brand (pilot för det gemensamma märket); fasen räknas här.
 */
export function BusyBar() {
  const { active, finishedAt, ok } = useBusy()
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')

  useEffect(() => {
    if (active) {
      setPhase('busy')
      return
    }
    if (!finishedAt) return
    // Misslyckades något: strimman går bort utan "Sparat" (felet visas vid fältet).
    if (!ok) {
      setPhase('idle')
      return
    }
    setPhase('done')
    const t = window.setTimeout(() => setPhase('idle'), DONE_MS)
    return () => window.clearTimeout(t)
  }, [active, finishedAt, ok])

  useEffect(() => {
    document.documentElement.classList.toggle('is-saving', phase === 'busy')
    return () => document.documentElement.classList.remove('is-saving')
  }, [phase])

  // busy-bar och busy-bar--<fas> finns kvar som krokar för testerna; utseendet kommer från Bar
  return <Bar variant="busy" phase={phase} className={`busy-bar busy-bar--${phase}`} busyLabel="Sparar…" doneLabel="Sparat" />
}
