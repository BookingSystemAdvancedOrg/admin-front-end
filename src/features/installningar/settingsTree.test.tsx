import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BRANCHES, BRANCH_HINT, BRANCH_LABEL, LEAVES, TREES, branchVisible, isBranch, isTree, searchLeaves } from './settingsTree'
import type { BranchId, TreeId } from './settingsTree'
import { BranchHead, BranchPager, SettingsField, SettingsTreeNav, SettingsTreePage, useQuietCardTitle, useViewFocus } from './SettingsTreeView'
import { buildApples } from './settingsApples'
import type { AppleInput } from './settingsApples'
import type { Tenant } from '../../shared/tenant'

const tenant = (role: Tenant['role'], features: Record<string, boolean> = {}) =>
  ({ role, entitlements: { maxLocations: 1, features } }) as unknown as Tenant

describe('settings tree', () => {
  it('gives every branch exactly one tree, a label and a hint', () => {
    expect([...BRANCHES].sort()).toEqual(Object.keys(BRANCH_LABEL).sort())
    expect(new Set(BRANCHES).size).toBe(BRANCHES.length)
    for (const b of BRANCHES) expect(BRANCH_HINT[b], b).toBeTruthy()
  })

  it('keeps the old tab ids as branch ids (deep links)', () => {
    for (const id of ['profil', 'betalningar', 'notiser', 'avbokning', 'bestallning', 'skrivare', 'dagar', 'bord', 'behorighet', 'bokforing', 'statistik', 'integritet', 'utseende', 'skrivbordsappen', 'google']) {
      expect(BRANCHES, id).toContain(id)
    }
  })

  it('gates branches by role and plan as before', () => {
    const staff = tenant('staff_user', { ordering: true, googleBusiness: true })
    const owner = tenant('owner_user', { ordering: false, googleBusiness: true })
    for (const b of ['abonnemang', 'bokforing', 'statistik', 'behorighet', 'integritet', 'google'] as BranchId[]) {
      expect(branchVisible(b, staff), b).toBe(false)
      expect(branchVisible(b, owner), b).toBe(true)
    }
    expect(branchVisible('bestallning', staff)).toBe(true)
    expect(branchVisible('skrivare', owner)).toBe(false)
    expect(branchVisible('google', tenant('owner_user', {}))).toBe(false)
    expect(branchVisible('utseende', staff)).toBe(true)
  })

  it('finds leaves by label, keyword and branch, without accents, only in visible branches', () => {
    const all = () => true
    expect(searchLeaves('sms', all).map((l) => l.label)).toContain('SMS till gästen')
    expect(searchLeaves('morkt', all)[0].branch).toBe('utseende')
    expect(searchLeaves('kortgaranti', all)[0].label).toBe('Kortgaranti')
    expect(searchLeaves('sie', (b) => b !== 'bokforing')).toEqual([])
    expect(searchLeaves('  ', all)).toEqual([])
    for (const leaf of LEAVES) expect(BRANCHES, leaf.label).toContain(leaf.branch)
  })
})

