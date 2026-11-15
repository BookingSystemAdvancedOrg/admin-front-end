import type { ReactNode } from 'react'
import { Bar, Button, LinkButton, toast } from '@booqy/brand'
import { Disclosure } from '../../shared/Disclosure'
import { Icon, type IconName } from '../../shared/Icon'
import { formatPhone, formatPhoneNational } from '../../shared/phone'
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

/** Numret stort och i mono, med Kopiera bredvid. `national` visar det som man läser upp det (010-123 45 67). */
export function BigNumber({ number, extra, national = false }: { number: string; extra?: ReactNode; national?: boolean }) {
  return (
    <div className="telefon-bignumber">
      <span className="telefon-bignumber__value telefon-mono">{national ? formatPhoneNational(number) : formatPhone(number)}</span>
      <CopyButton text={number} />
      {extra}
    </div>
  )
}

export type HowToStep = { icon?: IconName; text: ReactNode }

/** En numrerad lista med en sak att göra per rad, och en liten bild framför där den hjälper. */
export function HowTo({ steps, label }: { steps: HowToStep[]; label: string }) {
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
 * Hur koden ska slås. `type`: skriv av den (en annan telefon, en dator eller
 * en fast telefon), bara koden. `copy`: sidan är öppen på restaurangens
 * iPhone, Kopiera. `call`: sidan är öppen på restaurangens Android, Kopiera
 * och Ring koden.
 */
export type CodeUse = 'type' | 'copy' | 'call'

/**
 * Koden jättestor och i bitar. Den sista biten och # sitter ihop, så att
 * # aldrig hamnar ensam på en rad.
 */
export function CodeBox({ code, use = 'type' }: { code: string; use?: CodeUse }) {
  const chunks = codeChunks(code)
  const shown = chunks.length > 2 && chunks[chunks.length - 1] === '#'
    ? [...chunks.slice(0, -2), chunks[chunks.length - 2] + '#'] : chunks
  return (
    <div className="telefon-codebox">
      <p className="telefon-code telefon-mono" aria-label={`Koden ${code}`}>
        {shown.map((c, i) => <span key={i} className="telefon-code__chunk">{c}</span>)}
      </p>
      {shown.length > 1 ? <span className="telefon-code__note">Skriv utan mellanrum.</span> : null}
      {use !== 'type' ? (
        <div className="telefon-row">
          <CopyButton text={code} />
          {use === 'call' ? (
            <LinkButton variant="primary" className="telefon-call" href={encodeTel(code)} aria-label={`Ring koden ${code} från den här telefonen`}>
              <Icon name="phone" size={18} /> {SETUP.buttons.callCode}
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Hjälpraderna om tecknen: stjärna, fyrkant och plus. */
function KeyHints({ code }: { code: string }) {
  return (
    <ul className="telefon-keys">
      <li><span className="telefon-key telefon-mono">*</span> och <span className="telefon-key telefon-mono">#</span> finns längst ned på knappsatsen.</li>
      {code.includes('+') ? <li>För <span className="telefon-key telefon-mono">+</span>: håll fingret på <span className="telefon-key telefon-mono">0</span> tills + syns.</li> : null}
    </ul>
  )
}

/**
 * Raderna för en kod, en sak per rad. `here`: sidan är öppen på
 * restaurangens telefon (svaret på frågan överst), annars skriver man av
 * koden på restaurangens telefon. `desk`: en fast telefon (lur, ingen app).
 */
export function dialHowTo(code: string, opts: { platform: Platform; here: boolean; desk?: boolean; last: string }): HowToStep[] {
  const { platform, here, desk = false, last } = opts
  if (desk) {
    return [
      { icon: 'phone', text: 'Lyft luren på restaurangens fasta telefon.' },
      { text: <>Slå koden:<CodeBox code={code} /><KeyHints code={code} /></> },
      { text: 'Lyssna efter en ton eller ett meddelande.' },
      { text: last },
    ]
  }
  const green: HowToStep = { icon: 'phone', text: 'Tryck på den gröna lur-knappen.' }
  if (here && platform === 'android') {
    return [
      { text: <>Tryck på Ring koden från den här telefonen:<CodeBox code={code} use="call" /></> },
      green,
      { text: last },
    ]
  }
  if (here && platform === 'ios') {
    return [
      { text: <>Tryck på Kopiera:<CodeBox code={code} use="copy" /></> },
      { icon: 'keypad', text: 'Öppna appen Telefon och gå till knappsatsen.' },
      { text: 'Håll fingret på den tomma raden ovanför siffrorna.' },
      { text: 'Tryck på Klistra in.' },
      green,
      { text: last },
    ]
  }
  return [
    { icon: 'mobile', text: 'Ta fram restaurangens telefon (den som kunderna ringer till).' },
    { icon: 'keypad', text: 'Öppna appen Telefon och tryck på knappsatsen.' },
    { text: <>Skriv in koden:<CodeBox code={code} /><KeyHints code={code} /></> },
    green,
    { text: last },
  ]
}

/** Är sidan öppen på restaurangens telefon? Bara då får Ring koden och Kopiera synas. */
export function HereQuestion({ here, onHere }: { here: boolean | null; onHere: (v: boolean | null) => void }) {
  if (here !== null) {
    return (
      <p className="telefon-hint">
        {here ? 'Du har sidan öppen på restaurangens telefon.' : 'Du skriver av koden på restaurangens telefon.'}{' '}
        <button type="button" className="telefon-link" onClick={() => onHere(null)}>Ändra</button>
      </p>
    )
  }
  return (
    <div className="telefon-here" role="group" aria-labelledby="pa-here-q">
      <p id="pa-here-q" className="telefon-line"><strong>Har du öppnat den här sidan på restaurangens telefon?</strong></p>
      <div className="telefon-row">
        <Button type="button" variant="secondary" onClick={() => onHere(true)}>Ja</Button>
        <Button type="button" variant="secondary" onClick={() => onHere(false)}>Nej, jag skriver av koden</Button>
      </div>
    </div>
  )
}

/** Vad vidarekopplingen gör, med vanliga ord (raden under frågan och i-rutan). */
export function forwardingMeaning(mode: LocationConfig['mode']): string {
  return mode === 'always'
    ? 'Alla samtal går till assistenten. Ert nummer är detsamma.'
    : 'Samtal som ni inte svarar på går vidare till assistenten. Ert nummer är detsamma.'
}

/**
 * Steg 4: koppla restaurangens nummer till Booqy. 4a: vilken operatör.
 * 4b: en kod i taget, först den som stänger av en gammal vidarekoppling
 * (eller, för en växel, numret att ställa in). I testläget (dev) kopplas
 * ingenting om. Knapparna (Nästa, Klart) ligger i guidens fot.
 */
export default function ForwardingStep({ loc, sub, codeIndex, operator, error, testLine, platform = currentPlatform(), here, onHere, onOperator, onGetNumber }: {
  loc: LocationConfig
  sub: 'operator' | 'code'
  codeIndex: number
  operator: Operator | ''
  error?: string
  /** Testlinjen eller simulatorn i dev: ingen vidarekoppling. */
  testLine: boolean
  platform?: Platform
  /** Är sidan öppen på restaurangens telefon? null: inte svarat än. */
  here: boolean | null
  onHere: (v: boolean | null) => void
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
        <span className="telefon-card__text">
          <span>{OPERATOR_CARDS.label[op]}</span>
          {op === 'other' ? <span className="telefon-card__hint">Till exempel Comviq, Hallon, Vimla eller Fello</span> : null}
        </span>
      </label>
    )
    return (
      <fieldset className="telefon-step-body telefon-operators" aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'pa-operator-msg' : undefined}>
        <legend className="bq-sr-only">Operatör</legend>
        <div className="telefon-cards telefon-cards--grid">
          {OPERATOR_CARDS.main.map((op, i) => card(op, i === 0, true))}
        </div>
        <p className="telefon-hint">
          Vet du inte? Det står på fakturan. Operatören står också högst upp på skärmen eller under Inställningar {'>'} Mobilnät.
        </p>
        <p className="telefon-hint">Fast telefon eller växel?</p>
        <div className="telefon-cards telefon-cards--grid">
          {OPERATOR_CARDS.more.map((op) => card(op, false, false))}
        </div>
        {error ? <span id="pa-operator-msg" className="bq-field__msg">{error}</span> : null}
      </fieldset>
    )
  }

  const op = loc.forwarding?.operator ?? operator
  if (op === 'vaxel') {
    return (
      <div className="telefon-step-body">
        <HowTo label="Så gör du" steps={[
          { icon: 'users', text: 'Kontakta den som sköter er växel (eller logga in i växeln).' },
          { icon: 'phone', text: <>Be dem koppla restaurangens nummer till:<BigNumber number={target} national /></> },
          { text: 'När det är gjort: tryck på Klart nedan.' },
        ]} />
      </div>
    )
  }

  const steps = dialSteps(loc)
  const code = steps[Math.min(codeIndex, steps.length - 1)]
  if (!code) return null
  const desk = op === 'telia_fast'
  // Frågan om telefonen behövs bara på en mobil: en dator eller en fast telefon skriver alltid av.
  const ask = !desk && platform !== 'other'
  const isLast = codeIndex >= steps.length - 1
  const isReset = codeIndex < (loc.forwarding?.reset ?? []).length
  const offCodes = (loc.forwarding?.codes ?? []).map((c) => c.off)
  const variant = desk ? null : zeroZeroVariant(code.on)
  const nextLabel = isLast ? 'Klart' : 'Nästa'
  const waitText = desk
    ? `Lägg på. Tryck sedan på ${nextLabel} nedan.`
    : isReset
      ? 'Telefonen visar ett meddelande. Det spelar ingen roll vad det står. Tryck på Nästa nedan.'
      : `Vänta tills telefonen visar att det lyckades (t.ex. ”Vidarekoppling aktiverad”). Tryck sedan på ${nextLabel} nedan.`

  return (
    <div className="telefon-step-body">
      <p className="telefon-line">
        <strong>{steps.length > 1 ? `Kod ${codeIndex + 1} av ${steps.length}: ` : ''}{isReset ? 'Först: stäng av gammal vidarekoppling' : code.label}</strong>
      </p>
      {isReset ? <p className="telefon-line">Det här stänger av gammal vidarekoppling, om ni har någon.</p> : null}
      {ask ? <HereQuestion here={here} onHere={onHere} /> : null}
      {ask && here === null ? null : (
        <HowTo label="Så gör du" steps={dialHowTo(code.on, { platform, here: ask && here === true, desk, last: waitText })} />
      )}

      <Disclosure title="Fungerade det inte?" className="telefon-help">
        {isReset ? (
          <p className="telefon-line">
            Visar telefonen ett fel, till exempel ”Radering misslyckades”? Det gör inget: då fanns ingen gammal
            vidarekoppling. Tryck på Nästa.
          </p>
        ) : desk ? (
          <HowTo label="Prova så här" steps={[
            { text: 'Hör du ett felmeddelande? Lägg på och slå koden en gång till.' },
            { text: <>Fungerar det ändå inte? Ring Telias kundtjänst och be dem slå på vidarekoppling till:<BigNumber number={target} national /></> },
          ]} />
        ) : (
          <>
            <p className="telefon-line">
              Visar telefonen ett fel (till exempel ”Setting Registration Failed”)? Då vill operatören ha koden på ett annat sätt.
            </p>
            <HowTo label="Prova så här" steps={[
              ...(variant ? [{ text: <>Prova samma kod med 00 i stället för +:<CodeBox code={variant} use={ask && here ? (platform === 'android' ? 'call' : 'copy') : 'type'} /></> }] : []),
              { text: <>Fungerar det ändå inte? Ring operatörens kundtjänst och be dem slå på vidarekoppling till:<BigNumber number={target} national /></> },
            ]} />
          </>
        )}
      </Disclosure>

      <Disclosure title="Stänga av senare?" className="telefon-later">
        <HowTo label="Stäng av" steps={[
          desk ? { icon: 'phone', text: 'Lyft luren på restaurangens fasta telefon.' } : { icon: 'mobile', text: 'Ta fram restaurangens telefon.' },
          ...(desk ? [] : [{ icon: 'keypad' as const, text: 'Öppna appen Telefon och tryck på knappsatsen.' }]),
          {
            text: (
              <>
                {offCodes.length > 1 ? (desk ? 'Slå koderna, en i taget:' : 'Skriv in koderna, en i taget:') : (desk ? 'Slå koden:' : 'Skriv in koden:')}
                {offCodes.map((off) => (
                  <span key={off} className="telefon-mono telefon-offcode">{off}</span>
                ))}
              </>
            ),
          },
          desk
            ? { text: offCodes.length > 1 ? 'Lägg på efter varje kod.' : 'Lägg på.' }
            : { icon: 'phone', text: offCodes.length > 1 ? 'Tryck på den gröna lur-knappen efter varje kod.' : 'Tryck på den gröna lur-knappen.' },
        ]} />
      </Disclosure>
    </div>
  )
}
