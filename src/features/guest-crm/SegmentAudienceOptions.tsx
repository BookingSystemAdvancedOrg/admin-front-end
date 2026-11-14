import { useEffect, useRef, useState } from 'react'
import { Bar, Field } from '@booqy/brand'
import { BrandSelect as Select } from '../../shared/Select'
import { errorText } from '../../shared/errors'
import { exportSegment, listSegments, newId, type Segment } from './api'
import { ErrorActions } from '../../shared/ErrorNote'

interface Props {
  value: { type: 'segment'; exportId: string } | null
  onChange: (v: { type: 'segment'; exportId: string } | null) => void
}

/**
 * Kampanjens mottagare från en målgrupp: valet gör en låst lista (export) av
 * gäster som just nu prenumererar och har sagt ja. Utskicket kontrollerar
 * samtycket igen för varje mottagare. Byter man fram och tillbaka i listan
 * återanvänds den lista som redan gjorts för målgruppen (ingen ny export
 * per byte).
 */
export default function SegmentAudienceOptions({ value, onChange }: Props) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [chosen, setChosen] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const exports = useRef(new Map<string, { exportId: string; count: number }>())

  useEffect(() => {
    listSegments().then((out) => setSegments(out.segments)).catch(() => setSegments([]))
  }, [])

  async function choose(segmentId: string) {
    setChosen(segmentId)
    setError(null)
    if (!segmentId) {
      setCount(null)
      onChange(null)
      return
    }
    const made = exports.current.get(segmentId)
    if (made) {
      setCount(made.count)
      onChange({ type: 'segment', exportId: made.exportId })
      return
    }
    setBusy(true)
    try {
      const exp = await exportSegment(segmentId, newId())
      exports.current.set(segmentId, { exportId: exp.exportId, count: exp.count })
      setCount(exp.count)
      onChange({ type: 'segment', exportId: exp.exportId })
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta målgruppen.'))
      onChange(null)
    } finally {
      setBusy(false)
    }
  }

  if (segments.length === 0) return null
  return (
    <>
      <Field label="Målgrupp" hint={busy ? 'Räknar gäster…' : value && count !== null ? `${count} gäster kan få utskicket.` : undefined}>
        <Select value={value || busy ? chosen : ''} disabled={busy} onChange={(e) => void choose(e.target.value)}>
          <option value="">Ingen målgrupp</option>
          {segments.map((s) => <option key={s.segmentId} value={s.segmentId}>{s.name}</option>)}
        </Select>
      </Field>
      {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : null}
    </>
  )
}
