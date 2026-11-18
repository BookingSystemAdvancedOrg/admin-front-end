import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'
import { ConfirmDialog } from './ConfirmDialog'
import { hasUnsaved, requestLeave, setLeaveAsker } from './unsaved'

/**
 * Frågar innan man lämnar en sida med osparade ändringar: länkar i adminen
 * (sidomenyn, telefonens meny, länkar på sidan) och allt som går via
 * requestLeave (⌘K). Byte av gren i Inställningar är samma sida; grenarna
 * ligger kvar dolda med sina ändringar, så där frågas inget.
 */
export function LeaveGuard() {
  const navigate = useNavigate()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const nav = useRef(navigate)
  useEffect(() => {
    nav.current = navigate
  })

  useEffect(() => {
    setLeaveAsker((go) => setPending(() => go))
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      if (!hasUnsaved()) return
      e.preventDefault()
      e.stopPropagation()
      setPending(() => () => nav.current(url.pathname + url.search + url.hash))
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      setLeaveAsker(null)
    }
  }, [])

  if (!pending) return null
  return (
    <ConfirmDialog
      title="Osparade ändringar"
      text="Det du ändrat sparas inte om du lämnar sidan."
      confirmLabel="Lämna utan att spara"
      cancelLabel="Stanna kvar"
      danger
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const go = pending
        setPending(null)
        go()
      }}
    />
  )
}

/** navigate() som frågar först när en annan sida skulle tappa osparade ändringar. */
export function useGuardedNavigate(): (to: string, opts?: NavigateOptions) => void {
  const navigate = useNavigate()
  return useCallback(
    (to: string, opts?: NavigateOptions) => {
      const same = new URL(to, window.location.href).pathname === window.location.pathname
      if (same) navigate(to, opts)
      else requestLeave(() => navigate(to, opts))
    },
    [navigate],
  )
}
