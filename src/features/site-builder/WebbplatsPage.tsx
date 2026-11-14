import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { sameData, useLiveRefresh } from '../../shared/live'
import { isConflict, mergeDeep } from '../../shared/merge'
import { Bar, Button, Card, Field, Input, Modal, Select, toast } from '@booqy/brand'
import { ApiError } from '../../shared/api'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useUnsavedGuard } from '../../shared/unsaved'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import './webbplats.css'
import { listMenuItems, type MenuItem } from '../meny/menuApi'
import {
  BLOCK_FIELDS,
  BLOCK_LABEL,
  ERRORS,
  FIELD_LABEL,
  RESERVED_SLUGS,
  SLUG_ERROR,
  FIELD_MAX,
  blockId,
  createPreviewLink,
  freeSlug,
  getSite,
  listVersions,
  conflictPlace,
  locate,
  moveBlock,
  newId,
  publish,
  publishStatus,
  rollback,
  saveDraft,
  type Block,
  type BlockType,
  type SiteDoc,
  type SiteState,
  type Version,
} from './api'
import { ErrorActions } from '../../shared/ErrorNote'

const POLL_MS = 2000
/** Längsta väntan på en publicering eller återställning (cirka 5 minuter). */
export const POLL_LIMIT = 150
export const POLL_SLOW = 'Publiceringen tar längre tid än vanligt. Den fortsätter i bakgrunden; öppna Versioner om en stund för att se om den är klar.'

