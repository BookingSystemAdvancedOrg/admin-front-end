import { fireEvent, within } from '@testing-library/react'

/**
 * Testhjälp för rullistan (shared/Select.tsx): öppnar listan och väljer
 * ett alternativ på värde eller text, som userEvent.selectOptions gjorde
 * med den gamla <select>.
 */

/** Öppnar rullistan (om den är stängd) och ger listan med alternativen. */
export function openOptions(combobox: HTMLElement): HTMLElement {
  if (combobox.getAttribute('aria-expanded') !== 'true') fireEvent.click(combobox)
  const id = combobox.getAttribute('aria-controls')
  const list = id ? document.getElementById(id) : null
  if (!list) throw new Error('Rullistan öppnades inte')
  return list
}

/** Väljer ett alternativ på värde (data-value) eller synlig text. */
export function chooseOption(combobox: HTMLElement, wanted: string): void {
  const list = openOptions(combobox)
  const options = within(list).getAllByRole('option')
  const option =
    options.find((o) => o.getAttribute('data-value') === wanted) ??
    options.find((o) => o.textContent?.trim() === wanted)
  if (!option) throw new Error(`Inget alternativ "${wanted}" i rullistan`)
  fireEvent.click(option)
}

/** Texterna i rullistan, i ordning (listan stängs igen). */
export function optionTexts(combobox: HTMLElement): string[] {
  const list = openOptions(combobox)
  const texts = within(list).getAllByRole('option').map((o) => o.textContent?.trim() ?? '')
  fireEvent.keyDown(combobox, { key: 'Escape' })
  return texts
}

/** Valt värde i rullistan. */
export function selectedValue(combobox: HTMLElement): string {
  return combobox.getAttribute('data-value') ?? ''
}
