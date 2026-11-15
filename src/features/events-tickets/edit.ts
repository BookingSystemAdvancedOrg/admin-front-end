import type { Occurrence, TicketType, VatRate } from './api'

/** Ren logik för att ändra biljettyper och tillfällen (formulär, validering på svenska). */

export const MAX_PLACES = 10000
export const MAX_PRICE_KR = 100000

/** ISO (UTC) -> "YYYY-MM-DDTHH:mm" i webbläsarens tid, för datetime-local. */
export function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toUtc(local: string): string {
  return new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Antal sålda och reserverade (pågående köp): lägsta tillåtna kapacitet. */
export function takenOf(x: { sold: number; held?: number }): number {
  return x.sold + (x.held ?? 0)
}

export function takenText(sold: number, held: number): string {
  return held ? `${sold} sålda och ${held} reserverade i pågående köp` : `${sold} sålda`
}

export interface TypeForm {
  name: string; includes: string; priceKr: string; vatRate: VatRate; perOrderMax: string; capacity: string
  from: string; until: string
}

export function typeForm(t: TicketType): TypeForm {
  return {
    name: t.name, includes: t.includes ?? '', priceKr: String(t.priceOre / 100).replace('.', ','), vatRate: t.vatRate,
    perOrderMax: String(t.perOrderMax), capacity: t.capacity ? String(t.capacity) : '',
    from: toLocalInput(t.tier?.availableFrom), until: toLocalInput(t.tier?.availableUntil),
  }
}

export function priceOre(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

/** Fältfel på svenska; tomt objekt = formuläret går att spara. */
export function validateType(f: TypeForm, t: TicketType): Partial<Record<keyof TypeForm, string>> {
  const errors: Partial<Record<keyof TypeForm, string>> = {}
  if (!f.name.trim()) errors.name = 'Skriv ett namn på biljettypen.'
  else if (f.name.trim().length > 80) errors.name = 'Namnet får vara högst 80 tecken.'
  if (f.includes.trim().length > 300) errors.includes = 'Beskrivningen får vara högst 300 tecken.'
  const price = priceOre(f.priceKr)
  if (price === null) errors.priceKr = 'Skriv priset i kronor, till exempel 495 eller 495,50.'
  else if (price > MAX_PRICE_KR * 100) errors.priceKr = `Priset får vara högst ${MAX_PRICE_KR.toLocaleString('sv-SE')} kr.`
  const per = Number(f.perOrderMax)
  if (!Number.isInteger(per) || per < 1 || per > 20) errors.perOrderMax = 'Max per köp ska vara ett heltal från 1 till 20.'
  if (f.capacity.trim()) {
    const cap = Number(f.capacity)
    const min = Math.max(1, takenOf(t))
    if (!Number.isInteger(cap) || cap < 1) errors.capacity = 'Antalet ska vara ett heltal, minst 1. Lämna tomt för ingen gräns.'
    else if (cap > MAX_PLACES) errors.capacity = `Antalet får vara högst ${MAX_PLACES.toLocaleString('sv-SE')}.`
    else if (cap < min) errors.capacity = `Det finns redan ${takenText(t.sold, t.held)}, så antalet kan inte vara lägre än ${min}.`
    else if (t.tier?.untilSold && Math.min(cap, t.tier.untilSold) < takenOf(t)) errors.capacity = 'Antalet räcker inte till de biljetter som redan är sålda.'
  }
  if (f.from && f.until && new Date(f.from) >= new Date(f.until)) errors.until = 'Försäljningen måste sluta efter att den har börjat.'
  return errors
}

/** Fältfel för ett tillfälles kapacitet; null = går att spara. */
export function validateCapacity(text: string, o: Occurrence): string | null {
  const cap = Number(text)
  const min = Math.max(1, takenOf(o))
  if (!text.trim()) return 'Skriv antalet platser.'
  if (!Number.isInteger(cap) || cap < 1) return 'Antalet platser ska vara ett heltal, minst 1.'
  if (cap > MAX_PLACES) return `Antalet platser får vara högst ${MAX_PLACES.toLocaleString('sv-SE')}.`
  if (cap < min) return `Det finns redan ${takenText(o.sold, o.held)}, så antalet kan inte vara lägre än ${min}.`
  return null
}
