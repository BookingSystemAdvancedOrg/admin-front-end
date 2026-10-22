/**
 * Lösenordskraven för restaurangernas konton - samma som User Poolens
 * password policy i AWS (infrastructure storage/cognito: minst 8 tecken,
 * stor och liten bokstav, siffra och specialtecken). Checklistan på
 * "Välj ett nytt lösenord" och "Återställ lösenord" visar dem, och inget
 * lösenord skickas som Cognito ändå skulle neka.
 */

export interface PasswordRule {
  id: string
  label: string
  test: (pw: string) => boolean
}

// Cognito räknar bara A-Z och a-z (inte Å/Ä/Ö) som bokstäver i policyn,
// och de här tecknen (samt mellanslag inne i lösenordet) som specialtecken.
const SYMBOL = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+\- ]/

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'Minst 8 tecken', test: (pw) => pw.length >= 8 },
  { id: 'upper', label: 'Minst en stor bokstav (A-Z)', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'Minst en liten bokstav (a-z)', test: (pw) => /[a-z]/.test(pw) },
  { id: 'digit', label: 'Minst en siffra', test: (pw) => /\d/.test(pw) },
  { id: 'symbol', label: 'Minst ett specialtecken, t.ex. ! ? # %', test: (pw) => SYMBOL.test(pw) },
]

export const PASSWORD_MAX = 256

export function meetsAllRules(pw: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(pw))
}

/** Varför lösenordet inte går att spara, eller null. */
export function passwordProblem(pw: string, confirm: string): string | null {
  if (!meetsAllRules(pw)) return 'Lösenordet uppfyller inte alla krav ännu.'
  if (pw !== pw.trim()) return 'Lösenordet får inte börja eller sluta med mellanslag.'
  if (pw.length > PASSWORD_MAX) return `Lösenordet får vara högst ${PASSWORD_MAX} tecken.`
  if (pw !== confirm) return 'Lösenorden matchar inte.'
  return null
}
