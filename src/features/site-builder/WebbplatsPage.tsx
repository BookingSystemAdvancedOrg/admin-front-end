import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Modal, Select, toast } from '@booqy/brand'
import { ApiError } from '../../shared/api'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import { listMenuItems, type MenuItem } from '../meny/menuApi'
import {
  BLOCK_FIELDS,
  BLOCK_LABEL,
  ERRORS,
  FIELD_LABEL,
  FIELD_MAX,
  blockId,
  createPreviewLink,
  getSite,
  listVersions,
  locate,
  moveBlock,
  newId,
  publish,
  publishStatus,
  rollback,
  saveDraft,
  slugify,
  type Block,
  type BlockType,
  type SiteDoc,
  type SiteState,
  type Version,
} from './api'

const POLL_MS = 2000

/** Webbplats (planfunktionen "siteBuilder", bara ägare): Utkast och Publicerad. */
export default function WebbplatsPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.siteBuilder)
  const owner = tenant?.role === 'owner_user'

  return (
    <>
      <AdminTopbar title="Webbplats" />
      <main className="admin-main">
        {enabled && owner ? <Editor /> : (
          <section className="admin-card table-card">
            <h2 className="card-title">{enabled ? 'Bara för ägare' : 'Ingår inte i er plan'}</h2>
            <p className="cell-muted">
              {enabled ? 'Webbplatsen ändras av restaurangens ägare.' : 'Webbplatsbyggaren ingår inte i er plan. Kontakta oss för att uppgradera.'}
            </p>
          </section>
        )}
      </main>
    </>
  )
}

