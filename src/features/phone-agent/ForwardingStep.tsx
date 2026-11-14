import type { ReactNode } from 'react'
import { Bar, Button, LinkButton, toast } from '@booqy/brand'
import { Disclosure } from '../../shared/Disclosure'
import { Icon, type IconName } from '../../shared/Icon'
import { formatPhone } from '../../shared/phone'
import { OPERATOR_CARDS, SETUP, type LocationConfig, type Operator } from './api'
import { codeChunks, currentPlatform, dialSteps, encodeTel, zeroZeroVariant, type Platform } from './setup'

/** "Kopiera": lägger texten i urklipp och säger "Kopierad". */
export function CopyButton({ text, label = SETUP.buttons.copy }: { text: string; label?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast(SETUP.buttons.copied, { tone: 'success' })
    } catch {
      toast('Det gick inte att kopiera. Markera texten och kopiera den själv.', { tone: 'warning' })
    }
  }
  return <Button type="button" variant="secondary" onClick={() => void copy()}>{label}</Button>
}

/** Numret stort och i mono, med Kopiera bredvid. */
export function BigNumber({ number, extra }: { number: string; extra?: ReactNode }) {
  return (
    <div className="telefon-bignumber">
      <span className="telefon-bignumber__value telefon-mono">{formatPhone(number)}</span>
      <CopyButton text={number} />
      {extra}
    </div>
  )
}

