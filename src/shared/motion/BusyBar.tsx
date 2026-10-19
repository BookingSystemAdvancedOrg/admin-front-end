import { useEffect, useState } from 'react'
import { useBusy } from './busy'

const DONE_MS = 900

/**
 * Strimman överst medan något sparas: vinrött rinner in från vänster, med
 * en liten vågig yta som rör sig så länge anropet pågår, och fyller ut
 * hela bredden och tonar bort när det är klart. Syns vid varje skrivning
 * (spara, publicera, skicka, bjuda in ...) så ingen tror att sidan hängt
 * sig. Skärmläsare får "Sparar" och "Sparat".
 */
export function BusyBar() {
  const { active, finishedAt } = useBusy()
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')

  useEffect(() => {
    if (active) {
      setPhase('busy')
      return
    }
    if (!finishedAt) return
    setPhase('done')
    const t = window.setTimeout(() => setPhase('idle'), DONE_MS)
    return () => window.clearTimeout(t)
  }, [active, finishedAt])

  useEffect(() => {
    document.documentElement.classList.toggle('is-saving', phase === 'busy')
    return () => document.documentElement.classList.remove('is-saving')
  }, [phase])

  return (
    <div className={`busy-bar busy-bar--${phase}`} aria-hidden={phase === 'idle'}>
      <div className="busy-bar-fill">
        <span className="busy-bar-wave" />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {phase === 'busy' ? 'Sparar…' : phase === 'done' ? 'Sparat' : ''}
      </span>
    </div>
  )
}
