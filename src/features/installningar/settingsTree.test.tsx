import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BRANCHES, BRANCH_HINT, BRANCH_LABEL, LEAVES, TREES, branchVisible, searchLeaves } from './settingsTree'
import type { BranchId } from './settingsTree'
import { SettingsTreeNav } from './SettingsTreeView'
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
