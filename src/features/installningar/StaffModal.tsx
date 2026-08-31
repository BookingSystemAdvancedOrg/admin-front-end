import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { CognitoGroup, User } from './usersApi'
import {
  canInvite,
  validateEmail,
  validateLocationId,
  validateName,
  validatePhone,
} from './usersApi'

export interface StaffFormValues {
  name: string
  email: string
  phone: string
  group: CognitoGroup
  locationId: string
}

const ROLE_LABEL: Record<CognitoGroup, string> = {
  staff_user: 'Personal',
  owner_user: 'Ägare',
  super_user: 'Systemadmin',
}
const ALL_GROUPS: CognitoGroup[] = ['staff_user', 'owner_user', 'super_user']

/**
 * Popup för att bjuda in eller redigera en användare i Personal & behörigheter.
 * Samma dialog för båda flödena, precis som DishModal i meny-vyn.
 *
 * `callerGroups` styr vilka roller som går att välja (speglar backendens
 * _authorize_invite/_authorize_target: owner_user kan bara hantera personal,
 * bara super_user kan sätta ägare/systemadmin). `lockRole` stängs av när man
 * redigerar sin egen rad — man får inte ändra sin egen roll.
 */
export function StaffModal({
  title,
  initial,
  callerGroups,
  lockRole,
  defaultLocationId,
  onSave,
  onCancel,
}: {
  title: string
  initial: User | null
  callerGroups: string[]
  lockRole: boolean
  /** Förifyllt Plats-ID för nya inbjudningar (t.ex. restaurangens enda plats). */
  defaultLocationId?: string
  onSave: (values: StaffFormValues) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [group, setGroup] = useState<CognitoGroup>(
    initial ? roleToGroup(initial.role) : 'staff_user',
  )
  const [locationId, setLocationId] = useState(
    initial?.locationId ?? defaultLocationId ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Om vald roll blir otillåten (t.ex. gruppen ändras) - inte relevant här
  // eftersom callerGroups är stabil, men lås rollen till "Personal" om
  // caller inte är super_user och håller på att bjuda in en ny person.
  const selectableGroups = ALL_GROUPS.filter(
    (g) => g === group || canInvite(callerGroups, g),
  )

  const nameError = validateName(name)
  const emailError = validateEmail(email)
  const phoneError = validatePhone(phone)
  const locationError = validateLocationId(group, locationId)
  const valid = !nameError && !emailError && !phoneError && !locationError

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !valid) return
    setError(null)
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        group,
        locationId: group === 'staff_user' ? locationId.trim() : '',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="staff-name">Namn</label>
            <input
              id="staff-name"
              value={name}
              placeholder="t.ex. Anna Svensson"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="staff-email">E-post</label>
            <input
              id="staff-email"
              type="email"
              value={email}
              placeholder="anna@kallarestaurang.se"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="staff-phone">Telefon</label>
            <input
              id="staff-phone"
              type="tel"
              value={phone}
              placeholder="+46701234567"
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="staff-role">Roll</label>
              <select
                id="staff-role"
                value={group}
                disabled={lockRole || selectableGroups.length <= 1}
                onChange={(e) => setGroup(e.target.value as CognitoGroup)}
              >
                {selectableGroups.map((g) => (
                  <option key={g} value={g}>
                    {ROLE_LABEL[g]}
                  </option>
                ))}
              </select>
              {lockRole && (
                <p className="cell-muted">Du kan inte ändra din egen roll.</p>
              )}
            </div>
            {group === 'staff_user' && (
              <div className="form-field">
                <label htmlFor="staff-location">Plats-ID</label>
                <input
                  id="staff-location"
                  value={locationId}
                  placeholder="t.ex. 154b5c59-..."
                  onChange={(e) => setLocationId(e.target.value)}
                />
              </div>
            )}
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn outline square" onClick={onCancel}>
              Avbryt
            </button>
            <button
              type="submit"
              className="btn primary square"
              disabled={!valid || busy}
            >
              {busy ? 'Sparar…' : initial ? 'Spara ändringar' : 'Skicka inbjudan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function roleToGroup(role: User['role']): CognitoGroup {
  if (role === 'staff') return 'staff_user'
  if (role === 'owner_user') return 'owner_user'
  return 'super_user'
}
