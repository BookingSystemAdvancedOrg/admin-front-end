import type { ReactNode } from 'react'
import { Button, toast } from '@booqy/brand'
import { Disclosure } from '../../shared/Disclosure'
import { formatPhone } from '../../shared/phone'
import { OPERATORS, SETUP, type ForwardingCode, type LocationConfig, type Operator } from './api'
import { encodeTel } from './setup'

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

const ORDER: Operator[] = ['telia', 'tele2', 'telenor', 'tre', 'telia_fast', 'vaxel', 'other']

/**
 * Steg 4: koppla restaurangens nummer till Booqy. 4a: vilken operatör.
 * 4b: en kod i taget att ringa (eller, för en växel, numret att ställa in).
 * Knapparna (Nästa, Klart, jag har ringt) ligger i guidens fot.
 */
export default function ForwardingStep({ loc, sub, codeIndex, operator, error, onOperator, onGetNumber }: {
  loc: LocationConfig
  sub: 'operator' | 'code'
  codeIndex: number
  operator: Operator | ''
  error?: string
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

  if (sub === 'operator') {
    return (
      <fieldset className="telefon-cards" aria-invalid={error ? true : undefined} aria-describedby={error ? 'pa-operator-msg' : undefined}>
        <legend className="bq-sr-only">Operatör</legend>
        {ORDER.map((op, i) => (
          <label key={op} className="telefon-card">
            <input type="radio" name="pa-operator" value={op} id={i === 0 ? 'pa-operator' : undefined}
              checked={operator === op} onChange={() => onOperator(op)} />
            <span>{OPERATORS[op]}</span>
          </label>
        ))}
        {error ? <span id="pa-operator-msg" className="bq-field__msg">{error}</span> : null}
      </fieldset>
    )
  }

  if ((loc.forwarding?.operator ?? operator) === 'vaxel') {
    return (
      <div className="telefon-step-body">
        <p className="telefon-line">Ställ in vidarekoppling i växeln till:</p>
        <BigNumber number={target} />
      </div>
    )
  }

  const codes: ForwardingCode[] = loc.forwarding?.codes ?? []
  const code = codes[Math.min(codeIndex, codes.length - 1)]
  if (!code) return null
  const offCodes = codes.map((c) => c.off).join(' och ')
  return (
    <div className="telefon-step-body">
      <p className="telefon-line">
        {codes.length > 1 ? `Kod ${codeIndex + 1} av ${codes.length}: ` : ''}Ring koden från restaurangens telefon
      </p>
      <a className="telefon-code telefon-mono" href={encodeTel(code.on)} aria-label={`Ring koden ${code.on}`}>{code.on}</a>
      <div className="telefon-row">
        <CopyButton text={code.on} />
      </div>
      <p className="telefon-hint">På iPhone: skriv koden i knappsatsen och tryck på luren.</p>
      <Disclosure title="Stänga av senare?" className="telefon-later">
        <div className="telefon-row">
          <span>Ring <span className="telefon-mono">{offCodes}</span> från samma telefon.</span>
          <CopyButton text={codes.map((c) => c.off).join(' ')} />
        </div>
      </Disclosure>
    </div>
  )
}
