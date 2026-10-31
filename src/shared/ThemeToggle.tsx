import { MoonIcon, SunIcon } from './ThemeIcons'
import { useTheme } from './theme'
import './ThemeToggle.css'

/**
 * Knappen som byter mellan ljust och mörkt läge. En tryckknapp
 * (aria-pressed): nedtryckt = mörkt läge. Ikonen visar läget som gäller
 * (sol = ljust, måne = mörkt) och tonar över till den andra vid byte;
 * med "minska rörelse" byts den direkt. `label` visar texten bredvid
 * ikonen (Inställningar, Utseende och ljud); utan den är knappen bara ikonen, med samma namn
 * för skärmläsare och som verktygstips.
 */
export function ThemeToggle({ label = false, className = '' }: { label?: boolean; className?: string }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className={`theme-toggle${className ? ` ${className}` : ''}`}
      aria-pressed={dark}
      aria-label={label ? undefined : 'Mörkt läge'}
      title={label ? undefined : 'Mörkt läge'}
      onClick={toggle}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        <SunIcon className="theme-toggle-sun" />
        <MoonIcon className="theme-toggle-moon" />
      </span>
      {label && <span className="theme-toggle-label">Mörkt läge</span>}
    </button>
  )
}
