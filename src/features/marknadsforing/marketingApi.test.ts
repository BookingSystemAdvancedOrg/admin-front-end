import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { campaignSlug, cleanTemplate, errorText, percent, templateErrors, trackedLink } from './marketingApi'
import type { TemplateInput } from './marketingApi'

const base: TemplateInput = {
  name: 'Vår',
  subject: 'Hej {förnamn}',
  preheader: '',
  blocks: [{ type: 'heading', text: 'Rubrik' }],
}

describe('templateErrors', () => {
  it('accepts a valid template', () => {
    expect(templateErrors(base)).toEqual([])
  })

  it('mirrors the server rules', () => {
    const errors = templateErrors({
      ...base,
      subject: '',
      blocks: [
        { type: 'image', url: 'http://x.se/a.png' },
        { type: 'button', label: 'Gå', destination: 'custom', url: 'javascript:alert(1)' },
        { type: 'dish', menuItemId: '', locationId: 'l' },
      ],
    })
    expect(errors).toHaveLength(4)
    expect(errors[0]).toMatch(/Ämnesraden/)
  })

  it('requires at least one block', () => {
    expect(templateErrors({ ...base, blocks: [] })).toContain('Lägg till minst ett block.')
  })
})

describe('cleanTemplate', () => {
  it('drops the custom url on non-custom buttons and trims text', () => {
    const out = cleanTemplate({
      ...base,
      name: '  Namn  ',
      blocks: [{ type: 'button', label: ' Boka ', destination: 'book', url: 'https://x.se' }],
    })
    expect(out.name).toBe('Namn')
    expect(out.blocks).toEqual([{ type: 'button', label: 'Boka', destination: 'book' }])
  })
})

describe('tracked links', () => {
  it('builds utm tags the API counts', () => {
    expect(trackedLink('https://roma.se', 'book', 'instagram', 'Vårens Meny!')).toBe(
      'https://roma.se/boka-bord?utm_source=instagram&utm_medium=social&utm_campaign=varens-meny',
    )
  })

  it('keeps a preview address restaurant parameter', () => {
    expect(trackedLink('https://d1.cloudfront.net/?restaurang=roma', 'menu', 'qr', 'affisch')).toBe(
      'https://d1.cloudfront.net/meny?restaurang=roma&utm_source=qr&utm_medium=qr&utm_campaign=affisch',
    )
  })

  it('refuses non-https and empty campaigns', () => {
    expect(trackedLink('http://roma.se', 'home', 'sms', 'x')).toBeNull()
    expect(trackedLink('https://roma.se', 'home', 'sms', '!!!')).toBeNull()
    expect(trackedLink('inte en adress', 'home', 'sms', 'x')).toBeNull()
  })

  it('slugs Swedish names', () => {
    expect(campaignSlug('Höstens Ölprovning 2026')).toBe('hostens-olprovning-2026')
  })
})

describe('format', () => {
  it('formats percent', () => {
    expect(percent(1, 3)).toBe('33,3 %')
    expect(percent(1, 0)).toBe('-')
  })
})

describe('errorText', () => {
  it('explains a send refused for a missing legal sender in Swedish', () => {
    const err = new ApiError(400, 'the restaurant has no legal name and address for the footer')
    expect(errorText(err, 'Kunde inte skicka.')).toMatch(/^Företagsnamn och adress saknas/)
  })
})
