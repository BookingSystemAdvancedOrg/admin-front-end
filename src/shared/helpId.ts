/**
 * Stabila hjälp-id:n (data-help) som hjälpassistenten pekar på och lyser
 * upp. Samma regel finns i scripts/help-corpus.mjs, som läser koden och
 * bygger kunskapsbasen: ändra båda tillsammans.
 */
export function helpSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
