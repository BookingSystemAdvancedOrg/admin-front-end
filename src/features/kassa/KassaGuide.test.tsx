import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentView } from './KassaDialogs'
import { AboutDialog, Markdown, clockSv, dateSv } from './KassaGuide'
import type { Register } from './kassaApi'

const FISKALY: Register = {
  registerId: 'r1', label: 'Kassa 1', designation: 'SE01BQ0000000001', serialNumber: 'BQ0123456789ABC',
  receiptSeq: 3, zSeq: 1, model: 'Booqy Kassa SE', program: 'Booqy Kassa', version: '1.0.0+7', today: '2026-10-25',
  manufacturer: 'Booqy', csEnrolledAt: '2026-10-25T09:00:00Z',
  controlSystem: {
    ok: true, code: 'STATUS_OK', provider: 'fiskaly', name: 'fiskaly SIGN SE', serial: 'ISTCSKS0000000011',
    simulated: false, connected: true,
    unit: { manufacturer: 'TCS', model: 'System ver. 1.1 + Miljö rev. A', address: 'Tunnelgatan 2, Stockholm', serverId: 'ISTCSKS0000000011' },
  },
}

describe('KassaGuide', () => {
  it('renders the manual: headings, nested steps, tables and bold', () => {
    render(<Markdown source={[
      '# Bruksanvisning', '', '## 2. Kom igång', '', '1. Öppna **Kassa**.', '2. Gå igenom listan:',
      '   1. Anmäl kassan.', '   2. Sätt upp skylten.', '', '| Funktion | Ägare |', '|---|---|', '| Exportera | Ja |',
    ].join('\n')} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Bruksanvisning' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '2. Kom igång' })).toBeInTheDocument()
    expect(screen.getByText('Kassa').tagName).toBe('STRONG')
    expect(screen.getByText('Sätt upp skylten.').closest('ol')?.parentElement?.tagName).toBe('LI')
    expect(screen.getByRole('cell', { name: 'Exportera' })).toBeInTheDocument()
  })

  it('shows times in Swedish time', () => {
    expect(clockSv('2026-10-25T17:30:00Z')).toBe('18:30')
    expect(clockSv(undefined)).toBe('')
  })

  it('renders a bullet list under a numbered sub-step', () => {
    render(<Markdown source={[
      '3. Tryck **Kom igång**:', '   1. Anmäl i den här ordningen:', '      - Kontrollenheten: tillverkare TCS.',
      '      - Kassaregistret: kassabeteckningen.', '   2. Sätt upp skylten.',
    ].join('\n')} />)
    const unit = screen.getByText('Kontrollenheten: tillverkare TCS.')
    expect(unit.closest('ul')?.parentElement?.closest('ol')).not.toBeNull()
    expect(screen.getByText('Sätt upp skylten.').closest('li')?.querySelector('ul')).toBeNull()
  })

  it('gives the 14-day deadline as a Swedish date', () => {
    expect(dateSv('2026-10-25T09:00:00Z')).toBe('2026-10-25')
    expect(dateSv('2026-10-25T09:00:00Z', 14)).toBe('2026-11-08')
    expect(dateSv(undefined)).toBe('')
  })

  it('Om kassan shows the kassabeteckning from the control system and the control server id', () => {
    render(<AboutDialog register={FISKALY} onClose={() => {}} />)
    expect(screen.getByText('Kassabeteckning').nextElementSibling).toHaveTextContent('SE01BQ0000000001')
    expect(screen.getByText('Kassans namn').nextElementSibling).toHaveTextContent('Kassa 1')
    expect(screen.getByText('Kontrollsystem').nextElementSibling).toHaveTextContent('fiskaly SIGN SE')
    expect(screen.getByText('Kontrollserverns id').nextElementSibling).toHaveTextContent('ISTCSKS0000000011')
    expect(screen.getByText('Kopplad till kontrollsystemet').nextElementSibling).toHaveTextContent('2026-10-25')
  })

  it('prints the control code rows whole, in the code style', () => {
    const rows = ['SE0009ABCDEF0123456789ABCDEF0', '123456789ABCDEF0123456789ABCD']
    render(<DocumentView document={{ kind: 'kassakvitto', title: 'Kvitto', rows: [{ text: 'Kontrollkod:' }, ...rows.map((text) => ({ text, code: true }))] }} />)
    for (const text of rows) expect(screen.getByText(text)).toHaveClass('code')
    expect(screen.getByText('Kontrollkod:')).not.toHaveClass('code')
  })
})