function Editor() {
  const state = useTenant()
  const location = currentLocation(state)
  const [site, setSite] = useState<SiteState | null>(null)
  const [doc, setDoc] = useState<SiteDoc | null>(null)
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [error, setError] = useState<{ text: string; page?: number; block?: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [width, setWidth] = useState<'mobile' | 'desktop'>('mobile')
  const [images, setImages] = useState<MenuItem[]>([])
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await getSite()
      setSite(s)
      setDoc(s.draft.doc)
      setVersion(s.draft.version)
      setDirty(false)
    } catch (err) {
      setError({ text: errorText(err, 'Kunde inte hämta webbplatsen.', ERRORS) })
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (location) listMenuItems(location.locationId).then((items) => setImages(items.filter((i) => i.imageKey))).catch(() => setImages([]))
  }, [location])

  function change(next: SiteDoc) {
    setDoc(next)
    setDirty(true)
  }

  function fail(err: unknown, action: string) {
    const field = err instanceof ApiError ? err.field : undefined
    setError({ text: errorText(err, action, ERRORS), ...locate(field) })
    const at = locate(field)
    if (at.page !== undefined) setPageIndex(at.page)
  }

  async function save(): Promise<number | null> {
    if (!doc) return null
    setSaving(true)
    setError(null)
    try {
      const saved = await saveDraft(doc, version)
      setVersion(saved.version)
      setDirty(false)
      return saved.version
    } catch (err) {
      fail(err, 'Kunde inte spara.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function preview(share: boolean) {
    if (dirty && (await save()) === null) return
    try {
      const link = await createPreviewLink()
      if (share) {
        setShareUrl(link.url)
        await navigator.clipboard?.writeText(link.url).catch(() => undefined)
      } else {
        window.open(link.url, '_blank', 'noopener')
      }
    } catch (err) {
      fail(err, 'Kunde inte skapa förhandsvisningen.')
    }
  }

  async function doPublish() {
    const draftVersion = dirty ? await save() : version
    if (draftVersion === null) return
    setPublishing(true)
    setError(null)
    const publishId = newId()
    try {
      await publish(publishId, draftVersion)
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        const s = await publishStatus(publishId)
        if (s.status === 'done') {
          toast(`Webbplatsen är publicerad (version ${s.versionNo}).`, { tone: 'success' })
          await load()
          break
        }
        if (s.status === 'failed') {
          setError({ text: ERRORS[s.error?.code ?? ''] ?? 'Publiceringen misslyckades. Försök igen.', ...locate(s.error?.field) })
          break
        }
      }
    } catch (err) {
      fail(err, 'Kunde inte publicera.')
    } finally {
      setPublishing(false)
    }
  }

  if (!doc || !site) {
    return error ? <Bar variant="banner" tone="danger">{error.text}</Bar> : <p className="cell-muted">Hämtar webbplatsen…</p>
  }
  if (site.mode === 'custom') {
    return <Card title="Webbplats"><p>Er webbplats byggs av Booqy. Kontakta oss om ni vill ändra något.</p></Card>
  }

  const page = doc.pages[Math.min(pageIndex, doc.pages.length - 1)]
  const setPage = (patch: Partial<typeof page>) =>
    change({ ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? { ...p, ...patch } : p)) })
  const setBlocks = (blocks: Block[]) => setPage({ blocks })

  function addPage() {
    if (!doc) return
    const title = `Sida ${doc.pages.length + 1}`
    let slug = slugify(title)
    while (doc.pages.some((p) => p.slug === slug)) slug = `${slug}-1`
    const id = slug
    change({
      ...doc,
      pages: [...doc.pages, { id, slug, title, seo: { title, description: '' }, blocks: [] }],
      nav: [...doc.nav, { pageId: id }],
    })
    setPageIndex(doc.pages.length)
  }

  function removePage() {
    if (!doc || !page.slug) return
    change({ ...doc, pages: doc.pages.filter((p) => p.id !== page.id), nav: doc.nav.filter((n) => n.pageId !== page.id) })
    setPageIndex(0)
  }

  function addBlock(type: BlockType) {
    const block: Block = { id: blockId(type, page.blocks), type }
    if (type === 'hero') block.heading = page.title
    if (type === 'text') block.body = ''
    if (type === 'image') { block.image = images[0]?.imageKey ?? ''; block.alt = '' }
    if (type === 'gallery') block.images = images.slice(0, 3).map((i) => ({ image: i.imageKey, alt: i.name }))
    setBlocks([...page.blocks, block])
  }

  const status = site.published
    ? `Publicerad: version ${site.published.versionNo}${dirty || version !== (site.draft.version) ? ' · Utkast har ändringar' : ''}`
    : 'Utkast · inte publicerad än'

  return (
    <>
      <Card title="Webbplats" actions={
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => setVersionsOpen(true)}>Versioner</Button>
          <Button size="sm" variant="secondary" onClick={() => void preview(false)}>Förhandsgranska</Button>
          <Button size="sm" variant="secondary" onClick={() => void preview(true)}>Dela förhandsvisning</Button>
          <Button size="sm" busy={publishing} busyLabel="Publicerar…" onClick={() => void doPublish()}>Publicera</Button>
        </div>
      }>
        <p className="cell-muted" aria-live="polite">{status}</p>
        {shareUrl ? (
          <Bar variant="banner" tone="info" onDismiss={() => setShareUrl(null)} dismissLabel="Stäng">
            Länken är kopierad och fungerar i 7 dagar: {shareUrl}
          </Bar>
        ) : null}
        {error ? <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng">{error.text}</Bar> : null}
        <Bar variant="tab" label="Sidor" value={page.id} onChange={(key) => setPageIndex(doc.pages.findIndex((p) => p.id === key))}
          items={doc.pages.map((p) => ({ key: p.id, label: p.title || 'Startsida' }))} />
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={addPage} disabled={doc.pages.length >= 20}>Ny sida</Button>
          {page.slug ? <Button size="sm" variant="danger" onClick={removePage}>Ta bort sidan</Button> : null}
        </div>
      </Card>

      <div className="oversikt-row">
        <Card title={page.title || 'Startsida'} level={3}>
          <div className="form-grid">
            <Field label="Sidans namn">
              <Input value={page.title} maxLength={80} onChange={(e) => setPage({ title: e.target.value })} />
            </Field>
            <Field label="Rubrik i sökmotorer">
              <Input value={page.seo.title} maxLength={70} onChange={(e) => setPage({ seo: { ...page.seo, title: e.target.value } })} />
            </Field>
            <Field label="Beskrivning i sökmotorer">
              <Input value={page.seo.description} maxLength={160} onChange={(e) => setPage({ seo: { ...page.seo, description: e.target.value } })} />
            </Field>
          </div>
          <ol className="today-list" aria-label="Block på sidan">
            {page.blocks.map((block, i) => (
              <li key={block.id} className="settings-row">
                <BlockEditor
                  block={block}
                  images={images}
                  pages={doc.pages.map((p) => ({ id: p.id, title: p.title }))}
                  invalid={error?.page === pageIndex && error.block === i}
                  onChange={(b) => setBlocks(page.blocks.map((x, j) => (j === i ? b : x)))}
                />
                <div className="row-actions">
                  <Button size="sm" variant="ghost" aria-label={`Flytta upp ${BLOCK_LABEL[block.type]}`} disabled={i === 0}
                    onClick={() => setBlocks(moveBlock(page.blocks, i, -1))}>Upp</Button>
                  <Button size="sm" variant="ghost" aria-label={`Flytta ner ${BLOCK_LABEL[block.type]}`} disabled={i === page.blocks.length - 1}
                    onClick={() => setBlocks(moveBlock(page.blocks, i, 1))}>Ner</Button>
                  <Button size="sm" variant="danger" aria-label={`Ta bort ${BLOCK_LABEL[block.type]}`}
                    onClick={() => setBlocks(page.blocks.filter((_, j) => j !== i))}>Ta bort</Button>
                </div>
              </li>
            ))}
          </ol>
          <Field label="Lägg till block">
            <Select value="" disabled={page.blocks.length >= 40} onChange={(e) => e.target.value && addBlock(e.target.value as BlockType)}>
              <option value="">Välj…</option>
              {(Object.keys(BLOCK_LABEL) as BlockType[]).map((t) => <option key={t} value={t}>{BLOCK_LABEL[t]}</option>)}
            </Select>
          </Field>
        </Card>

        <Card title="Utseende" level={3}>
          <div className="form-grid">
            <Field label="Huvudfärg">
              <Input type="color" value={doc.theme.primaryColor} onChange={(e) => change({ ...doc, theme: { ...doc.theme, primaryColor: e.target.value } })} />
            </Field>
            <Field label="Accentfärg" hint="Knappar och länkar. Booqy justerar färgen så att texten alltid går att läsa.">
              <Input type="color" value={doc.theme.accentColor} onChange={(e) => change({ ...doc, theme: { ...doc.theme, accentColor: e.target.value } })} />
            </Field>
            <Field label="Typsnitt">
              <Select value={doc.theme.font} onChange={(e) => change({ ...doc, theme: { ...doc.theme, font: e.target.value as 'serif' | 'sans' } })}>
                <option value="serif">Klassiskt (serif)</option>
                <option value="sans">Modernt (sans)</option>
              </Select>
            </Field>
            <Field label="Sidfot">
              <Input value={doc.footer.text} maxLength={300} onChange={(e) => change({ ...doc, footer: { text: e.target.value } })} />
            </Field>
          </div>
          <Bar variant="tab" kind="track" label="Bredd" value={width} onChange={(k) => setWidth(k as 'mobile' | 'desktop')}
            items={[{ key: 'mobile', label: 'Mobil' }, { key: 'desktop', label: 'Dator' }]} />
          <Outline doc={doc} pageIndex={pageIndex} width={width} />
          <p className="field-hint">Förhandsgranska visar sidan precis som gästerna ser den.</p>
        </Card>
      </div>

      <Bar variant="action" sticky label="Spara utkast" status={dirty ? 'Osparade ändringar' : 'Sparat'}>
        <Button busy={saving} busyLabel="Sparar…" disabled={!dirty} onClick={() => void save()}>Spara utkast</Button>
      </Bar>

      {versionsOpen ? <Versions onClose={() => setVersionsOpen(false)} onRestored={() => { setVersionsOpen(false); void load() }} /> : null}
    </>
  )
}

