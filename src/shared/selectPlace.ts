/** Rullistans placering (shared/Select.tsx), skild från komponenten så att den kan testas. */

const GAP = 6
const EDGE = 8
const MAX_HEIGHT = 340

export type Place = { top?: number; bottom?: number; left: number; minWidth: number; maxHeight: number; above: boolean }

/** Var listan står: under knappen, ovanför om det saknas plats, alltid inom fönstret. */
export function placeList(anchor: DOMRect, listHeight: number, vw: number, vh: number, listWidth = anchor.width): Place {
  const below = vh - anchor.bottom - GAP - EDGE
  const above = anchor.top - GAP - EDGE
  const want = Math.min(listHeight, MAX_HEIGHT)
  const flip = below < want && above > below
  const room = flip ? above : below
  const width = Math.max(listWidth, anchor.width)
  const left = Math.max(EDGE, Math.min(anchor.left, vw - width - EDGE))
  const maxHeight = Math.max(120, Math.min(MAX_HEIGHT, room))
  return flip
    ? { bottom: vh - anchor.top + GAP, left, minWidth: Math.min(anchor.width, vw - 2 * EDGE), maxHeight, above: true }
    : { top: anchor.bottom + GAP, left, minWidth: Math.min(anchor.width, vw - 2 * EDGE), maxHeight, above: false }
}
