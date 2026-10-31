import { MoonIcon, SunIcon } from './ThemeIcons'
import { useTheme } from './theme'
import './ThemeToggle.css'

/**
 * Knappen som byter mellan ljust och mörkt läge. Den visar läget som gäller:
 * sol och "Ljust läge", eller måne och "Mörkt läge"; ikonen tonar över vid
 * byte. Namnet för skärmläsare och verktygstipset säger också vad ett tryck
 * gör ("Ljust läge, byt till mörkt"). Bytet sveper över sidan från knappen
 * (switchTheme). `label` visar texten bredvid ikonen.
 */
export function ThemeToggle({ label = false, className = '' }: { label?: boolean; className?: string }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  const name = dark ? 'Mörkt läge' : 'Ljust läge'
  const action = `${name}, byt till ${dark ? 'ljust' : 'mörkt'}`
  return (
    <button
      type="button"
      className={`theme-toggle${className ? ` ${className}` : ''}`}
      data-mode={dark ? 'dark' : 'light'}
      aria-label={action}
      title={action}
      onClick={(e) => {
        // svepet börjar mitt på knappen, också vid ett tangenttryck
        const r = e.currentTarget.getBoundingClientRect()
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        <SunIcon className="theme-toggle-sun" />
        <MoonIcon className="theme-toggle-moon" />
      </span>
      {label && <span className="theme-toggle-label">{name}</span>}
    </button>
  )
}
