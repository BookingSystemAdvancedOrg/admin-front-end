/** Öppnar ett hopfällt avsnitt (och de det ligger i) och rullar dit. */
export function revealSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
