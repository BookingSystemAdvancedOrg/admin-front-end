import { useCallback, useEffect, useState } from 'react'
import { Num } from '../../shared/motion/Num'
import type { FormEvent } from 'react'
import { Loading } from '../../shared/Loading'
import { useTenant } from '../../shared/tenant'
import {
  AUDIENCE_LABEL,
  CAMPAIGN_STATUS_CLASS,
  CAMPAIGN_STATUS_LABEL,
  audienceSize,
  audienceText,
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  errorText,
  formatDateTime,
  kronorFromOre,
  listCampaigns,
  listTemplates,
  percent,
  resumeCampaign,
  sendCampaign,
  sendTest,
  updateCampaign,
} from './marketingApi'
import type { Audience, AudienceType, Campaign, CampaignInput, Template } from './marketingApi'
import type { TabId } from './MarknadsforingPage'
import { useEscape } from './useEscape'
import { DateTimeInput } from '../../shared/DateInput'

const DAY_CHOICES = [30, 60, 90, 180, 365]

function CampaignForm({
  campaign,
  templates,
  onSaved,
  onClose,
}: {
  campaign: Campaign | null
  templates: Template[]
  onSaved: (c: Campaign) => void
  onClose: () => void
}) {
  const { tenant } = useTenant()
  const locations = tenant?.locations ?? []
  const [name, setName] = useState(campaign?.name ?? '')
  const [templateId, setTemplateId] = useState(campaign?.templateId ?? templates[0]?.templateId ?? '')
  const [subject, setSubject] = useState(campaign?.subject ?? '')
  const [type, setType] = useState<AudienceType>(campaign?.audience.type ?? 'all')
  const [days, setDays] = useState<number>(campaign?.audience.days ?? 90)
  const [loc, setLoc] = useState<string>(campaign?.audience.locationId ?? '')
  const [counted, setCounted] = useState<{ key: string; n: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audience: Audience = {
    type,
    ...(type !== 'all' ? { days } : {}),
    ...(loc ? { locationId: loc } : {}),
  }
  const audienceKey = JSON.stringify(audience)
  const count = counted?.key === audienceKey ? counted.n : null

  useEffect(() => {
    let cancelled = false
    audienceSize(JSON.parse(audienceKey) as Audience)
      .then((n) => !cancelled && setCounted({ key: audienceKey, n }))
      .catch(() => !cancelled && setCounted({ key: audienceKey, n: -1 }))
    return () => {
      cancelled = true
    }
  }, [audienceKey])

  const template = templates.find((t) => t.templateId === templateId)
  useEscape(onClose, !saving)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Ge kampanjen ett namn.')
    if (!templateId) return setError('Välj en mall.')
    setSaving(true)
    setError(null)
    const input: CampaignInput = { name, templateId, subject, audience }
    try {
      onSaved(campaign ? await updateCampaign(campaign.campaignId, input) : await createCampaign(input))
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara kampanjen.'))
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal mk-modal" role="dialog" aria-modal="true" aria-label="Kampanj" onSubmit={(e) => void submit(e)}>
        <h2>{campaign ? 'Redigera kampanj' : 'Ny kampanj'}</h2>
        <div className="form-field">
          <label htmlFor="mk-c-name">Namn (syns i statistiken och länkarna)</label>
          <input id="mk-c-name" autoFocus value={name} maxLength={80} placeholder="t.ex. Vårmeny 2026" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="mk-c-tpl">Mall</label>
          <select id="mk-c-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.templateId} value={t.templateId}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="mk-c-subject">Ämnesrad (tom = mallens)</label>
          <input id="mk-c-subject" value={subject} maxLength={120} placeholder={template?.subject ?? ''} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <p className="form-section-label">Målgrupp</p>
        <div className="form-field">
          <label htmlFor="mk-c-aud">Vilka får utskicket</label>
          <select id="mk-c-aud" value={type} onChange={(e) => setType(e.target.value as AudienceType)}>
            {(Object.keys(AUDIENCE_LABEL) as AudienceType[]).map((a) => (
              <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>
            ))}
          </select>
        </div>
        {type !== 'all' && (
          <div className="form-field">
            <label htmlFor="mk-c-days">{type === 'recent' ? 'Senaste besöket inom' : 'Inget besök på minst'}</label>
            <select id="mk-c-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAY_CHOICES.map((d) => (
                <option key={d} value={d}>{d} dagar</option>
              ))}
            </select>
          </div>
        )}
        {locations.length > 1 && (
          <div className="form-field">
            <label htmlFor="mk-c-loc">Plats</label>
            <select id="mk-c-loc" value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="">Alla platser</option>
              {locations.map((l) => (
                <option key={l.locationId} value={l.locationId}>{l.name || 'Namnlös plats'}</option>
              ))}
            </select>
          </div>
        )}
        <p className="mk-audience-count" aria-live="polite">
          {count === null ? 'Räknar mottagare…' : count < 0 ? 'Kunde inte räkna mottagarna.' : `${count} mottagare just nu`}
        </p>
        <p className="field-hint">
          Bara gäster som själva kryssat i att de vill få erbjudanden. Den som avregistrerat sig får aldrig utskick.
        </p>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onClose} disabled={saving}>Avbryt</button>
          <button type="submit" className="btn primary square" disabled={saving}>{saving ? 'Sparar…' : 'Spara utkast'}</button>
        </div>
      </form>
    </div>
  )
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SendDialog({ campaign, onDone, onClose }: { campaign: Campaign; onDone: (msg: string) => void; onClose: () => void }) {
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000)
    d.setHours(10, 0, 0, 0)
    return toLocalInput(d)
  })
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    audienceSize(campaign.audience).then((n) => !cancelled && setCount(n)).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [campaign.audience])

  useEscape(onClose, !busy)

  const go = async () => {
    const later = when === 'later' ? new Date(at) : null
    if (later && (Number.isNaN(later.getTime()) || later.getTime() < Date.now() - 60_000)) {
      setError('Välj ett datum och en tid framåt i tiden.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const scheduledAt = later ? later.toISOString() : null
      const out = await sendCampaign(campaign.campaignId, scheduledAt)
      onDone(
        when === 'later'
          ? `Kampanjen skickas ${formatDateTime(out.scheduledAt)} till ${out.audienceSize} mottagare.`
          : `Kampanjen skickas nu till ${out.audienceSize} mottagare. Det tar några minuter.`,
      )
    } catch (err) {
      setError(errorText(err, 'Kunde inte skicka kampanjen.'))
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal mk-modal" role="dialog" aria-modal="true" aria-label="Skicka kampanjen">
        <h2>Skicka {campaign.name}?</h2>
        <p className="modal-text">
          {count === null ? 'Räknar mottagare…' : `${count} mottagare (${audienceText(campaign.audience).toLowerCase()}).`} När
          kampanjen skickas låses innehållet: ändringar i mallen efteråt påverkar inte utskicket.
        </p>
        <div className="mk-radio-row" role="radiogroup" aria-label="När">
          <label className="check-row">
            <input type="radio" name="mk-when" autoFocus checked={when === 'now'} onChange={() => setWhen('now')} /> Skicka nu
          </label>
          <label className="check-row">
            <input type="radio" name="mk-when" checked={when === 'later'} onChange={() => setWhen('later')} /> Schemalägg
          </label>
        </div>
        {when === 'later' && (
          <div className="form-field">
            <label htmlFor="mk-send-at">Datum och tid</label>
            <DateTimeInput id="mk-send-at" timeLabel="Tid" value={at} min={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onClose} disabled={busy}>Avbryt</button>
          <button type="button" className="btn primary square" onClick={() => void go()} disabled={busy || count === 0}>
            {busy ? 'Skickar…' : when === 'later' ? 'Schemalägg' : 'Skicka nu'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CampaignsTab({ onOpen }: { onOpen: (tab: TabId) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<{ campaign: Campaign | null } | null>(null)
  const [sending, setSending] = useState<Campaign | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([listCampaigns(), listTemplates()])
      .then(([c, t]) => {
        setCampaigns(c)
        setTemplates(t)
      })
      .catch((err: unknown) => setError(errorText(err, 'Kunde inte hämta kampanjerna.')))
  }, [])

  useEffect(load, [load])

  // Medan något skickas: hämta om då och då så siffrorna rör sig.
  const active = (campaigns ?? []).some((c) => c.status === 'sending' || c.status === 'scheduled')
  useEffect(() => {
    if (!active) return
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [active, load])

  const act = async (c: Campaign, what: 'test' | 'cancel' | 'resume' | 'delete') => {
    setBusy(`${c.campaignId}:${what}`)
    setError(null)
    setNotice(null)
    try {
      if (what === 'test') {
        const out = await sendTest(c.campaignId)
        setNotice(`Ett testmejl är skickat till ${out.sentTo}.`)
      } else if (what === 'cancel') {
        await cancelCampaign(c.campaignId)
        setNotice('Kampanjen är avbruten. Det som redan skickats kan inte tas tillbaka.')
      } else if (what === 'resume') {
        await resumeCampaign(c.campaignId)
        setNotice('Kampanjen fortsätter. Ingen får den två gånger.')
      } else {
        await deleteCampaign(c.campaignId)
        setNotice('Utkastet är borttaget.')
      }
      load()
    } catch (err) {
      setError(errorText(err, 'Det gick inte just nu.'))
    } finally {
      setBusy(null)
    }
  }

  const noTemplates = templates !== null && templates.length === 0

  return (
    <div className="mk-stack">
      {notice && <p className="save-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="admin-card table-card">
        <div className="card-head">
          <h2 className="card-title">Kampanjer</h2>
          <button type="button" className="btn primary square" disabled={!templates || noTemplates} onClick={() => setForm({ campaign: null })}>
            Ny kampanj
          </button>
        </div>
        {noTemplates && (
          <p className="cell-muted">
            Skapa en mall först.{' '}
            <button type="button" className="link-btn" onClick={() => onOpen('mallar')}>Till mallarna →</button>
          </p>
        )}
        {campaigns === null && !error && <Loading />}
        {campaigns !== null && campaigns.length === 0 && !noTemplates && (
          <p className="cell-muted">Inga kampanjer än. Skapa en, skicka ett test till dig själv och sedan till gästerna.</p>
        )}
        {campaigns && campaigns.length > 0 && (
          <div className="table-scroll">
            <table className="data-table mk-campaigns">
              <thead>
                <tr>
                  <th>Kampanj</th>
                  <th>Status</th>
                  <th>Skickade</th>
                  <th>Klick</th>
                  <th>Bokningar</th>
                  <th>Omsättning</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const s = c.stats ?? {}
                  const sent = s.sent ?? 0
                  const isBusy = (w: string) => busy === `${c.campaignId}:${w}`
                  return (
                    <tr key={c.campaignId}>
                      <td className="cell-strong">
                        {c.name}
                        <div className="cell-muted">{audienceText(c.audience)}</div>
                      </td>
                      <td>
                        <span className={`status-badge ${CAMPAIGN_STATUS_CLASS[c.status]}`}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
                        {c.status === 'scheduled' && <div className="cell-muted">{formatDateTime(c.scheduledAt)}</div>}
                        {c.status === 'sent' && <div className="cell-muted">{formatDateTime(c.sentAt ?? c.finishedAt)}</div>}
                      </td>
                      <td>
                        <Num>{sent}</Num>
                        {(s.bounced ?? 0) + (s.failed ?? 0) > 0 && (
                          <div className="cell-muted">{(s.bounced ?? 0) + (s.failed ?? 0)} kom inte fram</div>
                        )}
                      </td>
                      <td>
                        <Num>{s.clicked ?? 0}</Num>
                        <div className="cell-muted">{percent(s.clicked ?? 0, sent)}</div>
                      </td>
                      <td>
                        <Num>{s.bookings ?? 0}</Num>
                        {(s.guests ?? 0) > 0 && <div className="cell-muted">{s.guests} gäster</div>}
                      </td>
                      <td>
                        <Num>{kronorFromOre(s.revenueOre ?? 0)}</Num>
                        {(s.unsubscribed ?? 0) > 0 && <div className="cell-muted">{s.unsubscribed} avregistrerade</div>}
                      </td>
                      <td className="mk-row-actions">
                        {c.status === 'draft' && (
                          <>
                            <button type="button" className="link-action" onClick={() => setForm({ campaign: c })}>Redigera</button>
                            <button type="button" className="link-action" disabled={isBusy('test')} onClick={() => void act(c, 'test')}>
                              {isBusy('test') ? 'Skickar…' : 'Testa'}
                            </button>
                            <button type="button" className="btn primary square mk-small" onClick={() => setSending(c)}>Skicka</button>
                            <button type="button" className="link-action danger" disabled={isBusy('delete')} onClick={() => void act(c, 'delete')}>Ta bort</button>
                          </>
                        )}
                        {c.status === 'paused_limit' && (
                          <button type="button" className="link-action" disabled={isBusy('resume')} onClick={() => void act(c, 'resume')}>Fortsätt</button>
                        )}
                        {(c.status === 'scheduled' || c.status === 'sending' || c.status === 'paused_limit') && (
                          <button type="button" className="link-action danger" disabled={isBusy('cancel')} onClick={() => void act(c, 'cancel')}>Avbryt</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mk-footnote cell-muted">
        Klick räknas per mottagare. Bokningar och omsättning räknas när en gäst bokar eller beställer efter att ha
        klickat i utskicket. Öppningar mäts inte.
      </p>

      {form && templates && (
        <CampaignForm
          campaign={form.campaign}
          templates={templates}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            setNotice('Utkastet är sparat. Skicka ett test till dig själv innan du skickar till gästerna.')
            load()
          }}
        />
      )}
      {sending && (
        <SendDialog
          campaign={sending}
          onClose={() => setSending(null)}
          onDone={(msg) => {
            setSending(null)
            setNotice(msg)
            load()
          }}
        />
      )}
    </div>
  )
}
