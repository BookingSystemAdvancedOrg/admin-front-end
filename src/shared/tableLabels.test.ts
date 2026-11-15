import { describe, expect, it } from 'vitest'
import { labelTable } from './tableLabels'

function table(html: string): HTMLTableElement {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.querySelector('table')!
}

describe('labelTable', () => {
  it('labels every value cell with its column heading, never the name cell', () => {
    const t = table(`<table class="data-table">
      <thead><tr><th>Kanal</th><th>Besök</th><th>Bokningar</th><th>Omsättning</th></tr></thead>
      <tbody><tr><td>Direkt</td><td>110</td><td>3</td><td>2 462 kr</td></tr></tbody></table>`)
    labelTable(t)
    const cells = Array.from(t.tBodies[0].rows[0].cells)
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([null, 'Besök', 'Bokningar', 'Omsättning'])
  })

  it('keeps a hand-written label and skips empty headings and keep-table', () => {
    const t = table(`<table class="data-table">
      <thead><tr><th>Namn</th><th>Pers</th><th></th></tr></thead>
      <tbody><tr><td>A</td><td data-label="Gäster">4</td><td>…</td></tr></tbody></table>`)
    labelTable(t)
    const cells = t.tBodies[0].rows[0].cells
    expect(cells[1].getAttribute('data-label')).toBe('Gäster')
    expect(cells[2].hasAttribute('data-label')).toBe(false)

    const kept = table(`<table class="data-table keep-table"><thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td>1</td><td>2</td></tr></tbody></table>`)
    labelTable(kept)
    expect(kept.tBodies[0].rows[0].cells[1].hasAttribute('data-label')).toBe(false)
  })
})
