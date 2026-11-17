import type { IconName } from '../../shared/Icon'
import type { Printer, PrinterKind, Station, TicketRouting } from '../bestallningar/printApi'
import { NO_TICKET } from '../bestallningar/printApi'

/**
 * Skrivarnas sorter: Kök (maten), Dryck (baren) och Annat (en egen station,
 * till exempel pizzaugnen). Samma regler som servern (shared/routing.py i
 * application): station "kok" skriver på Kök-skrivarna, "bar" på
 * Dryck-skrivarna (finns bara en sort skriver den båda), och varje
 * Annat-skrivare har en egen station med sitt namn.
 */

export const KINDS: PrinterKind[] = ['kok', 'dryck', 'annat']

export const KIND_LABEL: Record<PrinterKind, string> = { kok: 'Kök', dryck: 'Dryck', annat: 'Annat' }

export const KIND_ICON: Record<PrinterKind, IconName> = { kok: 'tool-kitchen', dryck: 'glass', annat: 'flame' }

/** Förslag på namn när en ny skrivare läggs till: "Kök 1", "Bar", "Station 1". */
export function suggestName(kind: PrinterKind, printers: Printer[]): string {
  const base = kind === 'kok' ? 'Kök' : kind === 'dryck' ? 'Bar' : 'Station'
  const taken = new Set(printers.map((p) => p.name.trim().toLowerCase()))
  if (kind === 'dryck' && !taken.has('bar')) return 'Bar'
  for (let n = 1; n < 100; n += 1) {
    const name = `${base} ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
  return base
}

export function kindOf(printer: Pick<Printer, 'kind'>): PrinterKind {
  return printer.kind ?? 'kok'
}

/** "Kök · Kök 1": sorten först, så att det alltid syns vad skrivaren är till för. */
export function printerLabel(printer: Pick<Printer, 'kind' | 'name'>): string {
  return `${KIND_LABEL[kindOf(printer)]} · ${printer.name}`
}

export function stationKind(station: Pick<Station, 'stationId' | 'kind'>): PrinterKind {
  if (station.kind) return station.kind
  return station.stationId === 'kok' ? 'kok' : station.stationId === 'bar' ? 'dryck' : 'annat'
}

/** Kategorier som låter som dryck (för förslaget på en ny kategori). */
const DRINKISH = /dryck|drink|bar\b|öl|vin\b|viner|wine|beer|cocktail|läsk|kaffe|coffee|\bte\b|juice|alkohol|sprit|cider|dricka|smoothie|shot|mocktail|lemonad/i

export function soundsLikeDrinks(name: string): boolean {
  return DRINKISH.test(name)
}

/**
 * Stationen en kategori går till: ägarens val, annars Dryck för drycker
 * och Kök för resten (som servern). null = ingen bong. En ny kategori som
 * låter som dryck ("Öl", "Vin") får Dryck sparat när den läggs till
 * (MenyPage) och när en skrivare läggs till (PrinterTiles).
 */
export function categoryStation(
  routing: Pick<TicketRouting, 'stations' | 'categories'>,
  categoryId: string,
): string | null {
  const ids = routing.stations.map((s) => s.stationId ?? '')
  const chosen = routing.categories[categoryId]
  if (chosen === NO_TICKET) return null
  if (chosen && ids.includes(chosen)) return chosen
  const fallback = categoryId === 'drinks' ? 'bar' : 'kok'
  if (ids.includes(fallback)) return fallback
  return ids[0] ?? null
}

/** Rättens station: rättens eget val, annars kategorins. null = ingen bong. */
export function dishStation(
  routing: Pick<TicketRouting, 'stations' | 'categories'>,
  own: string | null | undefined,
  categoryId: string,
  alcohol = false,
): string | null {
  if (own === NO_TICKET) return null
  const ids = routing.stations.map((s) => s.stationId ?? '')
  if (own && ids.includes(own)) return own
  if (alcohol && !routing.categories[categoryId] && ids.includes('bar')) return 'bar'
  return categoryStation(routing, categoryId)
}

/** Det som visas på en vald station: sorten och skrivarnas namn ("Kök · Kök 1, Kök 2"). */
export function stationLabel(station: Station): string {
  const kind = stationKind(station)
  if (kind === 'annat') return `${KIND_LABEL.annat} · ${station.name}`
  return KIND_LABEL[kind]
}

export function stationPrinters(station: Station, printers: Printer[] = []): string[] {
  if (station.printerNames) return station.printerNames
  return station.printerIds
    .map((id) => printers.find((p) => p.deviceId === id)?.name)
    .filter((n): n is string => Boolean(n))
}
