import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent, RefObject } from 'react'
import { Icon } from '../../shared/Icon'
import { BRANCH_LABEL, fold, searchLeaves, treeOf } from './settingsTree'
import type { BranchId, Leaf, Tree, TreeId } from './settingsTree'
import type { Apple } from './settingsApples'
import './settingsTree.css'

/**
 * Inställningarnas fält, träd och grenar (settingsTree.ts). Datorn (från
 * 1100 px): fältet över hela bredden, trädet till vänster i ett träd och en
 * gren, med var man är överst. Mindre skärmar: fältet, sedan trädet, sedan
 * grenen, med en tillbaka-knapp i stället.
 */

export type { Apple }

/**
 * Fokus följer vyn. Byts vyn (fält, träd, gren) medan fokus står i vyn
 * eller har tappats (knappen man tryckte på försvann) flyttas det till den
 * nya vyns rubrik, eller, på väg tillbaka, till kortet eller raden man kom
 * från (data-stree-from). Står fokus utanför (trädet till vänster, Spara)
 * får det stå kvar.
 */
export function useViewFocus(view: string, body: RefObject<HTMLElement | null>) {
  const last = useRef<string | null>(null)
  useEffect(() => {
    const from = last.current
    last.current = view
    const root = body.current
    if (from === null || from === view || !root) return
    const now = document.activeElement as HTMLElement | null
    const dropped = !now || now === document.body || !now.isConnected || now.closest('[hidden]') !== null || root.contains(now)
    if (!dropped) return
    const target =
      (from && root.querySelector<HTMLElement>(`[data-stree-from="${from}"]`)) ||
      root.querySelector<HTMLElement>('.stree-title') ||
      root.querySelector<HTMLElement>('.stree-search input')
    target?.focus({ preventScroll: true })
  }, [view, body])
}

/**
 * Har grenen ett enda kort med samma rubrik som grenen (Betalningar,
 * Bokföring ...) står namnet redan överst: kortets rubrik döljs då för
 * ögat (data-stree-quiet) men finns kvar för skärmläsare. Korten ritar
 * sina rubriker när de hämtat, så grenen bevakas medan den är öppen.
 */
export function useQuietCardTitle(branch: BranchId | null, body: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pane = branch ? body.current?.querySelector<HTMLElement>(`.settings-branch[data-branch="${branch}"]`) : null
    if (!branch || !pane) return
    const label = fold(BRANCH_LABEL[branch])
    const check = () => {
      const cards = Array.from(pane.querySelectorAll<HTMLElement>('.admin-card')).filter((c) => !c.parentElement?.closest('.admin-card'))
      const heading = cards.length === 1 ? cards[0].querySelector<HTMLElement>('h2, h3') : null
      const quiet = heading && fold((heading.textContent ?? '').trim()) === label ? heading : null
      pane.querySelectorAll<HTMLElement>('[data-stree-quiet]').forEach((el) => {
        if (el !== quiet) el.removeAttribute('data-stree-quiet')
      })
      if (quiet && !quiet.hasAttribute('data-stree-quiet')) quiet.setAttribute('data-stree-quiet', '')
    }
    check()
    const watch = new MutationObserver(check)
    watch.observe(pane, { childList: true, subtree: true, characterData: true })
    return () => watch.disconnect()
  }, [branch, body])
}

/** Trädet med bara de grenar den inloggade ser. */
export interface VisibleTree extends Tree {
  /** Länk till /personal under Personal, när personalsidan syns. */
  personalLink?: boolean
}

type NavItem =
  | { key: string; kind: 'tree'; tree: VisibleTree }
  | { key: string; kind: 'branch'; branch: BranchId; tree: VisibleTree }
  | { key: string; kind: 'link'; tree: VisibleTree }

/**
 * Trädet till vänster (datorn): träden fälls ut, grenarna är valen.
 * Tangentbord som ett vanligt träd: pil upp/ner, höger fäller ut och går
 * in, vänster fäller ihop och går upp, Enter och mellanslag öppnar.
 */