function BlockEditor({ block, images, pages, invalid, onChange }: {
  block: Block
  images: MenuItem[]
  pages: { id: string; title: string }[]
  invalid: boolean
  onChange: (b: Block) => void
}) {
  const fields = BLOCK_FIELDS[block.type]
  return (
    <fieldset className="form-grid" aria-invalid={invalid || undefined}>
      <legend className="form-section-label">{BLOCK_LABEL[block.type]}{invalid ? ' (kontrollera)' : ''}</legend>
      {fields.map((f) => (
        <Field key={f} label={FIELD_LABEL[f]} error={invalid ? 'Kontrollera det här blocket.' : undefined}>
          {f === 'body' ? (
            <textarea className="bq-input" maxLength={FIELD_MAX[f]} value={block[f] ?? ''} onChange={(e) => onChange({ ...block, [f]: e.target.value })} />
          ) : (
            <Input value={block[f] ?? ''} maxLength={FIELD_MAX[f]} onChange={(e) => onChange({ ...block, [f]: e.target.value || undefined })} />
          )}
        </Field>
      ))}
      {block.type === 'image' ? (
        <Field label="Bild" hint={images.length ? undefined : 'Ladda upp bilder på rätter under Meny först.'}>
          <Select value={block.image ?? ''} onChange={(e) => onChange({ ...block, image: e.target.value })}>
            {images.map((i) => <option key={i.menuItemId} value={i.imageKey}>{i.name}</option>)}
          </Select>
        </Field>
      ) : null}
      {block.type === 'hero' ? (
        <Field label="Knapp till sida">
          <Select value={block.cta?.link ?? ''} onChange={(e) => onChange({
            ...block, cta: e.target.value ? { label: block.cta?.label || 'Läs mer', link: e.target.value } : undefined,
          })}>
            <option value="">Ingen knapp</option>
            {pages.map((p) => <option key={p.id} value={`page:${p.id}`}>{p.title}</option>)}
          </Select>
        </Field>
      ) : null}
      {block.type === 'contact' ? (
        <label className="toggle-row">
          <input type="checkbox" className="switch" checked={Boolean(block.showMap)} onChange={(e) => onChange({ ...block, showMap: e.target.checked })} />
          <span className="toggle-row-label">Visa karta</span>
        </label>
      ) : null}
    </fieldset>
  )
}

