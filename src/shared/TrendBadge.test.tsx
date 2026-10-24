import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TrendBadge } from './TrendBadge'
import { StatTile } from './motion/StatTile'
import { trendOf } from './trend'

describe('TrendBadge', () => {
  it('reads the whole change to screen readers and hides the short form', () => {
    const { container } = render(<TrendBadge trend={trendOf(112, 100, 'orders', 'förra veckan')} />)
    expect(screen.getByText('upp 12 % mot förra veckan')).toHaveClass('sr-only')
    expect(screen.getByText('+12 %')).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstChild).toHaveClass('trend--good')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('is red and points down when it got worse', () => {
    const { container } = render(<TrendBadge trend={trendOf(8, 4, 'noShows', 'förra perioden')} />)
    expect(screen.getByText('upp 100 % mot förra perioden')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('trend--bad')
  })

  it('renders nothing without a comparison or on zero', () => {
    const { container } = render(
      <>
        <TrendBadge trend={trendOf(10, null, 'orders', 'x')} />
        <TrendBadge trend={trendOf(0, 10, 'orders', 'x')} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StatTile with a trend', () => {
  it('colours the number green and announces the change', () => {
    render(
      <MemoryRouter>
        <StatTile label="Dagens omsättning" value="9 405 kr" trend={trendOf(940_500, 812_000, 'revenue', 'samma tid förra veckan')} />
      </MemoryRouter>,
    )
    expect(screen.getByText('upp 16 % mot samma tid förra veckan')).toBeInTheDocument()
    expect(screen.getByText('9 405 kr').closest('p')).toHaveClass('trend-value--good')
  })

  it('stays in the normal ink when neutral', () => {
    render(
      <MemoryRouter>
        <StatTile label="Omsättning idag" value="0 kr" trend={trendOf(0, 812_000, 'revenue', 'samma tid förra veckan')} />
      </MemoryRouter>,
    )
    expect(screen.getByText('0 kr').closest('p')).not.toHaveClass('trend-value--good')
    expect(screen.getByText('0 kr').closest('p')).not.toHaveClass('trend-value--bad')
  })
})
