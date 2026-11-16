import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette, PaletteTrigger } from './CommandPalette'
import type { PaletteItem } from './CommandPalette'
import { CtaButton } from './CtaButton'

function setup() {
  const go = vi.fn()
  const items = (): PaletteItem[] => [
    { id: 'a', group: 'Åtgärder', label: 'Ny bokning', icon: 'plus', run: () => go('ny') },
    { id: 'n1', group: 'Gå till', label: 'Översikt', icon: 'home', run: () => go('/') },
    { id: 'n2', group: 'Gå till', label: 'Statistik', icon: 'chart', run: () => go('/statistik') },
    { id: 'r', group: 'Senaste', label: 'Meny', icon: 'book', run: () => go('/meny') },
  ]
  render(
    <>
      <PaletteTrigger />
      <CommandPalette items={items} />
    </>,
  )
  return go
}

describe('CommandPalette', () => {
  it('opens on Ctrl+K with the input focused and grouped results', () => {
    setup()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = screen.getByRole('combobox')
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('group', { name: 'Åtgärder' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Gå till' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Senaste' })).toBeInTheDocument()
  })

  it('filters without accents and runs the chosen item with arrows and Enter', () => {
    const go = setup()
    fireEvent.click(screen.getByRole('button', { name: /Sök/ }))
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'oversikt' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Översikt'])
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(go).toHaveBeenCalledWith('/statistik')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Esc', () => {
    setup()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    act(() => {
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('CtaButton', () => {
  it('is named by its label only; the win phrase is decoration', () => {
    render(<CtaButton label="Spara ändringar" win="Klart!" />)
    expect(screen.getByRole('button', { name: 'Spara ändringar' })).toHaveClass('btn', 'primary', 'cta')
  })
})
