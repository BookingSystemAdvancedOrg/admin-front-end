/**
 * Klickbara tabellrader: hela raden öppnar redigeringen, men inte när
 * klicket landade på en egen kontroll i raden (status-reglaget, Redigera,
 * Radera, "…"-menyn, bilden) eller utanför raden i DOM:en (React bubblar
 * händelser från portaler, t.ex. bildrutan, upp genom komponentträdet).
 * Markerad text räknas inte heller som ett klick.
 */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="switch"], [role="button"], [role="menuitem"], [contenteditable="true"], [data-row-stop], .row-actions-box'

export function shouldOpenRow(target: EventTarget | null, row: Element): boolean {
  if (!(target instanceof Element) || !row.contains(target)) return false
  const control = target.closest(INTERACTIVE)
  if (control && control !== row && row.contains(control)) return false
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null
  if (selection && !selection.isCollapsed && selection.toString().trim() && row.contains(selection.anchorNode)) {
    return false
  }
  return true
}

/** Enter på själva raden (inte på en knapp i den) öppnar den. */
export function isRowOpenKey(e: { key: string; target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  return e.key === 'Enter' && e.target === e.currentTarget
}