export function SettingsTreeNav({
  trees,
  current,
  currentTree,
  onBranch,
  onPersonal,
}: {
  trees: VisibleTree[]
  current: BranchId | null
  currentTree: TreeId | null
  onBranch: (b: BranchId) => void
  onPersonal: () => void
}) {
  const [open, setOpen] = useState<Set<TreeId>>(() => new Set(currentTree ? [currentTree] : []))
  // Öppnas en gren (länk, guiden, fältet) fälls dess träd ut.
  useEffect(() => {
    if (currentTree) setOpen((s) => (s.has(currentTree) ? s : new Set(s).add(currentTree)))
  }, [currentTree])

  const items = useMemo<NavItem[]>(
    () =>
      trees.flatMap((tree) => [
        { key: tree.id, kind: 'tree' as const, tree },
        ...(open.has(tree.id)
          ? [
              ...tree.branches.map((branch) => ({ key: branch, kind: 'branch' as const, branch, tree })),
              ...(tree.personalLink ? [{ key: `${tree.id}:personal`, kind: 'link' as const, tree }] : []),
            ]
          : []),
      ]),
    [trees, open],
  )
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const tabKey = items.some((i) => i.key === focusKey) ? focusKey : (current ?? items[0]?.key ?? null)
  const refs = useRef(new Map<string, HTMLElement>())
  const focus = (key: string) => {
    setFocusKey(key)
    refs.current.get(key)?.focus()
  }
  const toggle = (id: TreeId, to?: boolean) =>
    setOpen((s) => {
      const next = new Set(s)
      if (to ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return next
    })
  const activate = (item: NavItem) => {
    if (item.kind === 'tree') toggle(item.tree.id)
    else if (item.kind === 'branch') onBranch(item.branch)
    else onPersonal()
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>, item: NavItem) {
    const i = items.indexOf(item)
    const key = e.key
    if (key === 'ArrowDown' && i < items.length - 1) focus(items[i + 1].key)
    else if (key === 'ArrowUp' && i > 0) focus(items[i - 1].key)
    else if (key === 'Home') focus(items[0].key)
    else if (key === 'End') focus(items[items.length - 1].key)
    else if (key === 'ArrowRight' && item.kind === 'tree') {
      if (!open.has(item.tree.id)) toggle(item.tree.id, true)
      else if (items[i + 1] && items[i + 1].kind !== 'tree') focus(items[i + 1].key)
    } else if (key === 'ArrowLeft') {
      if (item.kind === 'tree') toggle(item.tree.id, false)
      else focus(item.tree.id)
    } else if (key === 'Enter' || key === ' ') activate(item)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const props = (item: NavItem) => ({
    ref: (el: HTMLElement | null) => {
      if (el) refs.current.set(item.key, el)
      else refs.current.delete(item.key)
    },
    tabIndex: item.key === tabKey ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, item),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target === e.currentTarget) setFocusKey(item.key)
    },
  })

  return (
    <nav className="stree-nav" aria-label="Inställningar">
      <ul className="stree" role="tree" aria-label="Inställningar">
        {trees.map((tree) => {
          const treeItem = items.find((i) => i.key === tree.id) as NavItem
          const expanded = open.has(tree.id)
          const here = tree.id === currentTree
          return (
            <li key={tree.id} role="none" className={here ? 'stree-tree here' : 'stree-tree'}>
              {/* Raden är trädets treeitem och äger gruppen (WAI:s navigationsträd), så namnet är bara trädets. */}
              <div
                className="stree-row"
                role="treeitem"
                aria-expanded={expanded}
                aria-owns={`stree-group-${tree.id}`}
                aria-label={tree.label}
                onClick={() => toggle(tree.id)}
                {...props(treeItem)}
              >
                <span className="stree-icon" aria-hidden="true"><Icon name={tree.icon} size={18} /></span>
                <span className="stree-label">{tree.label}</span>
                <span className="stree-chevron" aria-hidden="true"><Icon name="chevron-down" size={16} /></span>
              </div>
              <div className="stree-fold" data-open={expanded}>
                <ul role="group" className="stree-group" id={`stree-group-${tree.id}`}>
                  {expanded &&
                    tree.branches.map((t) => {
                      const item = items.find((i) => i.key === t) as NavItem
                      return (
                        <li
                          key={t}
                          role="treeitem"
                          aria-selected={t === current}
                          aria-current={t === current ? 'page' : undefined}
                          className={t === current ? 'stree-branch active' : 'stree-branch'}
                          data-tour={`settings-tab-${t}`}
                          data-help={`settings-tab:${t}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onBranch(t)
                          }}
                          {...props(item)}
                        >
                          <span className="settings-tab-title">{BRANCH_LABEL[t]}</span>
                        </li>
                      )
                    })}
                  {expanded && tree.personalLink && (
                    <li
                      role="treeitem"
                      className="stree-branch stree-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPersonal()
                      }}
                      {...props(items.find((i) => i.kind === 'link' && i.tree.id === tree.id) as NavItem)}
                    >
                      <span className="settings-tab-title">Personal och inloggningar</span>
                      <Icon name="arrow-right" size={14} />
                    </li>
                  )}
                </ul>
              </div>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Apples({ apples, onBranch }: { apples: Apple[]; onBranch: (b: BranchId) => void }) {
  if (apples.length === 0) return null
  return (
    <ul className="stree-apples" aria-label="Status">
      {apples.map((a) => (
        <li key={`${a.branch}:${a.text}`}>
          <button
            type="button"
            className={a.tone ? `stree-apple ${a.tone}` : 'stree-apple'}
            onClick={() => onBranch(a.branch)}
            title={BRANCH_LABEL[a.branch]}
          >
            <span className="stree-apple-dot" aria-hidden="true" />
            {a.text}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Startsidan: sökfältet och ett kort per träd med grenarna och äpplena. */
export function SettingsField({
  trees,
  apples,
  visible,
  onTree,
  onBranch,
  onLeaf,
  onPersonal,
}: {
  trees: VisibleTree[]
  apples: Partial<Record<TreeId, Apple[]>>
  visible: (b: BranchId) => boolean
  onTree: (t: TreeId) => void
  onBranch: (b: BranchId) => void
  onLeaf: (leaf: Leaf) => void
  onPersonal: () => void
}) {
  return (
    <div className="stree-field">
      <LeafSearch visible={visible} onLeaf={onLeaf} />
      <div className="stree-grid">
        {trees.map((tree, i) => (
          <section key={tree.id} className="admin-card stree-card" style={{ '--i': i } as CSSProperties} aria-labelledby={`stree-${tree.id}`}>
            <h2 className="stree-card-heading" id={`stree-${tree.id}`}>
              <button type="button" className="stree-card-head" data-stree-from={tree.id} onClick={() => onTree(tree.id)}>
                <span className="stree-icon" aria-hidden="true"><Icon name={tree.icon} size={20} /></span>
                <span className="stree-card-title">{tree.label}</span>
                <Icon name="chevron-right" size={16} className="stree-card-go" />
              </button>
            </h2>
            <Apples apples={apples[tree.id] ?? []} onBranch={onBranch} />
            <ul className="stree-card-branches">
              {tree.branches.map((b) => (
                <li key={b}>
                  <button type="button" className="stree-card-branch" data-stree-from={b} onClick={() => onBranch(b)}>
                    {BRANCH_LABEL[b]}
                  </button>
                </li>
              ))}
              {tree.personalLink && (
                <li>
                  <button type="button" className="stree-card-branch" onClick={onPersonal}>
                    Personal och inloggningar
                  </button>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Ett träd (mindre skärmar, eller från kortets rubrik): grenarna som rader. */
export function SettingsTreePage({
  tree,
  apples,
  onField,
  onBranch,
  onPersonal,
}: {
  tree: VisibleTree
  apples: Apple[]
  onField: () => void
  onBranch: (b: BranchId) => void
  onPersonal: () => void
}) {
  return (
    <div className="stree-view">
      <div className="stree-head">
        <button type="button" className="settings-back" onClick={onField}>
          <Icon name="chevron-left" size={16} /> Inställningar
        </button>
        <nav className="stree-crumbs" aria-label="Du är här">
          <ol>
            <li><button type="button" onClick={onField}>Inställningar</button></li>
            <li aria-current="page">{tree.label}</li>
          </ol>
        </nav>
        <h2 className="stree-title" tabIndex={-1}>{tree.label}</h2>
      </div>
      <Apples apples={apples} onBranch={onBranch} />
      <ul className="stree-rows">
        {tree.branches.map((b) => (
          <li key={b}>
            <button type="button" className="settings-menu-item" data-stree-from={b} onClick={() => onBranch(b)}>
              <span className="settings-menu-text">
                <span className="settings-menu-title">{BRANCH_LABEL[b]}</span>
              </span>
              <span className="settings-menu-arrow" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
            </button>
          </li>
        ))}
        {tree.personalLink && (
          <li>
            <button type="button" className="settings-menu-item" onClick={onPersonal}>
              <span className="settings-menu-text">
                <span className="settings-menu-title">Personal och inloggningar</span>
              </span>
              <span className="settings-menu-arrow" aria-hidden="true"><Icon name="arrow-right" size={16} /></span>
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}

/** Överst i en gren: tillbaka (mindre skärmar), var man är och grenens namn. */
export function BranchHead({ branch, onField, onTree }: { branch: BranchId; onField: () => void; onTree: (t: TreeId) => void }) {
  const tree = treeOf(branch)
  return (
    <div className="stree-head">
      <button type="button" className="settings-back" onClick={() => onTree(tree.id)}>
        <Icon name="chevron-left" size={16} /> {tree.label}
      </button>
      <nav className="stree-crumbs" aria-label="Du är här">
        <ol>
          <li><button type="button" onClick={onField}>Inställningar</button></li>
          <li><button type="button" onClick={() => onTree(tree.id)}>{tree.label}</button></li>
          <li aria-current="page">{BRANCH_LABEL[branch]}</li>
        </ol>
      </nav>
      <h2 className="stree-title" tabIndex={-1} data-tour={`settings-tab-${branch}`} data-help={`settings-tab:${branch}`}>
        {BRANCH_LABEL[branch]}
      </h2>
    </div>
  )
}

/** Längst ned i en gren: föregående och nästa gren. */
export function BranchPager({ order, branch, onBranch }: { order: BranchId[]; branch: BranchId; onBranch: (b: BranchId) => void }) {
  const i = order.indexOf(branch)
  const prev = i > 0 ? order[i - 1] : null
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null
  if (!prev && !next) return null
  return (
    <nav className="stree-pager" aria-label="Fler inställningar">
      {prev ? (
        <button type="button" className="stree-pager-link" onClick={() => onBranch(prev)}>
          <Icon name="chevron-left" size={16} />
          <span>{BRANCH_LABEL[prev]}</span>
        </button>
      ) : <span />}
      {next && (
        <button type="button" className="stree-pager-link next" onClick={() => onBranch(next)}>
          <span>{BRANCH_LABEL[next]}</span>
          <Icon name="chevron-right" size={16} />
        </button>
      )}
    </nav>
  )
}

/** Sökfältet på fältet: hittar en inställning och hoppar till dess gren. */
function LeafSearch({ visible, onLeaf }: { visible: (b: BranchId) => boolean; onLeaf: (leaf: Leaf) => void }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => searchLeaves(query, visible), [query, visible])
  const current = Math.min(active, Math.max(results.length - 1, 0))
  const searching = query.trim().length > 0
  // Utan träffar ingen lista (en tom listbox är fel); raden nedan säger det.
  const open = searching && results.length > 0

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length) setActive((current + 1) % results.length)
    else if (e.key === 'ArrowUp' && results.length) setActive((current - 1 + results.length) % results.length)
    else if (e.key === 'Enter' && results[current]) onLeaf(results[current])
    else if (e.key === 'Escape' && query) setQuery('')
    else return
    e.preventDefault()
  }

  return (
    <div className="stree-search">
      <label className="stree-search-box">
        <Icon name="search" size={18} />
        <span className="sr-only">Sök inställning</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-o${current}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Sök inställning"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <p className="sr-only" role="status">
        {searching ? (results.length === 1 ? '1 träff' : results.length ? `${results.length} träffar` : 'Inga träffar') : ''}
      </p>
      {searching && !open && (
        <div className="stree-results">
          <p className="stree-empty">Inga träffar för ”{query.trim()}”.</p>
        </div>
      )}
      {open && (
        <div className="stree-results" id={`${id}-list`} role="listbox" aria-label="Inställningar">
          {results.map((leaf, i) => (
            <div
              key={`${leaf.branch}:${leaf.label}`}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === current}
              className="stree-result"
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => onLeaf(leaf)}
            >
              <span className="stree-result-label">{leaf.label}</span>
              <span className="stree-result-path">
                {treeOf(leaf.branch).label} › {BRANCH_LABEL[leaf.branch]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

