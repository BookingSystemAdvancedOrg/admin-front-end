import { describe, expect, it } from 'vitest'
import { PASSWORD_RULES, meetsAllRules, passwordProblem } from './passwordRules'

const rule = (id: string) => PASSWORD_RULES.find((r) => r.id === id)!

describe('password rules (same as the user pool policy)', () => {
  it('needs 8 characters, upper- and lowercase, a digit and a symbol', () => {
    expect(meetsAllRules('Aa1!aaaa')).toBe(true)
    expect(meetsAllRules('aa1!aaaa')).toBe(false)
    expect(meetsAllRules('AA1!AAAA')).toBe(false)
    expect(meetsAllRules('Aa!aaaaa')).toBe(false)
    expect(meetsAllRules('Aa1aaaaa')).toBe(false)
    expect(meetsAllRules('Aa1!aaa')).toBe(false)
  })

  it('counts only A-Z and a-z as letters, like Cognito', () => {
    expect(rule('upper').test('ÅÄÖ')).toBe(false)
    expect(rule('lower').test('åäö')).toBe(false)
  })

  it("counts Cognito's special characters, a space inside too", () => {
    for (const ch of '^$*.[]{}()?"!@#%&/\\,><\':;|_~`=+- ') {
      expect(rule('symbol').test(`a${ch}b`)).toBe(true)
    }
    expect(rule('symbol').test('abc123ÅÄÖ')).toBe(false)
  })

  it('explains what is wrong', () => {
    expect(passwordProblem('kort', 'kort')).toBe('Lösenordet uppfyller inte alla krav ännu.')
    expect(passwordProblem(' Aa1!aaaa', ' Aa1!aaaa')).toBe(
      'Lösenordet får inte börja eller sluta med mellanslag.',
    )
    expect(passwordProblem('Aa1!aaaa', 'Aa1!aaab')).toBe('Lösenorden matchar inte.')
    const long = 'Aa1!' + 'a'.repeat(253)
    expect(passwordProblem(long, long)).toBe('Lösenordet får vara högst 256 tecken.')
    expect(passwordProblem('Aa1!aaaa', 'Aa1!aaaa')).toBeNull()
  })
})
