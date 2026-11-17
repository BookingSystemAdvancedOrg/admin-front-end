import { useLiveRefresh } from '../../shared/live'
import { Avatar } from '../../shared/Avatar'
import { AvatarLightbox } from '../../shared/AvatarLightbox'
import { isRowOpenKey, shouldOpenRow } from '../meny/rowClick'
import { getMyAvatar, removeUserAvatar, subscribeMyAvatar } from '../../shared/avatarStore'
import { RowActions } from '../../shared/RowActions'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { booqyFaultText, errorText } from '../../shared/errors'
import { useConfirm } from '../../shared/ConfirmDialog'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { CtaButton } from '../../shared/CtaButton'
import { StatTile } from '../../shared/motion/StatTile'
import { SkelTableRows } from '../../shared/Skeleton'
import { onPageAction, takePageAction } from '../../shared/nav'
import { useLocationId } from '../../shared/location'
import { replaceTenant, updateTenant, useTenant } from '../../shared/tenant'
import { canOpen } from '../../shared/access'
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
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { Select } from '../../shared/Select'

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
 * Ägaren ser sidan, och personal som ägaren har gett området Personal (de
 * ser och bjuder in personalen på sin egen plats, men ändrar inga roller,
 * behörigheter eller tar bort konton). Ägaren bockar här i vad varje person
 * får öppna utöver gruppen (Inställningar, Personal, Behörigheter).
 * Fler ägare läggs upp av Booqy, inte här.
 */
