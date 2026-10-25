import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BarChart, ColumnChart } from './charts'
import { fmtInt } from './stats'

const rows = [
  { key: 'mon', label: 'Mån', value: 4, title: 'Mån: 4 bokningar', detail: '9 gäster' },
  { key: 'tue', label: 'Tis', value: 7, title: 'Tis: 7 bokningar' },
]

describe('chart tooltips', () => {
  it('shows the point on hover and leaves it on mouse out', () => {
    const { container } = render(<BarChart rows={rows} format={fmtInt} seriesLabel="Bokningar" ariaLabel="Bokningar" tableHead={[]} tableRows={[]} />)
    const hits = container.querySelectorAll('.chart-hit')
    fireEvent.pointerEnter(hits[0])
    const tip = container.querySelector('.chart-tip')!
    expect(tip).toHaveTextContent('Mån')
    expect(tip).toHaveTextContent('Bokningar4')
    expect(tip).toHaveTextContent('9 gäster')
    fireEvent.pointerLeave(container.querySelector('svg')!, { pointerType: 'mouse' })
    expect(tip).toBeEmptyDOMElement()
  })

  it('walks the points with the arrow keys and names both series', () => {
    const { container } = render(
      <ColumnChart
        unit="count"
        format={fmtInt}
        seriesLabel="Gäster"
        previousLabel="Förra perioden"
        ariaLabel="Gäster per dag"
        points={[
          { key: 'a', label: '1 okt', value: 10, previous: 8, title: '' },
          { key: 'b', label: '2 okt', value: 12, previous: 9, title: '' },
        ]}
        tableHead={[]}
        tableRows={[]}
      />,
    )
    const svg = screen.getByRole('img', { name: 'Gäster per dag' })
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    const tip = container.querySelector('.chart-tip')!
    expect(tip).toHaveTextContent('1 okt')
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    expect(tip).toHaveTextContent('2 okt')
    expect(tip).toHaveTextContent('Gäster12')
    expect(tip).toHaveTextContent('Förra perioden9')
    fireEvent.keyDown(svg, { key: 'Escape' })
    expect(tip).toBeEmptyDOMElement()
  })
})
