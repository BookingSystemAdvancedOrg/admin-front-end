import { useCallback, useEffect, useState } from 'react'
import { TemplateEditor } from './TemplateEditor'
import {
  createTemplate,
  deleteTemplate,
  errorText,
  formatDateTime,
  listStarters,
  listTemplates,
  updateTemplate,
} from './marketingApi'
import type { Starter, Template, TemplateInput } from './marketingApi'
import { useEscape } from './useEscape'
import { SkelRows } from '../../shared/Skeleton'

type Editing = { mode: 'new'; initial: TemplateInput; title: string } | { mode: 'edit'; template: Template }

const BLANK: TemplateInput = {
  name: 'Ny mall',
  subject: 'Nyheter från {restaurang}',
  preheader: '',
  blocks: [
    { type: 'heading', text: 'Rubrik' },
    { type: 'text', text: 'Hej {förnamn}!' },
    { type: 'button', label: 'Boka bord', destination: 'book' },
  ],
}

export function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [starters, setStarters] = useState<Starter[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([listTemplates(), listStarters().catch(() => [] as Starter[])])
      .then(([t, s]) => {
        setTemplates(t)
        setStarters(s)
      })
      .catch((err: unknown) => setError(errorText(err, 'Kunde inte hämta mallarna.')))
  }, [])

  useEffect(load, [load])
  const closeConfirm = useCallback(() => setConfirmDelete(null), [])
  useEscape(closeConfirm, confirmDelete !== null)

  const save = async (input: TemplateInput) => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      if (editing.mode === 'edit') await updateTemplate(editing.template.templateId, input)
      else await createTemplate(input)
      setEditing(null)
      setNotice('Mallen är sparad.')
      load()
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara mallen.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (t: Template) => {
    setConfirmDelete(null)
    setError(null)
    try {
      await deleteTemplate(t.templateId)
      setNotice('Mallen är borttagen.')
      load()
    } catch (err) {
      setError(errorText(err, 'Kunde inte ta bort mallen.'))
    }
  }

  if (editing) {
    return (
      <div className="mk-stack">
        {error && <p className="form-error" role="alert">{error}</p>}
        <TemplateEditor
          key={editing.mode === 'edit' ? editing.template.templateId : editing.title}
          title={editing.mode === 'edit' ? `Redigera ${editing.template.name}` : editing.title}
          initial={editing.mode === 'edit' ? editing.template : editing.initial}
          saving={saving}
          onSave={(t) => void save(t)}
          onCancel={() => setEditing(null)}
        />
      </div>
    )
  }

  return (
    <div className="mk-stack">
      {notice && <p className="save-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="admin-card table-card">
        <div className="card-head">
          <h2 className="card-title">Era mallar</h2>
          <button
            type="button"
            className="btn primary square"
            onClick={() => {
              setNotice(null)
              setEditing({ mode: 'new', initial: BLANK, title: 'Ny mall' })
            }}
          >
            Ny tom mall
          </button>
        </div>
        {templates === null && !error && <SkelRows n={3} cols={2} />}
        {templates !== null && templates.length === 0 && (
          <p className="cell-muted">Inga mallar än. Börja från en färdig mall nedan eller skapa en tom.</p>
        )}
        {templates && templates.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Namn</th>
                  <th>Ämnesrad</th>
                  <th>Ändrad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.templateId}>
                    <td className="cell-strong">{t.name}</td>
                    <td>{t.subject}</td>
                    <td className="cell-muted">{formatDateTime(t.updatedAt)}</td>
                    <td className="mk-row-actions">
                      <button type="button" className="link-action" onClick={() => { setNotice(null); setEditing({ mode: 'edit', template: t }) }}>
                        Redigera
                      </button>
                      <button
                        type="button"
                        className="link-action"
                        onClick={() => {
                          setNotice(null)
                          setEditing({ mode: 'new', title: 'Kopia av mall', initial: { ...t, name: `${t.name} (kopia)`.slice(0, 80) } })
                        }}
                      >
                        Kopiera
                      </button>
                      <button type="button" className="link-action danger" onClick={() => setConfirmDelete(t)}>
                        Ta bort
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {starters.length > 0 && (
        <section className="admin-card table-card">
          <div className="card-head">
            <h2 className="card-title">Börja från en färdig mall</h2>
          </div>
          <div className="mk-starters">
            {starters.map((s) => (
              <button
                key={s.key}
                type="button"
                className="mk-starter"
                onClick={() => {
                  setNotice(null)
                  setEditing({ mode: 'new', title: s.name, initial: { name: s.name, subject: s.subject, preheader: s.preheader, blocks: s.blocks } })
                }}
              >
                <span className="mk-starter-name">{s.name}</span>
                <span className="cell-muted">{s.subject}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label="Ta bort mallen">
            <h2>Ta bort {confirmDelete.name}?</h2>
            <p className="modal-text">Kampanjer som redan skickats påverkas inte. Utkast som använder mallen kan inte skickas.</p>
            <div className="modal-actions">
              <button type="button" className="btn outline square" autoFocus onClick={() => setConfirmDelete(null)}>Avbryt</button>
              <button type="button" className="btn danger-outline square" onClick={() => void remove(confirmDelete)}>Ta bort</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