/** Sidans uppbyggnad i vald bredd: block för block, i ordning. */
function Outline({ doc, pageIndex, width }: { doc: SiteDoc; pageIndex: number; width: 'mobile' | 'desktop' }) {
  const page = doc.pages[pageIndex]
  if (!page) return null
  return (
    <div className={`view-toggle ${width === 'mobile' ? 'compact-select' : ''}`} aria-label={`Sidan i ${width === 'mobile' ? 'mobil' : 'dator'}`}>
      <nav aria-label="Webbplatsens meny"><p className="cell-muted">{doc.nav.map((n) => doc.pages.find((p) => p.id === n.pageId)?.title).filter(Boolean).join(' · ')}</p></nav>
      {page.blocks.length === 0 ? <p className="cell-muted">Sidan är tom.</p> : page.blocks.map((b) => (
        <section key={b.id} className="admin-card">
          <p className="form-section-label">{BLOCK_LABEL[b.type]}</p>
          {b.heading ? <h4>{b.heading}</h4> : null}
          {b.text || b.body ? <p>{b.text ?? b.body}</p> : null}
          {b.label || b.cta ? <span className="status-badge">{b.label ?? b.cta?.label}</span> : null}
        </section>
      ))}
      <p className="cell-muted">{doc.footer.text}</p>
    </div>
  )
}

function Versions({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    listVersions().then((v) => setVersions(v.versions)).catch(() => setVersions([]))
  }, [])

  async function restore(v: Version) {
    setBusy(v.versionNo)
    try {
      const publishId = newId()
      const started = await rollback(publishId, v.versionNo)
      if (started.status !== 'done') {
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          const s = await publishStatus(publishId)
          if (s.status === 'done') break
          if (s.status === 'failed') throw new Error('Återställningen misslyckades. Försök igen.')
        }
      }
      toast(`Version ${v.versionNo} är publicerad igen.`, { tone: 'success' })
      onRestored()
    } catch (err) {
      toast(errorText(err, 'Kunde inte återställa.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open title="Versioner" onClose={onClose} closeLabel="Stäng">
      {versions === null ? <p className="cell-muted">Hämtar…</p> : null}
      {versions && versions.length === 0 ? <p className="admin-empty">Inget är publicerat än.</p> : null}
      {versions && versions.length > 0 ? (
        <ul className="today-list">
          {versions.map((v) => (
            <li key={v.versionNo} className="settings-row">
              <span>Version {v.versionNo} · {new Date(v.publishedAt).toLocaleString('sv-SE')}{v.live ? ' · visas nu' : ''}</span>
              {!v.live ? <Button size="sm" variant="secondary" busy={busy === v.versionNo} onClick={() => void restore(v)}>Återställ</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
