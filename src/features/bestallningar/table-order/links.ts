/**
 * Where the table order flow lives (routes in App.tsx, admin-board):
 * /bestallningar/bord/ny[?bord=<tableId>] starts a new order,
 * /bestallningar/bord/<tabId>/lagg-till adds to an open one, and the Bord
 * view in Beställningar is ?vy=bord (&markera=<tabId> highlights a tab).
 */
export function newOrderPath(tableId?: string | null): string {
  return `/bestallningar/bord/ny${tableId ? `?bord=${encodeURIComponent(tableId)}` : ''}`
}

export function addToTabPath(tabId: string): string {
  return `/bestallningar/bord/${encodeURIComponent(tabId)}/lagg-till`
}

export function boardPath(tabId?: string | null): string {
  return `/bestallningar?vy=bord${tabId ? `&markera=${encodeURIComponent(tabId)}` : ''}`
}
