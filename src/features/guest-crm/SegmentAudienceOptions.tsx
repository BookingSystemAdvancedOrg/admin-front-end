import { useEffect, useState } from 'react'
import { Bar, Field, Select } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { exportSegment, listSegments, newId, type Segment } from './api'

interface Props {
  value: { type: 'segment'; exportId: string } | null
  onChange: (v: { type: 'segment'; exportId: string } | null) => void
}

/**
 * Kampanjens mottagare från en målgrupp: valet gör en låst lista (export) av
 * gäster som just nu prenumererar och har sagt ja. Utskicket kontrollerar
 * samtycket igen för varje mottagare.
 */
export default function SegmentAudienceOptions({ value, onChange }: Props) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [chosen, setChosen] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setBusy(true)
    try {
      const exp = await exportSegment(segmentId, newId())
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
      {error ? <Bar variant="banner" tone="danger">{error}</Bar> : null}
    </>
  )
}
