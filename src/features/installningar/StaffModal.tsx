import { errorText, focusErrorField } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { CognitoGroup, User } from './usersApi'
import {
  GROUP_LABEL,
  canInvite,
  validateEmail,
  validateLocationId,
  validateName,
  validatePhone,
} from './usersApi'
import { PhoneInput } from '../../shared/PhoneInput'

export interface StaffFormValues {
  name: string
  email: string
  phone: string
  group: CognitoGroup
  locationId: string
}

const ALL_GROUPS: CognitoGroup[] = ['staff_user', 'owner_user']

/**
 * Popup för att bjuda in eller redigera en användare i Personal & behörigheter.
 * Samma dialog för båda flödena, precis som DishModal i meny-vyn.
 *
 * `callerGroups` styr vilka roller som går att välja (speglar backendens
 * _authorize_invite/_authorize_target: ägare hanterar personal; fler ägare
 * läggs upp av plattformen). `lockRole` stängs av när man
 * redigerar sin egen rad - man får inte ändra sin egen roll.
 */
export function StaffModal({
  title,
  initial,
  callerGroups,
  lockRole,
  locations,
  defaultLocationId,
  onSave,
  onCancel,
}: {
  title: string
  initial: User | null
  callerGroups: string[]
  lockRole: boolean
  /** Restaurangens platser - personal kopplas till en av dem. */
  locations: { locationId: string; name: string }[]
  /** Förvald plats för nya inbjudningar (den som är vald i appen). */
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
  // Personal kopplas till en av restaurangens platser, vald bland deras
  // namn. En befintlig post behåller sin plats om den finns kvar; en post
  // som pekar på en borttagen plats får den valda platsen i stället.
  const knownIds = new Set(locations.map((l) => l.locationId))
  const [locationId, setLocationId] = useState(() => {
    if (initial?.locationId && knownIds.has(initial.locationId)) {
      return initial.locationId
    }
    return defaultLocationId ?? locations[0]?.locationId ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Bara roller caller får sätta (plus den nuvarande, så den syns).
  const selectableGroups = ALL_GROUPS.filter(
    (g) => g === group || canInvite(callerGroups, g),
  )

  const nameError = validateName(name)
  const emailError = validateEmail(email)
  const phoneError = validatePhone(phone)
  // Validera det värde som faktiskt skickas: ägare skickas alltid
  // med tomt Plats-ID (fältet är dolt då), så det förifyllda värdet som
  // ligger kvar i state efter ett rollbyte får inte spärra knappen.
  const effectiveLocationId = group === 'staff_user' ? locationId.trim() : ''
  const locationError = validateLocationId(group, effectiveLocationId)
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
        locationId: effectiveLocationId,
      })
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.'))
      focusErrorField(err, {
        name: 'staff-name', email: 'staff-email', phone: 'staff-phone', role: 'staff-role', locationId: 'staff-location',
      })
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
              placeholder="Förnamn Efternamn"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="staff-email">E-post</label>
            <input
              id="staff-email"
              type="email"
              value={email}
              placeholder="namn@domän.se"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="staff-phone">Telefon</label>
            <PhoneInput id="staff-phone" value={phone} onChange={setPhone} />
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
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
              {lockRole && (
                <p className="cell-muted">Du kan inte ändra din egen roll.</p>
              )}
            </div>
            {group === 'staff_user' && (
              <div className="form-field">
                <label htmlFor="staff-location">Plats</label>
                <select
                  id="staff-location"
                  value={locationId}
                  disabled={locations.length === 0}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  {locations.length === 0 && (
                    <option value="">Skapa en plats först</option>
                  )}
                  {locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.name}
                    </option>
                  ))}
                </select>
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
  return role === 'owner_user' ? 'owner_user' : 'staff_user'
}
