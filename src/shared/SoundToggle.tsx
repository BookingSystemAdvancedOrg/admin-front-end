import { useSound } from './press'

/**
 * Knappen som slår på och av klickljudet (shared/press.ts). En tryckknapp
 * (aria-pressed): nedtryckt = ljud på. `label` visar texten bredvid ikonen
 * (sidomenyn); utan den är knappen bara ikonen, med samma namn för
 * skärmläsare och som verktygstips.
 */
export function SoundToggle({ label = false, className = '' }: { label?: boolean; className?: string }) {
  const [on, toggle] = useSound()
  const name = on ? 'Ljud på' : 'Ljud av'
  return (
    <button
      type="button"
      className={`theme-toggle sound-toggle${className ? ` ${className}` : ''}`}
      aria-pressed={on}
      aria-label={label ? undefined : 'Klickljud'}
      title={label ? undefined : name}
      onClick={toggle}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          {on ? (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </>
          ) : (
            <path d="m17 9 5 6M22 9l-5 6" />
          )}
        </svg>
      </span>
      {label && <span className="theme-toggle-label">{name}</span>}
    </button>
  )
}
