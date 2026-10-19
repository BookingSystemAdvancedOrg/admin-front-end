/**
 * Ren logik bakom editorns Figma-liknande grepp: ångra/gör om, kortkommandon,
 * pilknappsflytt och kopiera/klistra in. Ligger utanför LayoutEditorPage så
 * att den går att testa utan att rendera hela 3D-scenen.
 */
import { GRID, WORKSPACE } from './data'
import type { Fixture, Floor, TableElement, WallSegment } from './data'

/* --- Ångra / gör om ------------------------------------------------------ */

/** Hur många steg bakåt som sparas - räcker gott, och håller minnet nere. */
export const HISTORY_LIMIT = 100

/**
 * Historiken är hela våningslistor (de är små, och oföränderliga - varje
 * ändring skapar nya objekt - så en "kopia" kostar bara en referens).
 * `present` är det senast INCHECKADE läget, inte varje mellanläge under ett
 * drag: ett helt drag blir ett enda ångra-steg.
 */
export interface History {
  past: Floor[][]
  present: Floor[]
  future: Floor[][]
}

export function startHistory(present: Floor[]): History {
  return { past: [], present, future: [] }
}

/** Checkar in `next` som ett nytt steg. Oförändrat läge ger inget steg. */
export function record(h: History, next: Floor[]): History {
  if (next === h.present) return h
  const past = [...h.past, h.present]
  return { past: past.slice(-HISTORY_LIMIT), present: next, future: [] }
}

export function undo(h: History): History | null {
  if (h.past.length === 0) return null
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  }
}

export function redo(h: History): History | null {
  if (h.future.length === 0) return null
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
  }
}

/* --- Kortkommandon -------------------------------------------------------- */

/** Verktyg som har en egen bokstav (samma namn som editorns Tool). */
export type ShortcutTool =
  | 'select'
  | 'hand'
  | 'ground'
  | 'wall'
  | 'window'
  | 'entrance'
  | 'kitchen'
  | 'counter'
  | 'add-square'
  | 'add-round'

export type EditorAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'delete' }
  | { type: 'escape' }
  | { type: 'nudge'; dx: number; dy: number; big: boolean }
  | { type: 'duplicate' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'tool'; tool: ShortcutTool }
  | { type: 'zoom-fit' }
  | { type: 'zoom-100' }
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'help' }
  | { type: 'rotate' }
  | { type: 'select-all' }
  | { type: 'confirm' }

/** Bokstav -> verktyg. Svenska ord där det går (Mark, Fönster, Entré, Kök). */
export const TOOL_KEYS: Record<string, ShortcutTool> = {
  v: 'select',
  h: 'hand',
  m: 'ground',
  w: 'wall',
  f: 'window',
  e: 'entrance',
  k: 'kitchen',
  c: 'counter',
  t: 'add-square',
  r: 'add-round',
}

/** Den bokstav ett verktyg har, för tooltips och hjälpen. */
export function keyForTool(tool: ShortcutTool): string {
  const found = Object.entries(TOOL_KEYS).find(([, t]) => t === tool)
  return found ? found[0].toUpperCase() : ''
}

