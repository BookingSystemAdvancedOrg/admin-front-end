import type { CSSProperties } from 'react'
import { setSoundVolume, useSound, useSoundVolume } from './press'

/**
 * Hur högt klickljudet låter, 0-100 %. Sparas medan man drar; ett klick hörs
 * när man släpper så att man hör nivån. Avstängt när klickljudet är av.
 */
export function SoundVolume({ id }: { id: string }) {
  const [on] = useSound()
  const volume = useSoundVolume()
  const preview = (value: string) => setSoundVolume(Number(value), true)
  return (
    <div className={on ? 'sound-volume' : 'sound-volume off'}>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={volume}
        disabled={!on}
        aria-valuetext={`${volume} procent`}
        style={{ '--fill': `${volume}%` } as CSSProperties}
        onChange={(e) => setSoundVolume(Number(e.target.value))}
        onPointerUp={(e) => preview(e.currentTarget.value)}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') preview(e.currentTarget.value)
        }}
      />
      <output htmlFor={id}>{volume} %</output>
    </div>
  )
}
