import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown, clockSv } from './KassaGuide'

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
})