/** En numrerad lista med en sak att göra per rad, och en liten bild framför där den hjälper. */
export function HowTo({ steps, label }: { steps: { icon?: IconName; text: ReactNode }[]; label: string }) {
  return (
    <ol className="telefon-howto" aria-label={label}>
      {steps.map((s, i) => (
        <li key={i}>
          <span className="telefon-howto__n" aria-hidden="true">{i + 1}</span>
          <span className="telefon-howto__text">
            {s.icon ? <Icon name={s.icon} size={22} className="telefon-howto__icon" /> : null}
            <span>{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Koden jättestor och i bitar, med Kopiera och (på Android) Ring koden.
 * iPhone ringer inga koder från länkar: där skriver man in den själv.
 */
export function CodeBox({ code, platform }: { code: string; platform: Platform }) {
  return (
    <div className="telefon-codebox">
      <p className="telefon-code telefon-mono" aria-label={`Koden ${code}`}>
        {codeChunks(code).map((c, i) => <span key={i} className="telefon-code__chunk">{c}</span>)}
      </p>
      <div className="telefon-row">
        <CopyButton text={code} />
        {platform === 'android' ? (
          <LinkButton variant="primary" className="telefon-call" href={encodeTel(code)} aria-label={`Ring koden ${code}`}>
            <Icon name="phone" size={18} /> {SETUP.buttons.callCode}
          </LinkButton>
        ) : null}
      </div>
    </div>
  )
}

/** Hjälpraderna om tecknen: stjärna, fyrkant och plus. */
function KeyHints({ code, platform }: { code: string; platform: Platform }) {
  return (
    <ul className="telefon-keys">
      <li><span className="telefon-key telefon-mono">*</span> och <span className="telefon-key telefon-mono">#</span> finns längst ned på knappsatsen.</li>
      {code.includes('+') ? <li>För <span className="telefon-key telefon-mono">+</span>: håll fingret på <span className="telefon-key telefon-mono">0</span> tills + syns.</li> : null}
      {platform === 'ios' ? <li>På iPhone: tryck på Kopiera, öppna knappsatsen, håll fingret ovanför siffrorna och välj Klistra in.</li> : null}
      {platform === 'android' ? <li>På Android: tryck på Ring koden, så skrivs koden in åt dig.</li> : null}
    </ul>
  )
}

/** De fem raderna för en kod: telefon, knappsats, koden, luren, vänta. */
export function dialHowTo(code: string, platform: Platform, last: string): { icon?: IconName; text: ReactNode }[] {
  return [
    { icon: 'mobile', text: 'Ta fram restaurangens telefon (den som kunderna ringer till).' },
    { icon: 'keypad', text: 'Öppna appen Telefon och tryck på knappsatsen.' },
    { text: <>Skriv in koden:<CodeBox code={code} platform={platform} /><KeyHints code={code} platform={platform} /></> },
    { icon: 'phone', text: 'Tryck på den gröna lur-knappen.' },
    { text: last },
  ]
}

/**
 * Steg 4: koppla restaurangens nummer till Booqy. 4a: vilken operatör.
 * 4b: en kod i taget, först den som stänger av en gammal vidarekoppling
 * (eller, för en växel, numret att ställa in). I testläget (dev) kopplas
 * ingenting om. Knapparna (Nästa, Klart) ligger i guidens fot.
 */
export default function ForwardingStep({ loc, sub, codeIndex, operator, error, testLine, platform = currentPlatform(), onOperator, onGetNumber }: {
  loc: LocationConfig
  sub: 'operator' | 'code'
  codeIndex: number
  operator: Operator | ''
  error?: string
  /** Testlinjen eller simulatorn i dev: ingen vidarekoppling. */
  testLine: boolean
  platform?: Platform
  onOperator: (op: Operator) => void
  onGetNumber: () => void
}) {
  const target = loc.forwarding?.number ?? null
  if (!target) {
    return (
      <div className="telefon-step-body">
        <p className="telefon-line">Skaffa ert Booqy-nummer först.</p>
        <Button type="button" variant="secondary" onClick={onGetNumber}>Till steg 3</Button>
      </div>
    )
  }

  if (testLine) {
    return (
      <div className="telefon-step-body">
        <Bar variant="banner" tone="info">
          <strong>I testläget behöver du inte koppla om.</strong> Ring testnumret direkt i nästa steg.
        </Bar>
        <p className="telefon-line">Tryck på Klart nedan.</p>
      </div>
    )
  }

  if (sub === 'operator') {
    const card = (op: Operator, first: boolean, big: boolean) => (
      <label key={op} className={`telefon-card${big ? ' telefon-card--big' : ''}`}>
        <input type="radio" name="pa-operator" value={op} id={first ? 'pa-operator' : undefined}
          aria-label={OPERATOR_CARDS.label[op]} checked={operator === op} onChange={() => onOperator(op)} />
        <span>{OPERATOR_CARDS.label[op]}</span>
      </label>
    )
    return (
      <fieldset className="telefon-step-body telefon-operators" aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'pa-operator-msg' : undefined}>
        <legend className="bq-sr-only">Operatör</legend>
        <div className="telefon-cards telefon-cards--grid">
          {OPERATOR_CARDS.main.map((op, i) => card(op, i === 0, true))}
        </div>
        <p className="telefon-hint">Vet du inte? Det står på fakturan eller i telefonens inställningar.</p>
        <p className="telefon-hint">Fast telefon eller växel?</p>
        <div className="telefon-cards telefon-cards--grid">
          {OPERATOR_CARDS.more.map((op) => card(op, false, false))}
        </div>
        {error ? <span id="pa-operator-msg" className="bq-field__msg">{error}</span> : null}
      </fieldset>
    )
  }

  if ((loc.forwarding?.operator ?? operator) === 'vaxel') {
    return (
      <div className="telefon-step-body">
        <HowTo label="Så gör du" steps={[
          { icon: 'users', text: 'Kontakta den som sköter er växel (eller logga in i växeln).' },
          { icon: 'phone', text: <>Be dem koppla restaurangens nummer till:<BigNumber number={target} /></> },
          { text: 'När det är gjort: tryck på Klart nedan.' },
        ]} />
      </div>
    )
  }

  const steps = dialSteps(loc)
  const code = steps[Math.min(codeIndex, steps.length - 1)]
  if (!code) return null
  const isLast = codeIndex >= steps.length - 1
  const isReset = codeIndex < (loc.forwarding?.reset ?? []).length
  const offCodes = (loc.forwarding?.codes ?? []).map((c) => c.off)
  const variant = zeroZeroVariant(code.on)
  const waitText = isReset
    ? 'Vänta tills telefonen visar ett svar. Tryck sedan på Nästa nedan.'
    : `Vänta tills telefonen visar att det lyckades (t.ex. ”Vidarekoppling aktiverad”). Tryck sedan på ${isLast ? 'Klart' : 'Nästa'} nedan.`

  return (
    <div className="telefon-step-body">
      <p className="telefon-line">
        <strong>{steps.length > 1 ? `Kod ${codeIndex + 1} av ${steps.length}: ` : ''}{isReset ? 'Först: stäng av gammal vidarekoppling' : code.label}</strong>
      </p>
      <HowTo label="Så gör du" steps={dialHowTo(code.on, platform, waitText)} />

      <Disclosure title="Fungerade det inte?" className="telefon-help">
        {isReset ? (
          <p className="telefon-line">
            Visar telefonen ett fel, till exempel ”Radering misslyckades”? Det gör inget: då fanns ingen gammal
            vidarekoppling. Tryck på Nästa.
          </p>
        ) : (
          <>
            <p className="telefon-line">
              Visar telefonen ett fel (till exempel ”Setting Registration Failed”)? Då vill operatören ha koden på ett annat sätt.
            </p>
            <HowTo label="Prova så här" steps={[
              ...(variant ? [{ text: <>Prova samma kod med 00 i stället för +:<CodeBox code={variant} platform={platform} /></> }] : []),
              { text: <>Fungerar det ändå inte? Ring operatörens kundtjänst och be dem slå på vidarekoppling till:<BigNumber number={target} /></> },
            ]} />
          </>
        )}
      </Disclosure>

      <Disclosure title="Stänga av senare?" className="telefon-later">
        <HowTo label="Stäng av" steps={[
          { icon: 'mobile', text: 'Ta fram restaurangens telefon.' },
          { icon: 'keypad', text: 'Öppna appen Telefon och tryck på knappsatsen.' },
          {
            text: (
              <>
                {offCodes.length > 1 ? 'Skriv in koderna, en i taget:' : 'Skriv in koden:'}
                {offCodes.map((off) => (
                  <div key={off} className="telefon-row">
                    <span className="telefon-mono telefon-offcode">{off}</span>
                    <CopyButton text={off} />
                  </div>
                ))}
              </>
            ),
          },
          { icon: 'phone', text: offCodes.length > 1 ? 'Tryck på den gröna lur-knappen efter varje kod.' : 'Tryck på den gröna lur-knappen.' },
        ]} />
      </Disclosure>
    </div>
  )
}
