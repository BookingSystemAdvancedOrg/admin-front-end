import { Icon } from '../Icon'
import { testOrderSound, useOrderSound } from './alertSound'

/**
 * Inställningar, Utseende och ljud: larmljudet för nya beställningar på den
 * här enheten (på från början) och Testa, som spelar det så att man hör hur
 * högt det är. Att slå på det spelar larmet en gång, som klickljudet.
 */
export function OrderSoundSetting() {
  const [on, setOn] = useOrderSound()
  return (
    <div className="order-sound-setting">
      <button
        type="button"
        className="theme-toggle sound-toggle appearance-toggle"
        aria-pressed={on}
        aria-label={`${on ? 'Ljud på' : 'Ljud av'}, ny beställning`}
        onClick={() => {
          setOn(!on)
          if (!on) testOrderSound()
        }}
      >
        <span className="theme-toggle-icon" aria-hidden="true">
          <Icon name="sound" size={20} />
        </span>
        <span className="theme-toggle-label">{on ? 'Ljud på' : 'Ljud av'}</span>
      </button>
      <button
        type="button"
        className="btn outline square order-sound-test"
        aria-label="Testa ljud vid ny beställning"
        disabled={!on}
        onClick={() => testOrderSound()}
      >
        Testa
      </button>
    </div>
  )
}
