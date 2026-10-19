import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { editPhone, formatPhone, toE164 } from './phone'
import { PhoneInput } from './PhoneInput'

describe('toE164', () => {
  it.each([
    ['0723001573', '+46723001573'],
    ['072-300 15 73', '+46723001573'],
    ['+46 72 300 15 73', '+46723001573'],
    ['+46 (0)72 300 15 73', '+46723001573'],
    ['0046723001573', '+46723001573'],
    ['723001573', '723001573'], // no 0 or +: left alone, the form flags it
    ['08-123 45 67', '+4681234567'],
    ['+4712345678', '+4712345678'],
    ['07230015739999', '+46723001573'], // capped at 9 national digits
    ['', ''],
    ['+', '+'],
    ['abc', ''],
  ])('%s -> %s', (raw, expected) => {
    expect(toE164(raw)).toBe(expected)
  })
})

describe('formatPhone', () => {
  it.each([
    ['0723001573', '+46 72 300 15 73'],
    ['0812345678', '+46 8 123 456 78'],
    ['081234567', '+46 8 123 45 67'],
    ['0311234567', '+46 31 123 45 67'],
    ['07', '+46 7'],
    ['0', '+46'],
    ['+4712345678', '+47 123 456 78'],
  ])('%s -> %s', (raw, expected) => {
    expect(formatPhone(raw)).toBe(expected)
  })
})

describe('editPhone', () => {
  it('backspace on a space removes the digit before it', () => {
    // "+46 72 300| 15 73" -> backspace removes the space -> digit 0 goes
    const out = editPhone('+46 72 300 15 73', '+46 72 30015 73', 10)
    expect(out.value).toBe('+4672301573')
    expect(out.display).toBe('+46 72 301 57 3')
  })

  it('keeps the caret before the same digits after regrouping', () => {
    // typing 9 right after "72" in "+46 72 300 15 7"
    const out = editPhone('+46 72 300 15 7', '+46 729 300 15 7', 7)
    expect(out.display).toBe('+46 72 930 01 57')
    expect(out.display.slice(out.caret)).toBe('30 01 57')
  })
})

describe('PhoneInput', () => {
  function Harness() {
    const [value, setValue] = useState('')
    return (
      <>
        <label htmlFor="p">Telefon</label>
        <PhoneInput id="p" value={value} onChange={setValue} />
        <output>{value}</output>
      </>
    )
  }

  it('formats while typing and hands the parent E.164', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('Telefon'), '0723001573')
    expect(screen.getByLabelText('Telefon')).toHaveValue('+46 72 300 15 73')
    expect(screen.getByRole('status')).toHaveTextContent('+46723001573')
  })

  it('backspace works through the spaces', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('Telefon')
    await user.type(input, '0723001573')
    await user.type(input, '{Backspace}{Backspace}{Backspace}')
    expect(input).toHaveValue('+46 72 300 1')
  })
})
