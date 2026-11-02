import { describe, expect, it } from 'vitest'
import { stepsFor } from './steps'

const ids = (ctx: Parameters<typeof stepsFor>[0]) => stepsFor(ctx).map((s) => s.id)
const NEW = ['personalliggare', 'gaster', 'presentkort', 'webbplats']

describe('guide steps for the new nav items', () => {
  it('are skipped while the features are off', () => {
    const all = ids({ isOwner: true, features: { ordering: true, catering: true, marketing: true } })
    for (const id of NEW) expect(all).not.toContain(id)
  })

  it('are shown when on, with the contract titles', () => {
    const features = { personalliggare: true, guestCrm: true, giftCards: true, siteBuilder: true }
    const steps = stepsFor({ isOwner: true, features }).filter((s) => NEW.includes(s.id))
    expect(steps.map((s) => [s.target, s.title])).toEqual([
      ['nav-personalliggare', 'Personalliggare'],
      ['nav-gaster', 'Gäster'],
      ['nav-presentkort', 'Presentkort'],
      ['nav-webbplats', 'Webbplats'],
    ])
  })

  it('follow the sidebar: Presentkort and Webbplats only for the owner', () => {
    const staff = ids({ isOwner: false, features: { personalliggare: true, guestCrm: true, giftCards: true, siteBuilder: true } })
    expect(staff).toContain('personalliggare')
    expect(staff).toContain('gaster')
    expect(staff).not.toContain('presentkort')
    expect(staff).not.toContain('webbplats')
  })

  it('Telefon and Evenemang are skipped while off and shown to owner and staff when on', () => {
    const off = ids({ isOwner: true, features: { personalliggare: true, siteBuilder: true } })
    expect(off).not.toContain('telefon')
    expect(off).not.toContain('evenemang')
    for (const isOwner of [true, false]) {
      const steps = stepsFor({ isOwner, features: { phoneAgent: true, events: true } })
        .filter((s) => ['telefon', 'evenemang'].includes(s.id))
      expect(steps.map((s) => [s.target, s.title, s.text])).toEqual([
        ['nav-telefon', 'Telefon', 'Låt assistenten svara när ni inte hinner. Se samtalen, vem som vill bli uppringd och stäng av när ni vill.'],
        ['nav-evenemang', 'Evenemang', 'Sälj biljetter till kvällar och middagar, scanna vid dörren och se vad som är sålt.'],
      ])
    }
  })
})