export default function PersonalPage() {
  const myAvatar = useSyncExternalStore(subscribeMyAvatar, getMyAvatar, getMyAvatar)
  const { sub, groups } = useAuth()
  const { tenant } = useTenant()
  const { locationId } = useLocationId(sub)
  const isOwner = tenant?.role === 'owner_user'
  const canUse = canOpen(tenant, 'personal')

  const [staff, setStaff] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  // Det som misslyckades, så att Försök igen gör om just det (utan ny fråga).
  const [rowRetry, setRowRetry] = useState<(() => void) | null>(null)
  const [busySub, setBusySub] = useState<string | null>(null)
  const [viewing, setViewing] = useState<User | null>(null)
  const [confirmEl, ask] = useConfirm()
  const avatarFor = (u: User) => (u.cognitoSub === sub ? (myAvatar.url ?? u.avatarUrl) : u.avatarUrl)
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
    if (!canUse) return
    let cancelled = false
    listUsers()
      .then((users) => {
        if (!cancelled) setStaff(users)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorText(err, 'Personalen kunde inte visas.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canUse])
  // Levande: inbjudningar som accepteras och ändringar från en annan plats syns av sig själva.
  useLiveRefresh(async () => {
    setStaff(await listUsers())
    setLoadError(null)
  }, { enabled: canUse && !loading })

  if (tenant && !canUse) {
    return (
      <>
        <AdminTopbar title="Personal" />
        <div className="admin-main">
          <section className="admin-card">
            <p className="cell-muted">Du har inte behörighet till Personal. Be ägaren om behörighet.</p>
          </section>
        </div>
      </>
    )
  }

  const caller = { sub, groups, personal: canUse }
  const shown = place ? staff.filter((s) => s.role !== 'staff' || s.locationId === place) : staff
  const staffOnly = staff.filter((s) => s.role === 'staff')
  const active = staffOnly.filter((s) => s.status === 'active').length
  const tiles = [
    { label: 'Medarbetare', value: String(staffOnly.length) },
    { label: 'Aktiva', value: String(active) },
    { label: 'Inaktiva', value: String(staffOnly.length - active) },
    { label: 'Platser', value: String(locations.length) },
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
    if (values.access && tenant?.staffAccess) {
      replaceTenant(await updateTenant({
        staffAccess: { version: tenant.staffAccess.version, users: { [original.cognitoSub]: values.access } },
      }))
    }
    setModal(null)
  }

  function failRow(text: string, retry: () => void) {
    setRowError(text)
    setRowRetry(() => retry)
  }

  function clearRow() {
    setRowError(null)
    setRowRetry(null)
  }

  async function handleToggle(user: User) {
    clearRow()
    setBusySub(user.cognitoSub)
    try {
      replace(user.status === 'active' ? await deactivateUser(user.cognitoSub) : await reactivateUser(user.cognitoSub))
    } catch (err) {
      failRow(errorText(err, user.status === 'active' ? 'Medarbetaren stängdes inte av.' : 'Medarbetaren slogs inte på.'), () => void handleToggle(user))
    } finally {
      setBusySub(null)
    }
  }

  async function handleRemoveAvatar(user: User) {
    if (!(await ask({ title: `Ta bort profilbilden för ${user.name}?`, text: 'Initialerna visas i stället.', confirmLabel: 'Ta bort', danger: true }))) return
    await removeAvatar(user)
  }

  async function removeAvatar(user: User) {
    clearRow()
    setBusySub(user.cognitoSub)
    if (await removeUserAvatar(user.cognitoSub)) {
      setStaff((prev) => prev.map((s) => (s.cognitoSub === user.cognitoSub ? { ...s, avatarUrl: null } : s)))
    } else {
      failRow(booqyFaultText('Profilbilden togs inte bort.'), () => void removeAvatar(user))
    }
    setBusySub(null)
  }

  async function handleDelete(user: User) {
    if (!(await ask({ title: `Ta bort ${user.name}?`, text: 'Inloggningen försvinner och kan inte återställas.', confirmLabel: 'Ta bort', danger: true }))) return
    await removeUser(user)
  }

  async function removeUser(user: User) {
    clearRow()
    setBusySub(user.cognitoSub)
    try {
      await deleteUser(user.cognitoSub)
      setStaff((prev) => prev.filter((s) => s.cognitoSub !== user.cognitoSub))
    } catch (err) {
      failRow(errorText(err, 'Medarbetaren togs inte bort.'), () => void removeUser(user))
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
            label="Bjud in personal"
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
            Skapa restaurangens plats under Inställningar först.
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
              <TitleInfo title="Medarbetare" info="Inbjudan går till e-posten med ett tillfälligt lösenord. Personen ser sin plats och det som är ibockat under Behörigheter." />
            </div>
            {locations.length > 1 && (
              <div className="form-field">
                <label htmlFor="personal-place">Plats</label>
                <Select id="personal-place" value={place} onChange={(e) => setPlace(e.target.value)}>
                  <option value="">Alla platser</option>
                  {locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          {(loadError ?? rowError) && (
            <ErrorNote text={loadError ?? rowError} onRetry={!loadError && rowRetry ? rowRetry : undefined} />
          )}
          <div className="table-scroll" tabIndex={0}>
            <table className="data-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Namn</th>
                  <th>Roll och plats</th>
                  <th>Status</th>
                  <th className="right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkelTableRows n={4} cols={4} />}
                {!loading && shown.length === 0 && !loadError && (
                  <tr>
                    <td colSpan={4} className="cell-muted">
                      Ingen personal än.
                    </td>
                  </tr>
                )}
                {shown.map((s) => {
                  const canEdit = canManageTarget(caller, s, 'profile')
                  const canToggle = canManageTarget(caller, s, s.status === 'active' ? 'deactivate' : 'reactivate')
                  const canDelete = canManageTarget(caller, s, 'delete')
                  const busy = busySub === s.cognitoSub
                  return (
                    // Hela raden öppnar Redigera (klick eller Enter) när man får redigera
                    // personen; bilden öppnar profilbilden och knapparna gör sitt eget.
                    <tr
                      key={s.cognitoSub}
                      className={canEdit ? 'person-row' : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      aria-label={canEdit ? `${s.name || s.email}, öppna för att redigera` : undefined}
                      onClick={(e) => {
                        if (canEdit && !busy && shouldOpenRow(e.target, e.currentTarget)) setModal({ mode: 'edit', user: s })
                      }}
                      onKeyDown={(e) => {
                        if (canEdit && !busy && isRowOpenKey(e)) {
                          e.preventDefault()
                          setModal({ mode: 'edit', user: s })
                        }
                      }}
                    >
                      <td className="cell-strong">
                        <span className="person-cell">
                          <button
                            type="button"
                            className="avatar-btn"
                            aria-label={`Visa profilbilden för ${s.name || s.email}`}
                            onClick={() => setViewing(s)}
                          >
                            <Avatar url={avatarFor(s)} name={s.name} email={s.email} size="md" />
                          </button>
                          <span className="person-cell-text">
                            {s.name}
                            {s.cognitoSub === sub && <span className="cell-muted"> (du)</span>}
                            <span className="cell-muted person-cell-email">{s.email}</span>
                          </span>
                        </span>
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
                      <td className="right">
                        <RowActions label="Åtgärder för personen">
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
                          {canEdit && s.cognitoSub !== sub && s.avatarUrl && (
                            <button type="button" className="link-action" disabled={busy} onClick={() => void handleRemoveAvatar(s)}>
                              Ta bort profilbild
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="link-action danger" disabled={busy} onClick={() => handleDelete(s)}>
                              Ta bort
                            </button>
                          )}
                        </RowActions>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {confirmEl}
      {viewing && (
        <AvatarLightbox url={avatarFor(viewing)} name={viewing.name} email={viewing.email} onClose={() => setViewing(null)} />
      )}
      {modal && (
        <StaffModal
          title={modal.mode === 'invite' ? 'Bjud in personal' : 'Redigera medarbetare'}
          initial={modal.mode === 'edit' ? modal.user : null}
          callerGroups={groups}
          tenant={tenant}
          access={
            isOwner && modal.mode === 'edit' && modal.user.role === 'staff' && tenant?.staffAccess
              ? tenant.staffAccess
              : null
          }
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
