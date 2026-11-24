import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TableLinks } from './TableLinks'

const labels = new Map([
  ['t-3', '3'],
  ['t-4', '4'],
  ['t-bar', 'Bar'],
])

function links(ids: string[]) {
  return render(
    <MemoryRouter>
      <TableLinks ids={ids} labels={labels} />
    </MemoryRouter>,
  )
}

describe('TableLinks', () => {
  it('says the word Bord once before the numbers', () => {
    links(['t-3', 't-4'])
    expect(screen.getByRole('link', { name: 'Bord 3 och 4, visa i bordskartan' })).toHaveTextContent('Bord 3 + 4')
  })

  it("shows a table's own name as it is, never Bord Bar", () => {
    const { container } = links(['t-bar'])
    expect(screen.getByRole('link', { name: 'Bar, visa i bordskartan' })).toHaveTextContent('Bar')
    expect(container.textContent).not.toContain('Bord Bar')
  })

  it('puts own names after the numbers', () => {
    links(['t-bar', 't-3'])
    expect(screen.getByRole('link', { name: 'Bord 3 och Bar, visa i bordskartan' })).toHaveTextContent('Bord 3 + Bar')
  })
})
