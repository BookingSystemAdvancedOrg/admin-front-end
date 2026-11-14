import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'
import { placeList } from './selectPlace'

function Fruit({ onChange = () => {}, initial = 'b' }: { onChange?: (v: string) => void; initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <label htmlFor="fruit">Frukt</label>
      <Select
        id="fruit"
        value={v}
        onChange={(e) => {
          setV(e.target.value)
          onChange(e.target.value)
        }}
      >
        <option value="a">Äpple</option>
        <option value="b">Banan</option>
        <option value="c" disabled>
          Citron
        </option>
        <option value="d">Dadel</option>
        <option value="e">Druva</option>
      </Select>
    </>
  )
}

const listbox = () => screen.getByRole('listbox')
const activeText = (box: HTMLElement) =>
  document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Select', () => {
  it('is a combobox named by its label, showing the chosen value', () => {
    render(<Fruit />)
    const box = screen.getByRole('combobox', { name: 'Frukt' })
    expect(box).toHaveTextContent('Banan')
    expect(box).toHaveValue('b')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).toHaveAttribute('aria-haspopup', 'listbox')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens in a portal in <body> with the chosen option selected', async () => {
    const user = userEvent.setup()
    const { container } = render(<Fruit />)
    const box = screen.getByRole('combobox')
    await user.click(box)
    expect(box).toHaveAttribute('aria-expanded', 'true')
    const list = listbox()
    expect(container.contains(list)).toBe(false)
    expect(document.body.contains(list)).toBe(true)
    expect(box).toHaveAttribute('aria-controls', list.id)
    expect(within(list).getByRole('option', { name: 'Banan' })).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getByRole('option', { name: 'Citron' })).toHaveAttribute('aria-disabled', 'true')
    expect(activeText(box)).toBe('Banan')
  })

  it('moves with the arrows, Home and End, skips disabled options and picks with Enter', () => {
    const changed = vi.fn()
    render(<Fruit onChange={changed} />)
    const box = screen.getByRole('combobox')
    box.focus()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(activeText(box)).toBe('Banan')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(activeText(box)).toBe('Dadel')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(activeText(box)).toBe('Banan')
    fireEvent.keyDown(box, { key: 'End' })
    expect(activeText(box)).toBe('Druva')
    fireEvent.keyDown(box, { key: 'Home' })
    expect(activeText(box)).toBe('Äpple')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(changed).toHaveBeenCalledWith('a')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).toHaveTextContent('Äpple')
    expect(document.activeElement).toBe(box)
  })

  it('opens with Space and Alt+Down and picks with Space', () => {
    const changed = vi.fn()
    render(<Fruit onChange={changed} />)
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown', altKey: true })
    expect(box).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(box, { key: 'Escape' })
    fireEvent.keyDown(box, { key: ' ' })
    expect(box).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: ' ' })
    expect(changed).toHaveBeenCalledWith('d')
  })

  it('jumps by typing the start of an option, open or closed', () => {
    render(<Fruit />)
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'd' })
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(activeText(box)).toBe('Dadel')
    // Samma bokstav igen: nästa som börjar på d.
    fireEvent.keyDown(box, { key: 'd' })
    expect(activeText(box)).toBe('Druva')
    // Citron är avstängd och hoppas över.
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5000)
    fireEvent.keyDown(box, { key: 'c' })
    expect(activeText(box)).toBe('Druva')
    clock.mockReturnValue(now + 10000)
    fireEvent.keyDown(box, { key: 'ä' })
    expect(activeText(box)).toBe('Äpple')
  })

  it('closes on Escape without closing a dialog around it, and on Tab', () => {
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    render(<Fruit />)
    const box = screen.getByRole('combobox')
    box.focus()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(box)
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    window.removeEventListener('keydown', outer)
  })

  it('picks with the mouse, ignores disabled options and closes on an outside click', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    render(
      <>
        <Fruit onChange={changed} />
        <button type="button">Utanför</button>
      </>,
    )
    const box = screen.getByRole('combobox')
    await user.click(box)
    await user.click(screen.getByRole('option', { name: 'Citron' }))
    expect(changed).not.toHaveBeenCalled()
    expect(box).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('option', { name: 'Dadel' }))
    expect(changed).toHaveBeenCalledWith('d')
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Utanför' }))
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when the page scrolls under it', async () => {
    const user = userEvent.setup()
    render(<Fruit />)
    const box = screen.getByRole('combobox')
    await user.click(box)
    fireEvent.scroll(listbox())
    expect(box).toHaveAttribute('aria-expanded', 'true')
    fireEvent.scroll(document)
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not fire onChange when the same option is picked again', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    render(<Fruit onChange={changed} />)
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Banan' }))
    expect(changed).not.toHaveBeenCalled()
  })

  it('shows optgroups as headings and numbers as values', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    render(
      <Select aria-label="Tid" value={30} onChange={(e) => changed(Number(e.target.value))}>
        <option value="">Välj…</option>
        <optgroup label="Kort">
          <option value={15}>15 min</option>
          <option value={30}>30 min</option>
        </optgroup>
        <optgroup label="Lång">
          <option value={60}>60 min</option>
        </optgroup>
      </Select>,
    )
    const box = screen.getByRole('combobox', { name: 'Tid' })
    expect(box).toHaveTextContent('30 min')
    await user.click(box)
    expect(within(listbox()).getByText('Kort')).toHaveAttribute('role', 'presentation')
    expect(within(listbox()).getAllByRole('option')).toHaveLength(4)
    await user.click(screen.getByRole('option', { name: '60 min' }))
    expect(changed).toHaveBeenCalledWith(60)
  })

  it('works in a form: the value is posted under its name and the label opens it', async () => {
    const user = userEvent.setup()
    let posted: FormData | null = null
    function Form() {
      return (
        <form
          aria-label="Formulär"
          onSubmit={(e) => {
            e.preventDefault()
            posted = new FormData(e.currentTarget)
          }}
        >
          <label htmlFor="size">Storlek</label>
          <Select id="size" name="size" defaultValue="m" required aria-invalid="true" aria-describedby="size-err">
            <option value="s">Liten</option>
            <option value="m">Mellan</option>
          </Select>
          <p id="size-err">Välj en storlek.</p>
          <button type="submit">Skicka</button>
        </form>
      )
    }
    render(<Form />)
    const box = screen.getByRole('combobox', { name: 'Storlek' })
    expect(box).toHaveAttribute('aria-required', 'true')
    expect(box).toBeInvalid()
    expect(box).toHaveAccessibleDescription('Välj en storlek.')
    // Knappen skickar aldrig formuläret själv.
    await user.click(screen.getByText('Storlek'))
    expect(box).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('option', { name: 'Liten' }))
    await user.click(screen.getByRole('button', { name: 'Skicka' }))
    expect(posted!.get('size')).toBe('s')
  })

  it('cannot be opened when disabled', async () => {
    const user = userEvent.setup()
    render(
      <Select aria-label="Plats" value="x" disabled>
        <option value="x">Södermalm</option>
      </Select>,
    )
    const box = screen.getByRole('combobox', { name: 'Plats' })
    expect(box).toBeDisabled()
    await user.click(box)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('is a bottom sheet with the label as title on phones', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: query.includes('max-width') || query.includes('reduced-motion'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    )
    render(<Fruit />)
    const box = screen.getByRole('combobox')
    await user.click(box)
    const list = listbox()
    expect(list.closest('.b-select-sheet')).not.toBeNull()
    expect(list).toHaveAccessibleName('Frukt')
    expect(document.querySelector('.b-select-title')).toHaveTextContent('Frukt')
    // Ett tryck på bakgrunden stänger arket.
    const scrim = document.querySelector('.b-select-scrim') as HTMLElement
    act(() => scrim.click())
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('placeList', () => {
  const rect = (top: number, left: number, width = 200, height = 40) =>
    ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON() {} }) as DOMRect

  it('opens under the field when there is room', () => {
    const p = placeList(rect(100, 50), 200, 1280, 800)
    expect(p.above).toBe(false)
    expect(p.top).toBe(146)
    expect(p.left).toBe(50)
    expect(p.minWidth).toBe(200)
  })

  it('flips above the field near the bottom of the window', () => {
    const p = placeList(rect(700, 50), 300, 1280, 800)
    expect(p.above).toBe(true)
    expect(p.bottom).toBe(800 - 700 + 6)
    expect(p.top).toBeUndefined()
    expect(p.maxHeight).toBeLessThanOrEqual(340)
  })

  it('stays inside the window on the right and caps the height', () => {
    const p = placeList(rect(10, 300, 80), 1000, 360, 640, 240)
    expect(p.left + 240).toBeLessThanOrEqual(360 - 8)
    expect(p.maxHeight).toBe(340)
  })
})
