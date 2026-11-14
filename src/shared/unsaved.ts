import { useEffect, useId, useRef } from 'react'

/**
 * Osparade ändringar i hela adminen. En sida med ett osparat utkast
 * registrerar sig med useUnsavedGuard, och uppdateringsrutan frågar då
 * innan den laddar om ("Du har osparade ändringar"). Ingen beforeunload här:
 * vanliga omladdningar och stängningar beter sig som förut.
 */

const guards = new Map<string, () => boolean>()

/** Har någon sida osparade ändringar just nu? */
export function hasUnsaved(): boolean {
  for (const dirty of guards.values()) if (dirty()) return true
  return false
}

/**
 * `dirty` är ett värde eller en funktion som läses först när någon frågar
 * (bra för en editor där jämförelsen kostar, eller där läget ligger i en ref).
 */
export function useUnsavedGuard(dirty: boolean | (() => boolean)): void {
  const id = useId()
  const latest = useRef(dirty)
  useEffect(() => {
    latest.current = dirty
  })
  useEffect(() => {
    guards.set(id, () => {
      const d = latest.current
      return typeof d === 'function' ? d() : d
    })
    return () => {
      guards.delete(id)
    }
  }, [id])
}
