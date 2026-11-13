import { apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Bordens QR-koder (manage-order, shared/table_qr.py i application).
 *
 * Varje bord i den GÄLLANDE publicerade planritningen har en egen slumpad
 * kod (inget bord-id i den). Koden står kvar när bordet byter namn eller
 * flyttas; bordets namn läses från planritningen när gästen skannar. Ett
 * bord som tas bort slutar ta emot beställningar, och ett nytt bord får en
 * ny kod även om det får samma nummer. "Ny kod" gör den gamla ogiltig direkt
 * (stulen eller sliten dekal).
 */

export interface TableCode {
  tableId: string
  label: string
  /** "Bord 7" för "7", annars bordets namn. */
  title: string
  seats: number
  code: string
  /** Adressen i QR-koden; null = restaurangen saknar webbadress än. */
  url: string | null
}

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/orders/table-codes`
}

export function tableTitle(label: string): string {
  return /^\d/.test(label) ? `Bord ${label}` : label
}

/* Utan API (lokal utveckling): påhittade koder för borden som skickas in. */
const mockCodes = new Map<string, string>()
function mockCode(tableId: string): string {
  if (!mockCodes.has(tableId)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    mockCodes.set(tableId, btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22))
  }
  return mockCodes.get(tableId) as string
}
function mockView(t: { tableId: string; label: string; seats?: number }): TableCode {
  const code = mockCode(t.tableId)
  return {
    tableId: t.tableId,
    label: t.label,
    title: tableTitle(t.label),
    seats: t.seats ?? 0,
    code,
    url: `https://demo.dev.booqy.se/bestall?bord=${code}`,
  }
}

/**
 * Koderna för alla publicerade bord (skapas första gången). `mockTables`
 * används bara utan API.
 */
export async function listTableCodes(
  locationId: string,
  mockTables: { tableId: string; label: string; seats?: number }[] = [],
): Promise<TableCode[]> {
  if (!isApiConfigured()) return mockTables.map(mockView)
  const body = await apiFetch<{ tables: TableCode[] }>(base(locationId))
  return body.tables
}

export async function regenerateTableCode(locationId: string, table: TableCode): Promise<TableCode> {
  if (!isApiConfigured()) {
    mockCodes.delete(table.tableId)
    return mockView(table)
  }
  return apiFetch<TableCode>(`${base(locationId)}/${encodeURIComponent(table.tableId)}/regenerate`, { method: 'POST' })
}
