/**
 * Länken i "Välj ett nytt lösenord"-mejlet:
 *
 *   https://<adminappen>/aterstall-losenord#code=123456&email=anna%40exempel.se
 *
 * Koden och adressen ligger i fragmentet (#…), som aldrig skickas till någon
 * server - sidan läser dem och tar sedan bort dem ur adressfältet.
 * (infrastructure compute/lambda/cognito-custom-message bygger länken.)
 */

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const CODE_PATTERN = /^\d{6}$/

export interface ResetLink {
  code: string
  email: string
}

/** Kod och adress ur fragmentet; null om länken saknar eller har trasiga värden. */
export function parseResetLink(hash: string): ResetLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const code = (params.get('code') ?? '').replace(/\s+/g, '')
  const email = (params.get('email') ?? '').trim()
  if (!CODE_PATTERN.test(code) || !EMAIL_PATTERN.test(email)) return null
  return { code, email }
}
