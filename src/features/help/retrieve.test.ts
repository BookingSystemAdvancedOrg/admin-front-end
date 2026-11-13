import { describe, expect, it } from 'vitest'
import type { Tenant } from '../../shared/tenant'
import { actionAllowed } from './kb'
import { fold, isSecretQuestion, isWhereQuestion, matchWeight } from './retrieve'

describe('retrieval rules', () => {
  it('folds Swedish letters like the server', () => {
    expect(fold('Öppettider på Julafton!')).toBe('oppettider pa julafton')
  })

  it('matches inflections and compound starts, not compound tails', () => {
    expect(matchWeight('ratt', 'ratt')).toBe(1)
    expect(matchWeight('ratten', 'ratt')).toBe(0.7)
    expect(matchWeight('koden', 'koder')).toBe(0.7)
    expect(matchWeight('bakgrundsfargen', 'bakgrund')).toBe(0.5)
    expect(matchWeight('oppettiderna', 'tider')).toBe(0)
  })

  it('knows where-questions and secret questions', () => {
    expect(isWhereQuestion('Var ser jag gäster idag?')).toBe(true)
    expect(isWhereQuestion('Hur många gäster idag?')).toBe(false)
    expect(isSecretQuestion('Vad är lösenordet?')).toBe(true)
    expect(isSecretQuestion('Hur byter jag lösenord?')).toBe(false)
    expect(isSecretQuestion('Vilka andra restauranger finns?')).toBe(true)
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
