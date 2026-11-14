import { expect, type Locator } from '@playwright/test'

/**
 * The admin dropdown (src/shared/Select) is a button with role="combobox"
 * whose list is rendered in <body> only while open, so Playwright's
 * selectOption and locator('option') do not work on it. These helpers open
 * it and pick through the listbox and option roles.
 */

type Want = string | { label: string } | { index: number }

const listOf = (combobox: Locator) => combobox.page().getByRole('listbox')

async function openList(combobox: Locator): Promise<Locator> {
  const list = listOf(combobox)
  if ((await combobox.getAttribute('aria-expanded')) !== 'true') await combobox.click()
  await expect(list).toBeVisible()
  return list
}

/** Choose an option by value, by { label } or by { index } (0-based, as selectOption). */
export async function pick(combobox: Locator, want: Want): Promise<void> {
  const list = await openList(combobox)
  const opts = list.getByRole('option')
  const option =
    typeof want === 'string'
      ? list.locator(`[role=option][data-value="${want.replace(/"/g, '\\"')}"]`)
      : 'label' in want
        ? opts.filter({ hasText: want.label }).first()
        : opts.nth(want.index)
  await option.click()
  await expect(combobox).toHaveAttribute('aria-expanded', 'false')
}

/** The option texts in order (the list is closed again). Empty when there is nothing to open. */
export async function options(combobox: Locator): Promise<string[]> {
  if (await combobox.isDisabled()) return []
  await combobox.click()
  const list = listOf(combobox)
  if (!(await list.isVisible().catch(() => false))) {
    await list.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {})
    if (!(await list.isVisible())) return []
  }
  const texts = (await list.getByRole('option').allTextContents()).map((t) => t.trim())
  await combobox.press('Escape')
  await expect(list).toBeHidden()
  return texts
}

/** Wait until the dropdown has more than `n` options (for lists filled by the API). */
export async function waitForOptions(combobox: Locator, n = 1, timeout = 20000): Promise<void> {
  await expect.poll(async () => (await options(combobox)).length, { timeout }).toBeGreaterThan(n)
}

/** The chosen value (inputValue does not work on a button). */
export async function valueOf(combobox: Locator): Promise<string> {
  return (await combobox.getAttribute('data-value')) ?? ''
}
