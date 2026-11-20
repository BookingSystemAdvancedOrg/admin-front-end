import { useMemo } from 'react'

/** JSON med sorterade nycklar: samma värden i en annan ordning räknas som lika. */
export function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  )
}

/**
 * Har formuläret ändrats sedan det sparades? `current` är det som står i
 * formuläret nu, `saved` det servern har (null = inte hämtat än, alltså
 * inget att spara). Ändrar man tillbaka till det sparade värdet är formuläret
 * orört igen. SaveBar tar `dirty` och sköter resten (knappen, Ångra
 * ändringar, frågan innan man lämnar sidan).
 */
export function useDirtyForm<T>(current: T, saved: T | null | undefined): boolean {
  const a = stable(current)
  const b = useMemo(() => (saved === null || saved === undefined ? null : stable(saved)), [saved])
  return b !== null && a !== b
}
