import { useEffect, useRef, useState } from 'react'
import ModalOverlay from '../../shared/ModalOverlay'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'
import { getSimulatedPaper } from '../bestallningar/printApi'
import type { Printer, SimPaper, SimTicket } from '../bestallningar/printApi'
import { KIND_ICON, KIND_LABEL, kindOf } from './kinds'
import './printers.css'

/**
 * Den simulerade skrivaren (bara i dev): bongarna den "skrivit ut", som
 * riktiga lappar ur en springa: vitt papper, rivkant och maskinstil, nyast
 * överst. Hämtas om var tredje sekund medan den är öppen; en ny lapp matas
 * ut med en kort animation (ingen vid minska rörelse).
 */
export function SimPaperDialog({ locationId, printer, onClose }: { locationId: string; printer: Printer; onClose: () => void }) {
  const [paper, setPaper] = useState<SimPaper | null>(null)
  const [failed, setFailed] = useState(false)
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    const load = () =>
      getSimulatedPaper(locationId, printer.deviceId)
        .then((p) => {
          if (!alive) return
          const ids = p.tickets.map((t) => t.jobId)
          if (seen.current) setFresh(new Set(ids.filter((id) => !seen.current!.has(id))))
          seen.current = new Set(ids)
          setPaper(p)
          setFailed(false)
        })
        .catch(() => alive && setFailed(true))
    void load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [locationId, printer.deviceId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const kind = kindOf(printer)
  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sim-paper" role="dialog" aria-modal="true" aria-label={`Simulerad skrivare ${printer.name}`}
        onPointerDown={(e) => e.stopPropagation()}>
        <div className="sim-head">
          <span className={`pset-icon pset-icon--${kind}`} aria-hidden="true"><Icon name={KIND_ICON[kind]} size={22} /></span>
          <span className="pset-name">
            <span className="pset-kind">Simulerad skrivare</span>
            <strong>{KIND_LABEL[kind]} · {printer.name}</strong>
          </span>
          <button type="button" className="btn outline square sim-close" aria-label="Stäng" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sim-rail" aria-hidden="true" />
        <div className="sim-feed">
          {failed && !paper ? (
            <ErrorNote text={booqyFaultText('Papperet kunde inte visas.')} />
          ) : !paper ? (
            <Loading label="Hämtar bongar" />
          ) : paper.tickets.length === 0 ? (
            <p className="sim-empty">Tomt. Tryck Testutskrift.</p>
          ) : (
            paper.tickets.map((t) => <Slip key={t.jobId} ticket={t} narrow={paper.paperWidth === 58} fresh={fresh.has(t.jobId)} />)
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}

function Slip({ ticket, narrow, fresh }: { ticket: SimTicket; narrow: boolean; fresh: boolean }) {
  return (
    <article className={`sim-slip${narrow ? ' sim-slip--58' : ''}${fresh ? ' is-fresh' : ''}${ticket.kind === 'cancel' ? ' sim-slip--void' : ''}`}
      aria-label={ticket.kind === 'test' ? 'Testutskrift' : ticket.kind === 'cancel' ? 'Makulerad' : 'Bong'}>
      {ticket.lines.map((row, i) => (
        <p key={i} className={`sim-row${row.bold ? ' is-bold' : ''}${row.big ? ' is-big' : ''}${row.center ? ' is-center' : ''}`}>
          {row.text || ' '}
        </p>
      ))}
    </article>
  )
}
