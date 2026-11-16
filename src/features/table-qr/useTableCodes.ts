import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import { listTableCodes } from './tableQrApi'
import type { TableCode } from './tableQrApi'

export type MockTable = { tableId: string; label: string; seats?: number }

/** Namnet på korten: restaurangen, och platsen när restaurangen har flera. */
export function useCardName(): string {
  const state = useTenant()
  const tenant = state.tenant
  const location = currentLocation(state)
  if (!tenant) return ''
  if (tenant.locations.length > 1 && location?.name && location.name !== tenant.name) {
    return `${tenant.name} · ${location.name}`
  }
  return tenant.name
}

/** Alla publicerade bords koder; laddas om när platsen eller `version` ändras. */
export function useTableCodes(locationId: string | null, mockTables: MockTable[], version = 0) {
  const [codes, setCodes] = useState<TableCode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Försök igen i felrutan: hämtar om (live-uppdateringen är av tills första hämtningen lyckats).
  const [attempt, setAttempt] = useState(0)
  const mockKey = JSON.stringify(mockTables)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listTableCodes(locationId, JSON.parse(mockKey) as MockTable[])
      .then((list) => {
        if (cancelled) return
        setCodes(list)
        setError(null)
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta QR-koderna just nu.')))
    return () => {
      cancelled = true
    }
  }, [locationId, mockKey, version, attempt])
  // Levande: bord som läggs till eller koder som byts på en annan enhet syns av sig själva.
  // Har första hämtningen misslyckats (t.ex. offline) försöker den igen av sig själv.
  useLiveRefresh(async () => {
    if (!locationId) return
    setCodes(await listTableCodes(locationId, JSON.parse(mockKey) as MockTable[]))
    setError(null)
  }, { enabled: Boolean(locationId) && (codes !== null || error !== null) })

  const replace = useCallback((next: TableCode) => {
    setCodes((prev) => (prev ?? []).map((c) => (c.tableId === next.tableId ? next : c)))
  }, [])
  const retry = useCallback(() => {
    setError(null)
    setAttempt((n) => n + 1)
  }, [])
  return { codes, error, replace, retry }
}

