import { useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * Sidans enda huvudknapp. Med musen över byter texten till en kort
 * vinnarfras ("Kör!", "Klart!") och pappersplanet flyger ut uppåt till höger
 * och in igen, om och om, tills musen går; då landar det färdigt i sin
 * slinga i stället för att hoppa. Minska rörelse: planet står still och
 * texten byts utan glidning (ds.css). Skärmläsare hör bara knappens text.
 */
export function CtaButton({
  label,
  win = 'Kör!',
  className = '',
  onPointerEnter,
  onPointerLeave,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: ReactNode; win?: string }) {
  const [flying, setFlying] = useState(false)
  const stopping = useRef(false)
  return (
    <button
      type="button"
      {...rest}
      className={`btn primary cta${flying ? ' is-flying' : ''} ${className}`.trim()}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          stopping.current = false
          setFlying(true)
        }
        onPointerEnter?.(e)
      }}
      onPointerLeave={(e) => {
        stopping.current = true
        onPointerLeave?.(e)
      }}
    >
      <span className="cta-plane" aria-hidden="true">
        <span
          className="cta-plane-fly"
          onAnimationIteration={() => {
            if (stopping.current) setFlying(false)
          }}
        >
          <Icon name="send" size={16} />
        </span>
      </span>
      <span className="cta-label">
        <span className="cta-text">{label}</span>
        <span className="cta-win" aria-hidden="true">
          {win}
        </span>
      </span>
    </button>
  )
}
