import { describe, expect, it } from 'vitest'
import type { Tenant } from '../../shared/tenant'
import cases from './helpKbCases.json'
import { actionAllowed } from './kb'
import type { HelpView } from './kb'
import { OWNER_TEXT, UNKNOWN_TEXT, answerLocally, fold } from './retrieve'

/** Samma frågor som serverns test (application/tests/test_help_assistant.py). */

type Case = {
  question: string
  role: 'owner_user' | 'staff_user'
  features: string[]
  staffInsights?: boolean
  expect: string | null
  ownerOnly?: boolean
  action?: Record<string, unknown>
}

function viewFor(c: Case): HelpView {
  return { role: c.role, features: Object.fromEntries(c.features.map((f) => [f, true])), staffInsights: c.staffInsights ?? true }
}

function tenantFor(c: Case): Tenant {
  return {
    role: c.role,
    entitlements: { maxLocations: null, features: Object.fromEntries(c.features.map((f) => [f, true])) },
    insights: { staffAccess: c.staffInsights === false ? 'none' : 'operations' },
  } as unknown as Tenant
}

describe('answerLocally', () => {
  it.each(cases as Case[])('$role: $question', (c) => {
    const answer = answerLocally(c.question, viewFor(c))
    if (c.expect === null) {
      expect(answer.known).toBe(false)
      expect(answer.steps).toEqual([])
      expect(answer.text).toBe(c.ownerOnly ? OWNER_TEXT : UNKNOWN_TEXT)
      return
    }
    expect(answer.sources).toEqual([c.expect])
    expect(answer.steps.length).toBeGreaterThan(0)
    if (c.action) {
      expect(answer.actions[0]).toMatchObject(c.action)
      expect(actionAllowed(answer.actions[0], tenantFor(c))).toBe(true)
    }
  })

  it('folds Swedish letters like the server', () => {
    expect(fold('Öppettider på Julafton!')).toBe('oppettider pa julafton')
  })
})

describe('actionAllowed', () => {
  const owner = { role: 'owner_user', entitlements: { maxLocations: null, features: { reservations: true } } } as unknown as Tenant
  const staff = { ...owner, role: 'staff_user' } as Tenant

  it('refuses routes that do not exist or have parameters', () => {
    expect(actionAllowed({ id: 'x', label: 'X', to: '/finns-inte' }, owner)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/catering/:locationId/:requestId' }, owner)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: 'https://example.com' }, owner)).toBe(false)
  })

  it('refuses pages the role or plan does not show', () => {
    expect(actionAllowed({ id: 'x', label: 'X', to: '/personal' }, owner)).toBe(true)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/personal' }, staff)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/ta-betalt' }, owner)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/avtal' }, staff)).toBe(false)
  })

  it('refuses unknown forms and unsafe query or hash values', () => {
    expect(actionAllowed({ id: 'x', label: 'X', to: '/meny', pageAction: 'delete-all' }, owner)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/meny', hash: 'a"><script>' }, owner)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/statistik', query: { period: 'month&x=1' } }, owner)).toBe(false)
    expect(actionAllowed({ id: 'x', label: 'X', to: '/statistik', query: { period: 'month' } }, owner)).toBe(true)
  })
})
