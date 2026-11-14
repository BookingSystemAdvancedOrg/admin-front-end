import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, Button, Card, Field, Input, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { menuImageUrl } from '../meny/menuApi'
import {
  CHANNEL_LABEL,
  ERRORS,
  FAILED_LABEL,
  STATUS_LABEL,
  cancelPost,
  deletePost,
  listPosts,
  schedulePost,
  toUtc,
  updatePost,
  type Channel,
  type Listing,
  type Post,
} from './api'
import './inlagg.css'

/** Marknadsföring > Inlägg: utkast från menyn, förhandsvisning, publicera nu, schemalägg, avbryt. */
export default function InlaggTab() {
  const [params] = useSearchParams()
  const [listing, setListing] = useState<Listing | null>(null)
  const [openId, setOpenId] = useState<string | null>(params.get('inlagg'))
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setListing(await listPosts())
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta inläggen.', ERRORS))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => setListing(await listPosts()))

  // Medan något publiceras: fråga igen tills det är klart.
  useEffect(() => {
    if (!listing?.posts.some((p) => p.status === 'publishing' || (p.status === 'scheduled' && !p.scheduledAt))) return
    const timer = window.setTimeout(() => void load(), 4000)
    return () => window.clearTimeout(timer)
  }, [listing, load])

  if (error) return <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng">{error}</Bar>
  if (!listing) return <p className="cell-muted">Hämtar…</p>
  const notConnected = !listing.connection.page

  const open = listing.posts.find((p) => p.postId === openId) ?? null
  return (
    <>
      {notConnected ? (
        <Bar variant="banner" tone="warning" action={<Link className="card-link" to="/marknadsforing?flik=annonser">Koppla Facebook och Instagram</Link>}>
          Koppla restaurangens Facebooksida och Instagramkonto för att publicera inlägg. Instagram måste vara ett
          företagskonto kopplat till sidan.
        </Bar>
      ) : null}
      {open ? (
        <Editor post={open} listing={listing} onClose={() => setOpenId(null)}
          onChanged={(next) => setListing({ ...listing, posts: listing.posts.map((p) => (p.postId === next.postId ? next : p)) })}
          onDeleted={() => { setOpenId(null); void load() }} />
      ) : null}
      <Card title="Inlägg">
        {listing.posts.length === 0 ? (
          <p className="admin-empty">Inga inlägg än. Tryck på Dela vid en rätt under Meny för att göra ett utkast.</p>
        ) : (
          <ul className="inlagg-list">
            {listing.posts.map((p) => (
              <li key={p.postId}>
                <button type="button" className="inlagg-row" onClick={() => setOpenId(p.postId)} aria-current={p.postId === openId}>
                  <span className="inlagg-caption">{p.caption.split('\n')[0]}</span>
                  <span className="status-badge">{STATUS_LABEL[p.status]}</span>
                  {p.scheduledAt && p.status === 'scheduled' ? <span className="cell-muted">{new Date(p.scheduledAt).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function Editor({ post, listing, onClose, onChanged, onDeleted }: {
  post: Post; listing: Listing; onClose: () => void; onChanged: (p: Post) => void; onDeleted: () => void
}) {
  const [caption, setCaption] = useState(post.caption)
  const [channels, setChannels] = useState<Channel[]>(Object.keys(post.channels) as Channel[])
  const [when, setWhen] = useState('')
  const [alcohol, setAlcohol] = useState(Boolean(post.alcoholConfirmed))
  const [busy, setBusy] = useState<string | null>(null)
  const editable = post.status === 'draft' || post.status === 'scheduled'
  const image = menuImageUrl(post.imageKey)

  async function run(name: string, fn: () => Promise<Post | void>, ok?: string) {
    setBusy(name)
    try {
      const next = await fn()
      if (next) onChanged(next)
      if (ok) toast(ok, { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Det gick inte.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  async function saved(): Promise<Post> {
    const dirty = caption !== post.caption || channels.join() !== Object.keys(post.channels).join()
      || alcohol !== Boolean(post.alcoholConfirmed)
    return dirty && editable ? updatePost(post, { caption, channels, alcoholConfirmed: alcohol }) : post
  }

  function toggle(c: Channel) {
    setChannels((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))
  }

  return (
    <Card title="Inlägg" actions={<Button size="sm" variant="ghost" onClick={onClose}>Stäng</Button>}>
      <div className="inlagg-editor">
        <div className="inlagg-form">
          <Field label="Text" hint="Priset i texten ska vara hela priset med moms." required>
            <textarea className="inlagg-text" rows={6} maxLength={2000} value={caption} disabled={!editable}
              onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <fieldset className="inlagg-checks">
            <legend>Publicera på</legend>
            {(['facebook', 'instagram'] as Channel[]).map((c) => (
              <label key={c}>
                <input type="checkbox" checked={channels.includes(c)} disabled={!editable || (c === 'instagram' && !listing.connection.instagram)}
                  onChange={() => toggle(c)} />
                {CHANNEL_LABEL[c]}
              </label>
            ))}
          </fieldset>
          <label className="inlagg-confirm">
            <input type="checkbox" checked={alcohol} disabled={!editable} onChange={(e) => setAlcohol(e.target.checked)} />
            Inlägget handlar om alkohol och är återhållsamt, riktar sig inte till personer under 25 år och följer alkohollagen.
          </label>
          <Field label="Schemalägg till">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          {Object.entries(post.channels).map(([c, s]) => (s?.state === 'failed' || s?.state === 'needs_check') ? (
            <p key={c} className="inlagg-warn">
              {CHANNEL_LABEL[c as Channel]}: {s.state === 'needs_check' ? 'Vi kontrollerar om inlägget redan kom ut innan vi försöker igen.'
                : FAILED_LABEL[s.lastError?.code ?? ''] ?? 'Kunde inte publiceras.'}
            </p>
          ) : null)}
          <Bar variant="action" label="Inlägg">
            {post.status === 'draft' ? (
              <Button variant="danger" busy={busy === 'delete'} onClick={() => void run('delete', async () => { await deletePost(post); onDeleted() })}>Ta bort</Button>
            ) : null}
            {post.status === 'scheduled' ? (
              <Button variant="secondary" busy={busy === 'cancel'} onClick={() => void run('cancel', () => cancelPost(post), 'Avbrutet.')}>Avbryt</Button>
            ) : null}
            <Button variant="secondary" disabled={!when || !channels.length} busy={busy === 'schedule'}
              onClick={() => void run('schedule', async () => schedulePost(await saved(), { scheduledAt: toUtc(when) }), 'Schemalagt.')}>
              Schemalägg
            </Button>
            <Button disabled={!channels.length || post.status === 'published'} busy={busy === 'now'} busyLabel="Publicerar…"
              onClick={() => void run('now', async () => schedulePost(await saved(), { now: true }), 'Publiceras nu.')}>
              Publicera nu
            </Button>
          </Bar>
        </div>
        <div className="inlagg-previews" aria-label="Förhandsvisning">
          {channels.map((c) => (
            <Card key={c} title={CHANNEL_LABEL[c]} level={3} surface="paper">
              {image ? <img className="inlagg-image" src={image} alt="" /> : null}
              <p className="inlagg-preview-text">{caption}</p>
              {post.channels[c]?.permalink ? <a className="card-link" href={post.channels[c]!.permalink} target="_blank" rel="noreferrer">Visa inlägget</a> : null}
            </Card>
          ))}
        </div>
      </div>
    </Card>
  )
}
