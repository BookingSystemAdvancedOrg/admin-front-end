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
import ModalOverlay from '../../shared/ModalOverlay'
import { ErrorNote } from '../../shared/ErrorNote'
import { Select } from '../../shared/Select'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { AreaChecklist } from '../../shared/AreaChecklist'
import { personSource, togglePerson } from '../../shared/access'
import type { StaffAccessConfig, StaffAccessPerson } from '../../shared/access'
import type { Tenant } from '../../shared/tenant'
import { useDirtyForm } from '../../shared/dirtyForm'

export interface StaffFormValues {
  name: string
  email: string
  phone: string
  group: CognitoGroup
  locationId: string
  /** Personens egna behörigheter, bara om ägaren ändrade dem. */
  access?: StaffAccessPerson
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
  tenant = null,
  access = null,
  lockRole,
  locations,
  defaultLocationId,
  onSave,
  onCancel,
}: {
  title: string
  initial: User | null
  callerGroups: string[]
  /** Planens funktioner (vilka områden som visas). */
  tenant?: Pick<Tenant, 'entitlements'> | null
  /** Ägaren redigerar en medarbetare: gruppens och personernas behörigheter. */
  access?: StaffAccessConfig | null
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
  const personSub = initial?.cognitoSub ?? ''
  const savedPerson: StaffAccessPerson = access?.users[personSub] ?? { add: [], remove: [] }
  const [person, setPerson] = useState<StaffAccessPerson>(savedPerson)
  const draftConfig = access ? { defaults: access.defaults, users: { ...access.users, [personSub]: person } } : null
  const accessChanged =
    person.add.join() !== savedPerson.add.join() || person.remove.join() !== savedPerson.remove.join()

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
  // Spara är avstängd tills något skiljer sig från det som gällde när dialogen öppnades.
  const [opened] = useState(() => ({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    group: initial ? roleToGroup(initial.role) : 'staff_user',
    locationId: initial ? (roleToGroup(initial.role) === 'staff_user' ? (initial.locationId ?? '') : '') : effectiveLocationId,
    person: savedPerson,
  }))
  const dirty = useDirtyForm(
    { name, email, phone, group, locationId: effectiveLocationId, person: group === 'staff_user' ? person : savedPerson },
    opened,
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !valid || !dirty) return
    setError(null)
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        group,
        locationId: effectiveLocationId,
        ...(access && accessChanged && group === 'staff_user' ? { access: person } : {}),
      })
    } catch (err) {
      setError(errorText(err, 'Användaren sparades inte.'))
      focusErrorField(err, {
        name: 'staff-name', email: 'staff-email', phone: 'staff-phone', role: 'staff-role', locationId: 'staff-location',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalOverlay
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
              <Select
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
              </Select>
              {lockRole ? (
                <p className="cell-muted">Du kan inte ändra din egen roll.</p>
              ) : (
                selectableGroups.length <= 1 && <p className="cell-muted">Fler ägare läggs till av Booqy.</p>
              )}
            </div>
            {group === 'staff_user' && (
              <div className="form-field">
                <label htmlFor="staff-location">Plats</label>
                <Select
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
                </Select>
              </div>
            )}
          </div>

          {draftConfig && group === 'staff_user' && (
            <fieldset className="staff-access">
              <legend className="title-info">
                <span>Behörigheter</span>
                <InfoTooltip label="Behörigheter">
                  Gruppen: det all personal får (Inställningar, Personal, Behörigheter). Extra: bara den här personen. Borttagen:
                  gruppens, men inte för den här personen.
                </InfoTooltip>
              </legend>
              <AreaChecklist
                tenant={tenant}
                idPrefix="person-area"
                checked={(area) => {
                  const s = personSource(draftConfig, personSub, area)
                  return s === 'group' || s === 'own'
                }}
                source={(area) => personSource(draftConfig, personSub, area)}
                disabled={busy}
                onChange={(area, on) => setPerson(togglePerson(draftConfig, personSub, area, on))}
              />
            </fieldset>
          )}

          {error && (
            <ErrorNote text={error} />
          )}

          <div className="modal-actions">
            <button type="button" className="btn outline square" onClick={onCancel}>
              Avbryt
            </button>
            <button
              type="submit"
              className="btn primary square"
              disabled={!valid || busy || !dirty}
            >
              {busy ? 'Sparar…' : initial ? (error ? 'Spara igen' : 'Spara ändringar') : 'Skicka inbjudan'}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  )
}

function roleToGroup(role: User['role']): CognitoGroup {
  return role === 'owner_user' ? 'owner_user' : 'staff_user'
}
