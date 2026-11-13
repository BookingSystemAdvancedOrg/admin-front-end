import { useEffect, useState } from 'react'
import { errorText } from '../../shared/errors'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { CtaButton } from '../../shared/CtaButton'
import { StatTile } from '../../shared/motion/StatTile'
import { SkelBlock, SkelTableRows } from '../../shared/Skeleton'
import { onPageAction, takePageAction } from '../../shared/nav'
import { useLocationId } from '../../shared/location'
import { useTenant } from '../../shared/tenant'
import { useAuth } from '../auth/useAuth'
import { StaffModal } from '../installningar/StaffModal'
import type { StaffFormValues } from '../installningar/StaffModal'
import {
  ROLE_TO_GROUP,
  canManageTarget,
  changeUserGroup,
  deactivateUser,
  deleteUser,
  inviteUser,
  listUsers,
  reactivateUser,
  updateUserProfile,
} from '../installningar/usersApi'
import type { User } from '../installningar/usersApi'

const ROLE_LABEL: Record<User['role'], string> = {
  staff: 'Personal',
  owner_user: 'Ägare',
}

type ModalState = { mode: 'invite' } | { mode: 'edit'; user: User } | null

/**
 * Personal: restaurangens inloggningar för medarbetare. Ägaren bjuder in
 * (namn, e-post, telefon, plats), ändrar plats, inaktiverar och tar bort.
 * Allt går mot det befintliga /users/*-API:t (manage-user); tenant tas från
 * token på servern och inbjudan mejlas av Cognito.
 *
 * Bara ägare ser sidan: personalens e-post och telefon är personuppgifter
 * som medarbetare inte behöver, och GET /list-users är ägarens.
 * Fler ägare läggs upp av Booqy, inte här.
 */
