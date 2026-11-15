/**
 * Phones stack every .data-table row into a small card and hide the column
 * headings (ds.css, max-width 600px). Without a heading a bare "110 3 2 462 kr"
 * means nothing, so each cell gets its column heading as `data-label`, which
 * the phone CSS prints in front of the value. Runs for every table on every
 * page, also ones added later; a cell that already has a label keeps it.
 * The first column (the row's name) and cells under an empty heading get none.
 */

const AUTO = 'data-label-auto'

export function labelTable(table: HTMLTableElement): void {
  if (table.classList.contains('keep-table')) return
  const heads = table.tHead?.rows[0]
  if (!heads) return
  const names: string[] = []
  for (const th of Array.from(heads.cells)) {
    const text = (th.getAttribute('aria-label') || th.textContent || '').trim()
    for (let i = 0; i < th.colSpan; i++) names.push(text)
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0
      for (const cell of Array.from(row.cells)) {
        const name = names[col] ?? ''
        const own = cell.hasAttribute('data-label') && !cell.hasAttribute(AUTO)
        if (!own) {
          if (col > 0 && cell.colSpan === 1 && name) {
            if (cell.getAttribute('data-label') !== name) cell.setAttribute('data-label', name)
            cell.setAttribute(AUTO, '')
          } else if (cell.hasAttribute(AUTO)) {
            cell.removeAttribute('data-label')
            cell.removeAttribute(AUTO)
          }
        }
        col += cell.colSpan
      }
    }
  }
}

export function labelAllTables(root: ParentNode = document): void {
  root.querySelectorAll<HTMLTableElement>('table.data-table').forEach(labelTable)
}

export function installTableLabels(): void {
  if (typeof MutationObserver === 'undefined') return
  let queued = false
  const run = () => {
    queued = false
    labelAllTables()
  }
  const observer = new MutationObserver((records) => {
    if (queued) return
    // our own attribute writes are not observed (childList and text only)
    if (records.every((r) => r.type === 'attributes')) return
    queued = true
    requestAnimationFrame(run)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  run()
}
