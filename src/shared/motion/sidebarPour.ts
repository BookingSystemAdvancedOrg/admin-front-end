/**
 * Sidomenyn fylls med vinrött första gången appen visas i fliken, inte vid
 * varje sidbyte: AdminLayout ritas en gång och byter bara innehåll, men
 * efter utloggning eller en ny inloggning monteras det om. Flaggan minns
 * att det redan hänt så länge fliken lever (inget sparas i webbläsaren).
 */
let poured = false

export function sidebarShouldPour(): boolean {
  if (poured) return false
  poured = true
  return true
}

/** Endast för tester. */
export function resetSidebarPour(): void {
  poured = false
}