/** Frågar efter publiceringens status tills den är klar eller misslyckad, högst POLL_LIMIT gånger. */
export async function waitForPublish(publishId: string, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  for (let i = 0; i < POLL_LIMIT; i += 1) {
    await wait(POLL_MS)
    const s = await publishStatus(publishId)
    if (s.status !== 'running') return s
  }
  return null
}

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
              {enabled ? 'Bara ägaren ändrar webbplatsen.' : 'Kontakta oss för att uppgradera.'}
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
  /** Utkastet som det var sparat när du började ändra (för att lägga ihop vid en krock). */
  const [baseDoc, setBaseDoc] = useState<SiteDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  // Osparat utkast: uppdateringsrutan frågar innan den laddar om.
  useUnsavedGuard(dirty)
  const [pageIndex, setPageIndex] = useState(0)
  const [error, setError] = useState<{ text: string; page?: number; block?: number; slug?: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [width, setWidth] = useState<'mobile' | 'desktop'>('mobile')
  const [images, setImages] = useState<(MenuItem & { imageKey: string })[]>([])
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await getSite()
      setSite(s)
      setDoc(s.draft.doc)
      setBaseDoc(s.draft.doc)
      setVersion(s.draft.version)
      setDirty(false)
    } catch (err) {
      setError({ text: errorText(err, 'Kunde inte hämta webbplatsen.', ERRORS) })
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // Levande: publiceringar och ändringar från en kollega syns av sig själva.
  // Har du osparade ändringar skrivs utkastet inte över; de läggs ovanpå det
  // senaste när du sparar.
  const dirtyRef = useRef(dirty)
  const versionRef = useRef(version)
  useEffect(() => {
    dirtyRef.current = dirty
    versionRef.current = version
  }, [dirty, version])
  useLiveRefresh(async () => {
    const s = await getSite()
    // Ett svar som hämtades före din sparning har ett äldre utkast: det får
    // inte ta tillbaka det du nyss sparade (nästa puls har det nya).
    if (s.draft.version < versionRef.current) return
    setSite((cur) => (sameData(cur, s) ? cur : s))
    if (!dirtyRef.current) {
      setDoc((cur) => (sameData(cur, s.draft.doc) ? cur : s.draft.doc))
      setBaseDoc(s.draft.doc)
      setVersion(s.draft.version)
    }
  }, { enabled: site !== null && !saving && !publishing })
  useEffect(() => {
    if (location) listMenuItems(location.locationId).then((items) => setImages(items.filter((i): i is MenuItem & { imageKey: string } => Boolean(i.imageKey)))).catch(() => setImages([]))
  }, [location])

  function change(next: SiteDoc) {
    setDoc(next)
    setDirty(true)
  }

  function fail(err: unknown, action: string) {
    const field = err instanceof ApiError ? err.field : undefined
    const at = locate(field)
    setError({ text: at.slug ? SLUG_ERROR : errorText(err, action, ERRORS), ...at })
    if (at.page !== undefined) setPageIndex(at.page)
  }

  async function save(): Promise<number | null> {
    if (!doc) return null
    setSaving(true)
    setError(null)
    try {
      let sent = doc
      let saved
      try {
        saved = await saveDraft(doc, version)
      } catch (err) {
        if (!isConflict(err) || !baseDoc) throw err
        // Någon annan sparade utkastet emellan: dina ändringar ovanpå det senaste, en gång till.
        const latest = await getSite()
        const { merged, conflicts } = mergeDeep(baseDoc, doc, latest.draft.doc)
        setSite(latest)
        setBaseDoc(latest.draft.doc)
        setVersion(latest.draft.version)
        setDoc(merged)
        if (conflicts.length) {
          const where = conflictPlace(merged, conflicts[0])
          setError({ text: `${where.name} ändrades nyss på en annan plats. Din version står kvar; spara igen för att använda den, eller ändra först.`, page: where.page, block: where.block })
          if (where.page !== undefined) setPageIndex(where.page)
          return null
        }
        sent = merged
        saved = await saveDraft(merged, latest.draft.version)
      }
      setVersion(saved.version)
      setBaseDoc(sent)
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
      const s = await waitForPublish(publishId)
      if (!s) {
        setError({ text: POLL_SLOW })
      } else if (s.status === 'done') {
        toast(`Webbplatsen är publicerad (version ${s.versionNo}).`, { tone: 'success' })
        await load()
      } else {
        const at = locate(s.error?.field)
        setError({ text: at.slug ? SLUG_ERROR : ERRORS[s.error?.code ?? ''] ?? 'Publiceringen misslyckades. Försök igen.', ...at })
        if (at.page !== undefined) setPageIndex(at.page)
      }
    } catch (err) {
      fail(err, 'Kunde inte publicera.')
    } finally {
      setPublishing(false)
    }
  }

  if (!doc || !site) {
    return error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error.text} />}>{error.text}</Bar> : <p className="cell-muted">Hämtar webbplatsen…</p>
  }
  if (site.mode === 'custom') {
    return <Card title="Webbplats"><p>Byggs av Booqy. Kontakta oss för ändringar.</p></Card>
  }

  const page = doc.pages[Math.min(pageIndex, doc.pages.length - 1)]
  const slugError = Boolean(error?.slug && error.page === pageIndex) || RESERVED_SLUGS.has(page.slug)
  const setPage = (patch: Partial<typeof page>) =>
    change({ ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? { ...p, ...patch } : p)) })
  const setBlocks = (blocks: Block[]) => setPage({ blocks })

  function addPage() {
    if (!doc) return
    const title = `Sida ${doc.pages.length + 1}`
    const slug = freeSlug(title, doc.pages.flatMap((p) => [p.slug, p.id]))
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
        {error ? <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng" action={<ErrorActions text={error.text} />}>{error.text}</Bar> : null}
        <Bar variant="tab" label="Sidor" value={page.id} onChange={(key) => setPageIndex(doc.pages.findIndex((p) => p.id === key))}
          items={doc.pages.map((p) => ({ key: p.id, label: p.title || 'Startsida' }))} />
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={addPage} disabled={doc.pages.length >= 20}>Ny sida</Button>
          {page.slug ? <Button size="sm" variant="danger" onClick={removePage}>Ta bort sidan</Button> : null}
        </div>
      </Card>

      <Card title={page.title || 'Startsida'} level={3}>
        <div className="webbplats-fields">
          <Field label="Sidans namn">
            <Input value={page.title} maxLength={80} onChange={(e) => setPage({ title: e.target.value })} />
          </Field>
          {page.slug !== '' || slugError ? (
            <Field label="Adress" hint={slugError ? undefined : `Gästerna hittar sidan på /${page.slug}`} error={slugError ? SLUG_ERROR : undefined}>
              <Input value={page.slug} maxLength={40} onChange={(e) => setPage({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
            </Field>
          ) : null}
          <Field label="Rubrik i sökmotorer">
            <Input value={page.seo.title} maxLength={70} onChange={(e) => setPage({ seo: { ...page.seo, title: e.target.value } })} />
          </Field>
          <Field label="Beskrivning i sökmotorer">
            <Input value={page.seo.description} maxLength={160} onChange={(e) => setPage({ seo: { ...page.seo, description: e.target.value } })} />
          </Field>
        </div>
        <h4 className="webbplats-heading">Block på sidan</h4>
        {page.blocks.length === 0 ? <p className="cell-muted">Inga block än.</p> : null}
        <ol className="webbplats-blocks" aria-label="Block på sidan">
          {page.blocks.map((block, i) => (
            <li key={block.id} className={error?.page === pageIndex && error.block === i ? 'webbplats-block webbplats-block--invalid' : 'webbplats-block'}>
              <BlockEditor
                block={block}
                images={images}
                pages={doc.pages.map((p) => ({ id: p.id, title: p.title || 'Startsida' }))}
                invalid={error?.page === pageIndex && error.block === i}
                onChange={(b) => setBlocks(page.blocks.map((x, j) => (j === i ? b : x)))}
                actions={
                  <div className="row-actions">
                    <Button size="sm" variant="ghost" aria-label={`Flytta upp ${BLOCK_LABEL[block.type]}`} disabled={i === 0}
                      onClick={() => setBlocks(moveBlock(page.blocks, i, -1))}>Upp</Button>
                    <Button size="sm" variant="ghost" aria-label={`Flytta ner ${BLOCK_LABEL[block.type]}`} disabled={i === page.blocks.length - 1}
                      onClick={() => setBlocks(moveBlock(page.blocks, i, 1))}>Ner</Button>
                    <Button size="sm" variant="danger" aria-label={`Ta bort ${BLOCK_LABEL[block.type]}`}
                      onClick={() => setBlocks(page.blocks.filter((_, j) => j !== i))}>Ta bort</Button>
                  </div>
                }
              />
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
        <div className="webbplats-fields">
          <Field label="Huvudfärg">
            <Input type="color" value={doc.theme.primaryColor} onChange={(e) => change({ ...doc, theme: { ...doc.theme, primaryColor: e.target.value } })} />
          </Field>
          <Field label="Accentfärg" hint="Knappar och länkar">
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
      </Card>

      <Card title="Sidans uppbyggnad" level={3}>
        <Bar variant="tab" kind="track" label="Bredd" value={width} onChange={(k) => setWidth(k as 'mobile' | 'desktop')}
          items={[{ key: 'mobile', label: 'Mobil' }, { key: 'desktop', label: 'Dator' }]} />
        <Outline doc={doc} pageIndex={pageIndex} width={width} />
      </Card>

      <Bar variant="action" sticky label="Spara utkast" status={dirty ? 'Osparade ändringar' : 'Sparat'}>
        <Button busy={saving} busyLabel="Sparar…" disabled={!dirty} onClick={() => void save()}>Spara utkast</Button>
      </Bar>

      {versionsOpen ? <Versions onClose={() => setVersionsOpen(false)} onRestored={() => { setVersionsOpen(false); void load() }} /> : null}
    </>
  )
}

function BlockEditor({ block, images, pages, invalid, onChange, actions }: {
  block: Block
  images: (MenuItem & { imageKey: string })[]
  pages: { id: string; title: string }[]
  invalid: boolean
  onChange: (b: Block) => void
  actions: ReactNode
}) {
  const fields = BLOCK_FIELDS[block.type]
  const headingId = `block-${block.id}`
  return (
    <div role="group" aria-labelledby={headingId}>
      <div className="webbplats-block-head">
        <h5 id={headingId} className="form-section-label">{BLOCK_LABEL[block.type]}{invalid ? ' (kontrollera)' : ''}</h5>
        {actions}
      </div>
      <div className="webbplats-fields">
        {fields.map((f) => (
          <Field key={f} label={FIELD_LABEL[f]} error={invalid ? 'Kontrollera det här blocket.' : undefined}>
            {f === 'body' ? (
              <textarea className="bq-input" rows={4} maxLength={FIELD_MAX[f]} value={block[f] ?? ''} onChange={(e) => onChange({ ...block, [f]: e.target.value })} />
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
          <div className="toggle-row toggle-row--field">
            <span className="toggle-row-label">Visa karta</span>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(block.showMap)}
              aria-label="Visa karta"
              className="switch"
              onClick={() => onChange({ ...block, showMap: !block.showMap })}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Sidans uppbyggnad i vald bredd: menyn, blocken i ordning och sidfoten, som en enkel lista. */
function Outline({ doc, pageIndex, width }: { doc: SiteDoc; pageIndex: number; width: 'mobile' | 'desktop' }) {
  const page = doc.pages[pageIndex]
  if (!page) return null
  const nav = doc.nav.map((n) => doc.pages.find((p) => p.id === n.pageId)).filter(Boolean).map((p) => p?.title || 'Startsida')
  return (
    <div className="webbplats-outline" data-width={width} role="group" aria-label={`Sidan i ${width === 'mobile' ? 'mobil' : 'dator'}`}>
      <p className="cell-muted">Meny: {nav.join(' · ')}</p>
      {page.blocks.length === 0 ? <p className="cell-muted">Sidan är tom.</p> : (
        <ol className="webbplats-outline-list">
          {page.blocks.map((b) => (
            <li key={b.id}>
              <span className="form-section-label">{BLOCK_LABEL[b.type]}</span>
              {b.heading ? <strong>{b.heading}</strong> : null}
              {b.text || b.body ? <span className="cell-muted">{b.text ?? b.body}</span> : null}
              {b.label || b.cta ? <span className="cell-muted">Knapp: {b.label ?? b.cta?.label}</span> : null}
            </li>
          ))}
        </ol>
      )}
      {doc.footer.text ? <p className="cell-muted">Sidfot: {doc.footer.text}</p> : null}
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
        const s = await waitForPublish(publishId)
        if (!s) {
          toast(POLL_SLOW, { tone: 'info' })
          return
        }
        if (s.status === 'failed') throw new Error('Återställningen misslyckades. Försök igen.')
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
        <ul className="webbplats-versions">
          {versions.map((v) => (
            <li key={v.versionNo}>
              <span>Version {v.versionNo} · {new Date(v.publishedAt).toLocaleString('sv-SE')}{v.live ? ' · visas nu' : ''}</span>
              {!v.live ? <Button size="sm" variant="secondary" busy={busy === v.versionNo} onClick={() => void restore(v)}>Återställ</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
