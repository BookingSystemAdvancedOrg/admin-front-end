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
  }, [locationId, mockKey, version])

  const replace = useCallback((next: TableCode) => {
    setCodes((prev) => (prev ?? []).map((c) => (c.tableId === next.tableId ? next : c)))
  }, [])
  return { codes, error, replace }
}

