// Regel: varje ändring som användaren ser lägger till EN post här (nytt n, nyaste sist), bara VAR ändringen finns, 2 till 4 ord.
/**
 * "Nytt i versionen". Bygget bäddar in högsta n (BUILT_N) och lägger hela
 * listan som /whats-new.json (laddas upp med no-cache). När rutan "Ny version
 * finns" visas listas posterna med n större än det bygge som körs.
 * Exempel: "Personal profilbild", "Meny allergener". Inga verb, inga
 * förklaringar, inga tankstreck. Se README (Nytt i versionen).
 */

export type WhatsNewEntry = { n: number; text: string }

export const WHATS_NEW: WhatsNewEntry[] = [
  { n: 1, text: 'Automatisk uppdatering' },
  { n: 2, text: 'Felmeddelanden' },
  { n: 3, text: 'Glaskort' },
  { n: 4, text: 'Siffror utan text' },
  { n: 5, text: 'Telefon inställningar' },
  { n: 6, text: 'Fråga Booqy knapp' },
  { n: 7, text: 'Meny allergener' },
  { n: 8, text: 'Meny tillval' },
  { n: 9, text: 'Öppettider efter midnatt' },
  { n: 10, text: 'Abonnemang kort' },
  { n: 11, text: 'Nya rullistor' },
]

declare const __WHATS_NEW_N__: number | undefined

/** Högsta n i det här bygget (sätts av vite.config.ts; 0 utan Vite). */
export const BUILT_N: number = typeof __WHATS_NEW_N__ === 'number' ? __WHATS_NEW_N__ : 0

/** Högsta n i en lista. */
export function latestN(list: WhatsNewEntry[]): number {
  return list.reduce((max, e) => Math.max(max, e.n), 0)
}
