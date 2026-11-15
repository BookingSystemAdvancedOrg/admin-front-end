import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DateInput, TimeInput } from './DateInput'

describe('DateInput och TimeInput i ett formulär', () => {
  it('ett ofullständigt eller otillåtet värde gör fältet ogiltigt, som det inbyggda fältet', () => {
    render(
      <form aria-label="f">
        <DateInput aria-label="Dag" value="" max="2026-11-15" onChange={() => {}} required />
        <TimeInput aria-label="Tid" value="" onChange={() => {}} required />
      </form>,
    )
    const day = screen.getByLabelText('Dag') as HTMLInputElement
    const time = screen.getByLabelText('Tid') as HTMLInputElement
    fireEvent.change(day, { target: { value: '20/11/2026' } })
    fireEvent.change(time, { target: { value: '25:00' } })
    expect(day.validity.valid).toBe(false)
    expect(time.validity.valid).toBe(false)
    fireEvent.change(day, { target: { value: '10/11/2026' } })
    fireEvent.change(time, { target: { value: '19:30' } })
    expect(day.validity.valid).toBe(true)
    expect(time.validity.valid).toBe(true)
  })
})
