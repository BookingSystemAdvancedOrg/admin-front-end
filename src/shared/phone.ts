/**
 * Telefonnummer som man skriver dem: "0723001573" visas direkt som
 * "+46 72 300 15 73" och skickas som "+46723001573" (E.164, som alla API:n
 * redan normaliserar till). Samma fil finns i admin-front-end,
 * customer-front-end och booqy-console (web) - ändra alla tre tillsammans.
 */

/** Högst så många siffror efter +46 (svenska nationella nummer). */
const SE_MAX = 9
/** E.164 tillåter högst 15 siffror totalt. */
const E164_MAX = 15

/**
 * Det som skickas: "+46723001573", "" för ett tomt fält, och "+" medan man
 * just börjat skriva ett utländskt nummer. 07.../08... blir +46, 00 blir +.
 * Börjar det varken med + eller 0 gissas inget (12345678 kan vara ett
 * felskrivet nummer): siffrorna lämnas som de är, så formuläret säger till.
 */
export function toE164(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const plus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!plus) {
    if (digits.startsWith('00')) digits = digits.slice(2)
    else if (digits.startsWith('0')) digits = '46' + digits.slice(1)
    else return digits.slice(0, E164_MAX)
  }
  if (digits.startsWith('46')) {
    let national = digits.slice(2)
    if (national.startsWith('0')) national = national.slice(1) // +46 070... -> +46 70...
    digits = '46' + national.slice(0, SE_MAX)
  } else {
    digits = digits.slice(0, E164_MAX)
  }
  if (!digits) return plus ? '+' : ''
  return '+' + digits
}

function groups(digits: string, sizes: number[]): string[] {
  const out: string[] = []
  let rest = digits
  for (const size of sizes) {
    if (!rest) break
    out.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Visningen: "+46 72 300 15 73" (mobil), "+46 8 123 45 67" (Stockholm),
 * "+46 31 123 45 67" (övriga riktnummer). Utländska nummer får landskoden
 * (gissad som två siffror) och sedan grupper om tre.
 */
export function formatPhone(value: string): string {
  const e164 = toE164(value)
  if (!e164.startsWith('+') || e164.length <= 1) return e164
  const digits = e164.slice(1)
  if (digits.startsWith('46')) {
    const national = digits.slice(2)
    // Stockholm: 8 123 45 67, eller 8 123 456 78 när numret är åtta siffror.
    const sizes = national.startsWith('8') ? (national.length === 9 ? [1, 3, 3, 2] : [1, 3, 2, 2]) : [2, 3, 2, 2]
    return ['+46', ...groups(national, sizes)].join(' ')
  }
  return ['+' + digits.slice(0, 2), ...groups(digits.slice(2), [3, 3, 3, 3])].join(' ')
}

/**
 * En ändring i fältet: nytt värde att skicka, ny visning och var markören
 * ska stå. Raderar man ett mellanslag (backsteg mellan två grupper) tas
 * siffran före det bort i stället - annars hade backsteg inte gjort något.
 * Markören hamnar före lika många siffror som stod efter den, så den
 * stannar på rätt ställe när grupperna flyttar sig.
 */
export function editPhone(
  previous: string,
  raw: string,
  caret: number,
): { value: string; display: string; caret: number } {
  let text = raw
  let at = caret
  const significant = (s: string) => s.replace(/[^\d+]/g, '')
  if (raw.length < previous.length && significant(raw) === significant(previous)) {
    const before = raw.slice(0, caret)
    const idx = before.search(/\d(?=\D*$)/)
    if (idx >= 0) {
      text = raw.slice(0, idx) + raw.slice(idx + 1)
      at = idx
    }
  }
  const after = (text.slice(at).match(/\d/g) ?? []).length
  const value = toE164(text)
  const display = formatPhone(value)
  let pos = display.length
  if (after > 0) {
    let seen = 0
    for (let i = display.length - 1; i >= 0; i--) {
      if (/\d/.test(display[i]) && ++seen === after) {
        pos = i
        break
      }
    }
    if (seen < after) pos = 0
  }
  return { value, display, caret: pos }
}
