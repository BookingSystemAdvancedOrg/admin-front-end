import { describe, expect, it } from 'vitest'
import { hasFeature } from './tenant'

const t = (features: Record<string, boolean>) => ({ entitlements: { maxLocations: null, features } })

describe('hasFeature', () => {
  it('is on only when the key is true', () => {
    expect(hasFeature(t({ marketing: true }), 'marketing')).toBe(true)
    expect(hasFeature(t({ marketing: false }), 'marketing')).toBe(false)
    expect(hasFeature(t({}), 'metaAds')).toBe(false)
  })

  it('treats a list as any of', () => {
    expect(hasFeature(t({ socialPosting: true }), ['marketing', 'metaAds', 'socialPosting'])).toBe(true)
    expect(hasFeature(t({}), ['marketing', 'metaAds'])).toBe(false)
    expect(hasFeature(t({}), [])).toBe(false)
  })

  it('is off without a tenant', () => {
    expect(hasFeature(null, 'giftCards')).toBe(false)
    expect(hasFeature(undefined, ['giftCards'])).toBe(false)
  })
})
