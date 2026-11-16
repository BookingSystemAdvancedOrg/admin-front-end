/**
 * Lyser upp det assistenten pekar på: väntar tills sidan har ritat
 * elementen (upp till WAIT_MS), skrollar dit och ger dem en ring som tonar
 * bort efter ungefär 2,6 sekunder. Flera element lyses upp samtidigt. Inget
 * mer händer: sidan och dess val lämnas som de är.
 *
 * Mål: "help:<data-help-id>" eller "text:<synlig text>" (rubrik, fält,
 * knapp, flik). En text lyser upp sin rad eller sitt fält, inte bara ordet.
 */

const WAIT_MS = 4000
export const SPOT_MS = 2600
const TEXT_TAGS = 'h1,h2,h3,h4,label,button,a,legend,th,.appearance-title,.form-section-label,.settings-tab-title,.sk-kpi-label,.stat-tile-label,.card-title'
const ROW = '[data-help],.appearance-row,.form-field,.settings-tabs > button,.admin-card,button,a,tr,li'

/** Syns elementet (inte i en dold flik eller med display: none)? */
const visible = (el: Element) =>
  !(el as HTMLElement).closest('[hidden]') && getComputedStyle(el).display !== 'none'

export function findTargets(targets: string[], root: ParentNode = document): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const t of targets) {
    if (t.startsWith('help:')) {
      const id = t.slice(5)
      for (const el of root.querySelectorAll<HTMLElement>('[data-help]')) if (el.dataset.help === id && visible(el)) found.push(el)
    } else if (t.startsWith('text:')) {
      const want = t.slice(5).trim().toLowerCase()
      for (const el of root.querySelectorAll<HTMLElement>(TEXT_TAGS)) {
        if ((el.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() !== want || !visible(el)) continue
        const row = el.matches(ROW) ? el : (el.parentElement?.closest<HTMLElement>(ROW) ?? el)
        found.push(row)
        break
      }
    }
  }
  return [...new Set(found)]
}

let active: { stop: () => void } | null = null

/** Lyser upp målen; returnerar elementen som lyses upp. */
export function spotlight(targets: string[], opts: { waitMs?: number; reducedMotion?: boolean } = {}): Promise<HTMLElement[]> {
  active?.stop()
  if (!targets.length) return Promise.resolve([])
  const reduced = opts.reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  return new Promise((resolve) => {
    const started = Date.now()
    let timer = 0
    let frame = 0
    const lit: HTMLElement[] = []
    const stop = () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      for (const el of lit) el.classList.remove('help-spotlight', 'help-spotlight--fade')
    }
    active = { stop }
    const tryNow = () => {
      const els = findTargets(targets)
      if (!els.length && Date.now() - started < (opts.waitMs ?? WAIT_MS)) {
        frame = requestAnimationFrame(() => (timer = window.setTimeout(tryNow, 120)))
        return
      }
      if (!els.length) return resolve([])
      els[0].scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      for (const el of els) {
        el.classList.remove('help-spotlight--fade')
        el.classList.add('help-spotlight')
        lit.push(el)
      }
      timer = window.setTimeout(() => {
        for (const el of lit) el.classList.add('help-spotlight--fade')
        timer = window.setTimeout(() => {
          stop()
          if (active?.stop === stop) active = null
        }, 450)
      }, SPOT_MS)
      resolve(els)
    }
    tryNow()
  })
}