export interface KeyLike {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/**
 * Tangent -> åtgärd, som i Figma/draw.io. Cmd på Mac, Ctrl annars.
 * Shift+1 / Shift+0 läses på `code` (fysisk tangent) eftersom tecknet
 * skiljer sig mellan tangentbordslayouter (svenskt Shift+1 är också "!",
 * men Shift+0 är "=").
 */
export function actionForKey(e: KeyLike): EditorAction | null {
  const mod = Boolean(e.metaKey || e.ctrlKey)
  const key = e.key.toLowerCase()

  if (mod) {
    if (key === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' }
    if (key === 'a') return { type: 'select-all' }
    if (key === 'y') return { type: 'redo' }
    if (key === 'd') return { type: 'duplicate' }
    if (key === 'c') return { type: 'copy' }
    if (key === 'v') return { type: 'paste' }
    if (key === '+' || key === '=') return { type: 'zoom-in' }
    if (key === '-') return { type: 'zoom-out' }
    if (key === '0') return { type: 'zoom-100' }
    return null
  }
  if (e.altKey) return null

  if (e.shiftKey && e.code === 'Digit1') return { type: 'zoom-fit' }
  if (e.shiftKey && key === 'r') return { type: 'rotate' }
  if (e.shiftKey && e.code === 'Digit0') return { type: 'zoom-100' }
  if (e.key === '?') return { type: 'help' }
  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'delete' }
  if (e.key === 'Escape') return { type: 'escape' }
  if (e.key === 'Enter') return { type: 'confirm' }

  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const arrow = arrows[e.key]
  if (arrow) return { type: 'nudge', dx: arrow[0], dy: arrow[1], big: Boolean(e.shiftKey) }

  if (!e.shiftKey && TOOL_KEYS[key]) return { type: 'tool', tool: TOOL_KEYS[key] }
  return null
}

/** Ska kortkommandon ignoreras för att fokus står i ett fält? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type)
}

/* --- Pilknappar ------------------------------------------------------------ */

/**
 * En pil på skärmen -> ett steg längs planens axlar. Vyn kan vara roterad
 * (`spinDeg`), så "höger" på skärmen är inte alltid +x i planen. Riktningen
 * avrundas till närmaste axel så att allt fortsätter snappa mot rutnätet.
 * Den lilla förskjutningen avgör lika lägen (t.ex. 45° vy) så att de fyra
 * pilarna alltid ger fyra olika riktningar.
 */
export function nudgeDelta(
  dx: number,
  dy: number,
  spinDeg: number,
  step: number,
): { x: number; y: number } {
  const screen = (Math.atan2(dy, dx) * 180) / Math.PI
  const plan = screen - spinDeg
  const quarter = ((Math.round((plan + 1e-6) / 90) % 4) + 4) % 4
  return [
    { x: step, y: 0 },
    { x: 0, y: step },
    { x: -step, y: 0 },
    { x: 0, y: -step },
  ][quarter]
}

/* --- Kopiera / duplicera --------------------------------------------------- */

export type Clip =
  | { kind: 'table'; table: TableElement }
  | { kind: 'fixture'; fixture: Fixture }
  | { kind: 'wall'; wall: WallSegment }

/** Nästa lediga bordsnummer över ALLA våningar (T1, T2 ... -> 3). */
export function nextTableNumber(floors: Floor[]): number {
  let max = 0
  for (const f of floors) {
    for (const t of f.tables) {
      const m = /(\d+)/.exec(t.label)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return max + 1
}

const HALF_W = WORKSPACE.w / 2
const HALF_H = WORKSPACE.h / 2
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/**
 * En kopia av klippet, förskjuten snett nedåt (2 rutor per gång, som
 * Figmas "klistra in igen") och hållen inom arbetsytan. Väggar flyttas
 * vinkelrätt mot sig själva så att kopian inte hamnar ovanpå originalet.
 * Öppningar följer inte med en kopierad vägg - de hör till sin egen vägg.
 */
export function pasteClip(
  clip: Clip,
  times: number,
  newId: () => string,
  newTableLabel: () => string,
): Clip {
  const off = GRID * 2 * times
  if (clip.kind === 'table') {
    const t = clip.table
    return {
      kind: 'table',
      table: {
        ...t,
        id: newId(),
        label: newTableLabel(),
        x: clamp(t.x + off, -HALF_W + t.w / 2, HALF_W - t.w / 2),
        y: clamp(t.y + off, -HALF_H + t.h / 2, HALF_H - t.h / 2),
      },
    }
  }
  if (clip.kind === 'fixture') {
    const f = clip.fixture
    return {
      kind: 'fixture',
      fixture: {
        ...f,
        id: newId(),
        x: clamp(f.x + off, -HALF_W + f.w / 2, HALF_W - f.w / 2),
        y: clamp(f.y + off, -HALF_H + f.h / 2, HALF_H - f.h / 2),
      },
    }
  }
  const w = clip.wall
  return {
    kind: 'wall',
    wall: {
      ...w,
      id: newId(),
      x: w.dir === 'v' ? clamp(w.x + off, -HALF_W, HALF_W) : w.x,
      y: w.dir === 'h' ? clamp(w.y + off, -HALF_H, HALF_H) : w.y,
    },
  }
}

/* --- Zoom mot muspekaren --------------------------------------------------- */

/**
 * Ny panorering så att punkten under pekaren står still när zoomen ändras
 * från `from` till `to` - som i Figma. `cursor` och `pan` är skärmpixlar
 * relativt scenens mitt.
 */
export function panForZoom(
  pan: { x: number; y: number },
  cursor: { x: number; y: number },
  from: number,
  to: number,
): { x: number; y: number } {
  const r = to / from
  return { x: cursor.x - (cursor.x - pan.x) * r, y: cursor.y - (cursor.y - pan.y) * r }
}

/* --- Bord: vrid och rad ----------------------------------------------------- */

/**
 * Vrider ett bord 90°: bredd och djup byter plats runt samma mittpunkt.
 * Bordets `rotation` lämnas på 0 med flit - varken editorn eller gästens
 * 3D-vy ritar en vinkel, men alla ritar bredd/djup, så det här ser rätt ut
 * överallt utan ändringar i API eller gästsajt. Runda bord ändras inte.
 */
export function turnTable(t: TableElement): TableElement {
  if (t.shape === 'round') return t
  return {
    ...t,
    w: t.h,
    h: t.w,
    x: clamp(t.x, -HALF_W + t.h / 2, HALF_W - t.h / 2),
    y: clamp(t.y, -HALF_H + t.w / 2, HALF_H - t.w / 2),
  }
}

/**
 * `count` nya bord i rad efter `t`, i riktningen `dir` (en enhetsvektor
 * längs planens x eller y), med `gap` mellan borden. Bord som skulle hamna
 * utanför arbetsytan skapas inte.
 */
export function tableRow(
  t: TableElement,
  count: number,
  dir: { x: number; y: number },
  gap: number,
  newId: () => string,
  newLabel: () => string,
): TableElement[] {
  const stepX = dir.x * (t.w + gap)
  const stepY = dir.y * (t.h + gap)
  const out: TableElement[] = []
  for (let i = 1; i <= count; i++) {
    const x = t.x + stepX * i
    const y = t.y + stepY * i
    if (Math.abs(x) > HALF_W - t.w / 2 || Math.abs(y) > HALF_H - t.h / 2) break
    out.push({ ...t, id: newId(), label: newLabel(), x, y })
  }
  return out
}

/* --- Hjälplinjer och snappning ----------------------------------------------- */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** En hjälplinje: lodrät (`axis: 'x'`, vid x = at) eller vågrät. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

/**
 * Figma-liknande snappning: lådans vänsterkant, mitt och högerkant (och
 * överkant/mitt/underkant) dras mot samma linjer hos de andra lådorna och
 * mot väggarna, om de ligger inom `threshold`. Ger förskjutningen och
 * linjerna som ska ritas. Lådor anges med mittpunkt (x, y) och storlek.
 */
export function snapToGuides(
  box: Box,
  others: Box[],
  walls: WallSegment[],
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const mine = (b: Box, axis: 'x' | 'y') =>
    axis === 'x' ? [b.x - b.w / 2, b.x, b.x + b.w / 2] : [b.y - b.h / 2, b.y, b.y + b.h / 2]

  const best = (axis: 'x' | 'y') => {
    let delta = 0
    let dist = threshold
    let hit: { at: number; other: Box | null; wall: WallSegment | null } | null = null
    const consider = (line: number, other: Box | null, wall: WallSegment | null) => {
      for (const m of mine(box, axis)) {
        const d = Math.abs(line - m)
        if (d < dist) {
          dist = d
          delta = line - m
          hit = { at: line, other, wall }
        }
      }
    }
    for (const o of others) for (const line of mine(o, axis)) consider(line, o, null)
    for (const w of walls) {
      if (axis === 'x' && w.dir === 'v') consider(w.x, null, w)
      if (axis === 'y' && w.dir === 'h') consider(w.y, null, w)
    }
    return { delta, hit: hit as { at: number; other: Box | null; wall: WallSegment | null } | null }
  }

  const sx = best('x')
  const sy = best('y')
  const moved = { ...box, x: box.x + sx.delta, y: box.y + sy.delta }

  // Efter snappningen: rita VARJE linje som nu sammanfaller (lika stora
  // bord i rad delar vänsterkant, mitt och högerkant samtidigt - som i Figma).
  const guides: Guide[] = []
  const seen = new Set<string>()
  const add = (axis: 'x' | 'y', at: number, a0: number, a1: number, b0: number, b1: number) => {
    const key = `${axis}:${Math.round(at * 10)}`
    const from = Math.min(a0, b0) - 10
    const to = Math.max(a1, b1) + 10
    const existing = guides.find((g) => `${g.axis}:${Math.round(g.at * 10)}` === key)
    if (existing) {
      existing.from = Math.min(existing.from, from)
      existing.to = Math.max(existing.to, to)
      return
    }
    if (seen.has(key)) return
    seen.add(key)
    guides.push({ axis, at, from, to })
  }
  const close = (a: number, b: number) => Math.abs(a - b) < 0.5
  const myTop = moved.y - moved.h / 2
  const myBottom = moved.y + moved.h / 2
  const myLeft = moved.x - moved.w / 2
  const myRight = moved.x + moved.w / 2
  if (sx.hit) {
    for (const o of others) {
      for (const line of mine(o, 'x')) {
        if (mine(moved, 'x').some((m) => close(m, line))) add('x', line, myTop, myBottom, o.y - o.h / 2, o.y + o.h / 2)
      }
    }
    for (const w of walls) {
      if (w.dir === 'v' && mine(moved, 'x').some((m) => close(m, w.x))) add('x', w.x, myTop, myBottom, w.y, w.y + w.length)
    }
  }
  if (sy.hit) {
    for (const o of others) {
      for (const line of mine(o, 'y')) {
        if (mine(moved, 'y').some((m) => close(m, line))) add('y', line, myLeft, myRight, o.x - o.w / 2, o.x + o.w / 2)
      }
    }
    for (const w of walls) {
      if (w.dir === 'h' && mine(moved, 'y').some((m) => close(m, w.y))) add('y', w.y, myLeft, myRight, w.x, w.x + w.length)
    }
  }
  return { dx: sx.delta, dy: sy.delta, guides }
}

/* --- Mått i meter ------------------------------------------------------------ */

/** Samma skala som layoutApi (UNITS_PER_METER): 50 editorenheter = 1 m. */
export const UNITS_PER_METRE = 50

/** 160 -> "3,2 m" (svensk decimal, en decimal räcker - rutnätet är 0,4 m). */
export function formatMetres(units: number): string {
  return `${(units / UNITS_PER_METRE).toFixed(1).replace('.', ',')} m`
}

/** Bredd × djup: "4,0 × 3,2 m". */
export function formatSize(w: number, h: number): string {
  const m = (u: number) => (u / UNITS_PER_METRE).toFixed(1).replace('.', ',')
  return `${m(w)} × ${m(h)} m`
}

/* --- Klistra in på en viss plats ---------------------------------------------- */

/**
 * Flyttar klippen så att deras gemensamma mittpunkt hamnar på `at` -
 * "Klistra in här" i högerklicksmenyn. Väggar hålls på rutnätet.
 */
export function moveClipsTo(clips: Clip[], at: { x: number; y: number }): Clip[] {
  if (clips.length === 0) return clips
  const centres = clips.map((c) =>
    c.kind === 'table'
      ? { x: c.table.x, y: c.table.y }
      : c.kind === 'fixture'
        ? { x: c.fixture.x, y: c.fixture.y }
        : {
            x: c.wall.x + (c.wall.dir === 'h' ? c.wall.length / 2 : 0),
            y: c.wall.y + (c.wall.dir === 'v' ? c.wall.length / 2 : 0),
          },
  )
  const cx = centres.reduce((a, c) => a + c.x, 0) / centres.length
  const cy = centres.reduce((a, c) => a + c.y, 0) / centres.length
  const dx = Math.round((at.x - cx) / GRID) * GRID
  const dy = Math.round((at.y - cy) / GRID) * GRID
  return clips.map((c) => {
    if (c.kind === 'table') return { ...c, table: { ...c.table, x: c.table.x + dx, y: c.table.y + dy } }
    if (c.kind === 'fixture') return { ...c, fixture: { ...c.fixture, x: c.fixture.x + dx, y: c.fixture.y + dy } }
    return { ...c, wall: { ...c.wall, x: c.wall.x + dx, y: c.wall.y + dy } }
  })
}

/* --- Väggar som en sammanhängande linje ---------------------------------------- */

/**
 * En vägg från (x0, y0) mot pekaren, alltid vågrät eller lodrät (det
 * dominerande hållet), snappad till rutnätet. `x`/`y` är väggens
 * startpunkt (vänster/övre änden) och `end` är änden vid pekaren - där
 * nästa vägg i linjen börjar.
 */
export function wallTowards(
  x0: number,
  y0: number,
  px: number,
  py: number,
): { dir: 'h' | 'v'; x: number; y: number; length: number; end: { x: number; y: number } } {
  const dx = px - x0
  const dy = py - y0
  if (Math.abs(dx) >= Math.abs(dy)) {
    const length = Math.abs(dx)
    return { dir: 'h', x: dx < 0 ? x0 - length : x0, y: y0, length, end: { x: x0 + dx, y: y0 } }
  }
  const length = Math.abs(dy)
  return { dir: 'v', x: x0, y: dy < 0 ? y0 - length : y0, length, end: { x: x0, y: y0 + dy } }
}