export default function PersonalPage() {
  const { sub, groups } = useAuth()
  const { tenant } = useTenant()
  const { locationId } = useLocationId(sub)
  const isOwner = tenant?.role === 'owner_user'

  const [staff, setStaff] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [busySub, setBusySub] = useState<string | null>(null)
  const [place, setPlace] = useState('')
  const [modal, setModal] = useState<ModalState>(() =>
    takePageAction('invite-staff') ? { mode: 'invite' } : null,
  )
  useEffect(() => onPageAction('invite-staff', () => setModal({ mode: 'invite' })), [])

  const locations = (tenant?.locations ?? []).map((l) => ({
    locationId: l.locationId,
    name: l.name || 'Namnlös plats',
  }))
  const placeName = (id?: string) =>
    locations.find((l) => l.locationId === id)?.name ?? 'Ingen plats'

  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    listUsers()
      .then((users) => {
        if (!cancelled) setStaff(users)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorText(err, 'Kunde inte hämta personalen.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOwner])

  if (tenant && !isOwner) {
    return (
      <>
        <AdminTopbar title="Personal" />
        <div className="admin-main">
          <section className="admin-card">
            <p className="cell-muted">Det är restaurangens ägare som bjuder in och hanterar personalen.</p>
          </section>
        </div>
      </>
    )
  }

  const caller = { sub, groups }
  const shown = place ? staff.filter((s) => s.role !== 'staff' || s.locationId === place) : staff
  const staffOnly = staff.filter((s) => s.role === 'staff')
  const active = staffOnly.filter((s) => s.status === 'active').length
  const tiles = [
    { label: 'Medarbetare', value: String(staffOnly.length), note: staffOnly.length ? 'Med egen inloggning' : 'Bjud in din första' },
    { label: 'Aktiva', value: String(active), note: 'Kan logga in' },
    { label: 'Inaktiva', value: String(staffOnly.length - active), note: 'Spärrade, kan aktiveras igen' },
    { label: 'Platser', value: String(locations.length), note: 'Personal hör till en plats' },
  ]

  function replace(updated: User) {
    setStaff((prev) => prev.map((s) => (s.cognitoSub === updated.cognitoSub ? updated : s)))
  }

  async function handleSave(values: StaffFormValues) {
    if (modal?.mode === 'invite') {
      const created = await inviteUser(values)
      setStaff((prev) => [...prev, created])
      setModal(null)
      return
    }
    if (modal?.mode !== 'edit') return
    const original = modal.user
    const roleChanged = values.group !== ROLE_TO_GROUP[original.role]
    const profile: Record<string, string> = {}
    if (values.name !== original.name) profile.name = values.name
    if (values.email !== original.email) profile.email = values.email
    if (values.phone !== original.phone) profile.phone = values.phone
    if (!roleChanged && values.locationId !== original.locationId) profile.locationId = values.locationId
    let updated = original
    if (Object.keys(profile).length > 0) updated = await updateUserProfile(original.cognitoSub, profile)
    if (roleChanged) {
      updated = await changeUserGroup(original.cognitoSub, { group: values.group, locationId: values.locationId })
    }
    replace(updated)
    setModal(null)
  }

  async function handleToggle(user: User) {
    setRowError(null)
    setBusySub(user.cognitoSub)
    try {
      replace(user.status === 'active' ? await deactivateUser(user.cognitoSub) : await reactivateUser(user.cognitoSub))
    } catch (err) {
      setRowError(errorText(err, 'Kunde inte ändra status.'))
    } finally {
      setBusySub(null)
    }
  }

  async function handleDelete(user: User) {
    if (!window.confirm(`Ta bort ${user.name} permanent? Inloggningen försvinner och kan inte återställas.`)) return
    setRowError(null)
    setBusySub(user.cognitoSub)
    try {
      await deleteUser(user.cognitoSub)
      setStaff((prev) => prev.filter((s) => s.cognitoSub !== user.cognitoSub))
    } catch (err) {
      setRowError(errorText(err, 'Kunde inte ta bort medarbetaren.'))
    } finally {
      setBusySub(null)
    }
  }

  return (
    <>
      <AdminTopbar
        title="Personal"
        actions={
          <CtaButton
            label="+ Bjud in personal"
            win="Välkommen!"
            data-tour="personal-invite"
            disabled={!tenant || locations.length === 0}
            onClick={() => setModal({ mode: 'invite' })}
          />
        }
      />
      <div className="admin-main">
        {tenant && locations.length === 0 && (
          <p className="form-error" role="alert">
            Skapa restaurangens plats under Inställningar först: personal kopplas till en plats.
          </p>
        )}
        <section className="stats-row" aria-label="Personalens siffror">
          {tiles.map((t, i) => (
            <StatTile key={t.label} {...t} loading={loading} index={i} />
          ))}
        </section>

        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Medarbetare</h2>
              <p className="cell-muted">
                {loading ? (
                  <SkelBlock w={200} h={14} />
                ) : (
                  'Inbjudan går till e-posten med ett tillfälligt lösenord. Personen ser bokningar, beställningar och menyn för sin plats.'
                )}
              </p>
            </div>
            {locations.length > 1 && (
              <div className="form-field">
                <label htmlFor="personal-place">Plats</label>
                <select id="personal-place" value={place} onChange={(e) => setPlace(e.target.value)}>
                  <option value="">Alla platser</option>
                  {locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {(loadError ?? rowError) && (
            <p className="form-error" role="alert">
              {loadError ?? rowError}
            </p>
          )}
          <div className="table-scroll">
            <table className="data-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Namn</th>
                  <th>Roll och plats</th>
                  <th>Status</th>
                  <th>Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkelTableRows n={4} cols={4} />}
                {!loading && shown.length === 0 && !loadError && (
                  <tr>
                    <td colSpan={4} className="cell-muted">
                      Ingen personal här än. Bjud in den första med knappen uppe till höger.
                    </td>
                  </tr>
                )}
                {shown.map((s) => {
                  const canEdit = canManageTarget(caller, s, 'profile')
                  const canToggle = canManageTarget(caller, s, s.status === 'active' ? 'deactivate' : 'reactivate')
                  const canDelete = canManageTarget(caller, s, 'delete')
                  const busy = busySub === s.cognitoSub
                  return (
                    <tr key={s.cognitoSub}>
                      <td className="cell-strong">
                        {s.name}
                        {s.cognitoSub === sub && <span className="cell-muted"> (du)</span>}
                        <span className="cell-muted" style={{ display: 'block', fontWeight: 400 }}>{s.email}</span>
                      </td>
                      <td>
                        {ROLE_LABEL[s.role] ?? s.role}
                        {s.role === 'staff' && <span className="cell-muted">{' · '}{placeName(s.locationId)}</span>}
                      </td>
                      <td>
                        <span className={`status-badge ${s.status === 'active' ? 'reserved' : 'cancelled'}`}>
                          {s.status === 'active' ? 'Aktiv' : 'Inaktiv'}
                        </span>
                      </td>
                      <td>
                        <span className="row-actions">
                          {canEdit && (
                            <button type="button" className="link-action" disabled={busy} onClick={() => setModal({ mode: 'edit', user: s })}>
                              Redigera
                            </button>
                          )}
                          {canToggle && (
                            <button type="button" className="link-action" disabled={busy} onClick={() => handleToggle(s)}>
                              {s.status === 'active' ? 'Inaktivera' : 'Aktivera'}
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="link-action danger" disabled={busy} onClick={() => handleDelete(s)}>
                              Ta bort
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {modal && (
        <StaffModal
          title={modal.mode === 'invite' ? 'Bjud in personal' : 'Redigera medarbetare'}
          initial={modal.mode === 'edit' ? modal.user : null}
          callerGroups={groups}
          lockRole={modal.mode === 'edit' && modal.user.cognitoSub === sub}
          locations={locations}
          defaultLocationId={place || (locationId ?? undefined)}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )
}