describe('SettingsTreeNav', () => {
  const trees = TREES.slice(0, 2).map((t) => ({ ...t }))

  it('is a keyboard tree: arrows move, right opens, left closes, Enter opens a branch', async () => {
    const user = userEvent.setup()
    const onBranch = vi.fn()
    render(<SettingsTreeNav trees={trees} current="notiser" currentTree="gaster" onBranch={onBranch} onPersonal={() => {}} />)
    const tree = screen.getByRole('tree', { name: 'Inställningar' })
    expect(tree).toBeInTheDocument()
    const current = screen.getByRole('treeitem', { name: 'Notiser' })
    expect(current).toHaveAttribute('aria-current', 'page')
    // Bara den valda grenen går att tabba till.
    expect(current).toHaveAttribute('tabindex', '0')
    expect(screen.queryByRole('treeitem', { name: 'Profil och kontakt' })).toBeNull()

    current.focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('treeitem', { name: 'Gäster' })).toHaveFocus()
    await user.keyboard('{Home}')
    const restaurangen = screen.getByRole('treeitem', { name: 'Restaurangen' })
    expect(restaurangen).toHaveFocus()
    expect(restaurangen).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowRight}')
    expect(restaurangen).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('treeitem', { name: 'Profil och kontakt' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onBranch).toHaveBeenCalledWith('dagar')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(restaurangen).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('SettingsField', () => {
  const trees = TREES.map((t) => ({ ...t }))
  const field = () =>
    render(<SettingsField trees={trees} apples={{}} visible={() => true} onTree={() => {}} onBranch={() => {}} onLeaf={() => {}} onPersonal={() => {}} />)

  it('gives every tree a real h2 heading with the button inside it, not the other way round', () => {
    field()
    for (const t of trees) {
      const heading = screen.getByRole('heading', { level: 2, name: t.label })
      expect(heading.closest('button'), t.label).toBeNull()
      expect(within(heading).getByRole('button', { name: t.label })).toBeInTheDocument()
      expect(heading.closest('section')).toHaveAttribute('aria-labelledby', heading.id)
    }
  })

  it('shows no empty listbox when the search has no hits, and announces the count', async () => {
    const user = userEvent.setup()
    field()
    const box = screen.getByRole('combobox', { name: 'Sök inställning' })
    await user.type(box, 'zzzz')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Inga träffar')
    await user.clear(box)
    await user.type(box, 'kortgaranti')
    const list = screen.getByRole('listbox')
    const n = within(list).getAllByRole('option').length
    expect(n).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent(n === 1 ? '1 träff' : `${n} träffar`)
  })
})

/** Sidans vyer (fält, träd, gren) som i InstallningarPage, med samma fokusregel. */
function Views() {
  const [view, setView] = useState('')
  const body = useRef<HTMLDivElement>(null)
  useViewFocus(view, body)
  const go = (to: BranchId | TreeId | null) => setView(to ?? '')
  const trees = TREES.map((t) => ({ ...t }))
  const tree = isTree(view) ? trees.find((t) => t.id === view) : undefined
  return (
    <div ref={body}>
      {view === '' && <SettingsField trees={trees} apples={{}} visible={() => true} onTree={go} onBranch={go} onLeaf={(l) => go(l.branch)} onPersonal={() => {}} />}
      {tree && <SettingsTreePage tree={tree} apples={[]} onField={() => go(null)} onBranch={go} onPersonal={() => {}} />}
      {isBranch(view) && <BranchHead key={view} branch={view} onField={() => go(null)} onTree={go} />}
      {isBranch(view) && <BranchPager order={BRANCHES} branch={view} onBranch={go} />}
    </div>
  )
}

describe('focus follows the view', () => {
  it('moves to the new heading, and back to where you came from', async () => {
    const user = userEvent.setup()
    render(<Views />)
    // Fält -> gren: rubriken.
    screen.getByRole('button', { name: 'Notiser' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { level: 2, name: 'Notiser' })).toHaveFocus()
    // Nästa gren i bläddraren: den nya rubriken.
    await user.click(screen.getByRole('button', { name: BRANCH_LABEL.avbokning }))
    expect(screen.getByRole('heading', { level: 2, name: BRANCH_LABEL.avbokning })).toHaveFocus()
    // Gren -> fältet: grenens knapp i trädets kort.
    await user.click(screen.getByRole('button', { name: 'Inställningar' }))
    expect(screen.getByRole('button', { name: BRANCH_LABEL.avbokning })).toHaveFocus()
    // Fält -> träd: trädets rubrik.
    screen.getByRole('button', { name: 'Gäster' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { level: 2, name: 'Gäster' })).toHaveFocus()
    // Träd -> gren -> tillbaka: raden man kom från.
    await user.click(screen.getByRole('button', { name: 'Integritet' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Integritet' })).toHaveFocus()
    await user.click(screen.getAllByRole('button', { name: 'Gäster' })[0])
    expect(screen.getByRole('button', { name: 'Integritet' })).toHaveFocus()
    // Träd -> fältet: trädets kort.
    await user.click(screen.getAllByRole('button', { name: 'Inställningar' })[0])
    expect(screen.getByRole('button', { name: 'Gäster' })).toHaveFocus()
  })
})

/** En gren med kort, som i InstallningarPage. */
function Branch({ branch, cards }: { branch: BranchId; cards: string[] }) {
  const body = useRef<HTMLDivElement>(null)
  useQuietCardTitle(branch, body)
  return (
    <div ref={body}>
      <BranchHead branch={branch} onField={() => {}} onTree={() => {}} />
      <div className="settings-branch" data-branch={branch}>
        {cards.map((c) => (
          <section key={c} className="admin-card">
            <h2 className="card-title">{c}</h2>
          </section>
        ))}
      </div>
    </div>
  )
}

describe('a branch says its name once', () => {
  it('quiets a lone card whose title is the branch name, but keeps it for screen readers', async () => {
    const { rerender } = render(<Branch branch="betalningar" cards={['Betalningar']} />)
    const card = screen.getAllByRole('heading', { level: 2, name: 'Betalningar' })[1]
    expect(card).toHaveAttribute('data-stree-quiet')
    // Ett kort till: inget döljs längre.
    rerender(<Branch branch="betalningar" cards={['Betalningar', 'Utbetalningar']} />)
    await act(async () => {})
    expect(card).not.toHaveAttribute('data-stree-quiet')
  })

  it('leaves a card with its own title alone', () => {
    render(<Branch branch="profil" cards={['Restaurangprofil']} />)
    expect(screen.getByRole('heading', { name: 'Restaurangprofil' })).not.toHaveAttribute('data-stree-quiet')
  })
})

describe('apples', () => {
  const base = {
    tenantId: 't', name: 'R', slug: null, status: 'active', planId: 'starter',
    entitlements: { maxLocations: 1, features: {} }, locationCount: 1,
    stripe: { connected: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true },
    primaryDomain: null, senderName: null, replyToEmail: null,
    notifications: { sms: true, staffEmails: true, reminderHours: 24 },
    billing: { customer: true, hasCard: true, cardBrand: 'visa', cardLast4: '7799', collection: 'card', preference: 'card', daysUntilDue: 10, pastDue: false },
    role: 'owner_user', locations: [],
  } as unknown as Tenant
  const input = (over: Partial<AppleInput> = {}): AppleInput => ({
    tenant: base, isOwner: true, noLocation: false,
    hours: { monday: [{ opensAt: '11:00', closesAt: '22:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } as unknown as AppleInput['hours'],
    locExtra: { guarantee: { enabled: true } as never, ordering: { enabled: true } as never },
    theme: 'dark', sound: true, now: new Date('2026-11-16T12:00:00'), ...over,
  })
  const tones = (i: AppleInput) =>
    Object.fromEntries(Object.values(buildApples(i)).flat().map((a) => [a!.text, a!.tone ?? 'neutral']))

  it('is green only for what is live and working', () => {
    expect(tones(input())).toMatchObject({
      'Öppet i dag 11:00-22:00': 'ok', 'SMS på': 'ok', 'Kortgaranti på': 'ok', 'Tar emot beställningar': 'ok',
      'Kort ••7799': 'ok', 'Stripe aktiv': 'ok', Starter: 'neutral', 'Mörkt läge': 'neutral', 'Klickljud på': 'neutral',
    })
  })

  it('keeps preferences and off states neutral, and warns about what needs action', () => {
    const t = { ...base, planId: null, notifications: { ...base.notifications, sms: false }, stripe: { ...base.stripe, chargesEnabled: false },
      billing: { ...base.billing!, hasCard: false, cardLast4: null, collection: 'invoice' } } as unknown as Tenant
    expect(tones(input({ tenant: t, theme: 'light', sound: false, now: new Date('2026-11-17T12:00:00'),
      locExtra: { guarantee: { enabled: false } as never, ordering: { enabled: false } as never } }))).toEqual({
      'Stängt i dag': 'neutral', 'SMS av': 'neutral', 'Kortgaranti av': 'neutral', 'Tar inte emot beställningar': 'neutral',
      'Inget abonnemang': 'warn', Faktura: 'neutral', 'Stripe ej klar': 'warn', 'Ljust läge': 'neutral', 'Klickljud av': 'neutral',
    })
    expect(tones(input({ noLocation: true, hours: null }))['Ingen plats än']).toBe('warn')
  })

  it('draws the tone on the chip: ok, warn or nothing', () => {
    const apples = buildApples(input({ tenant: { ...base, notifications: { ...base.notifications, sms: false } } as Tenant }))
    render(<SettingsField trees={TREES.map((t) => ({ ...t }))} apples={apples} visible={() => true} onTree={() => {}} onBranch={() => {}} onLeaf={() => {}} onPersonal={() => {}} />)
    expect(screen.getByRole('button', { name: 'SMS av' })).toHaveAttribute('class', 'stree-apple')
    expect(screen.getByRole('button', { name: 'Stripe aktiv' })).toHaveAttribute('class', 'stree-apple ok')
  })
})
