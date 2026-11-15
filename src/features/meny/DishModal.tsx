import { errorText, focusErrorField } from '../../shared/errors'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ALLERGENS, ALLERGEN_LABEL, categoryName } from './data'
import type { Allergen, Dish, DishCategory, DishComponent, MenuCategoryEntry, OptionGroup } from './data'
import { getRouting, NO_TICKET } from '../bestallningar/printApi'
import type { Station } from '../bestallningar/printApi'
import { parsePrice, validateDishName } from './menuApi'
import { ChangedNote } from '../../shared/ChangedNote'
import { serverChanges } from '../../shared/merge'
import { OptionsEditor } from './OptionsEditor'
import { draftToGroups, toDraft } from './menuForm'
import type { DraftGroup } from './menuForm'
import { utcToZonedInput, zonedInputToUtc } from './schedule'
import { DateTimeInput } from '../../shared/DateInput'
import { Icon } from '../../shared/Icon'
import { Slot } from '../../shared/slots'
import ModalOverlay from '../../shared/ModalOverlay'
import { ImageLightbox } from '../../shared/ImageLightbox'
import { FocusFrame } from './FocusFrame'
import { CENTRE, focusPosition, isCentre } from './imageFocus'
import type { ImageFocus } from './imageFocus'
import { ErrorNote } from '../../shared/ErrorNote'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Select } from '../../shared/Select'

export interface DishFormValues {
  name: string
  description: string
  category: DishCategory
  price: number
  active: boolean
  /** Innehåller alkohol - 25 % moms, kan bara beställas vid bordet. */
  alcohol: boolean
  /**
   * Nyvald bildfil att ladda upp till S3, eller null när bilden inte bytts.
   * Förhandsvisningen i dialogen är en lokal data-URL; den riktiga nyckeln
   * skapas av sidan via uploadMenuImage när rätten sparas.
   */
  imageFile: File | null
  /** Sant när den sparade bilden ska tas bort (rätten visas med platshållare). */
  removeImage: boolean
  /** Vilken del av bilden som syns i beskurna ramar; CENTRE = mitten. */
  imageFocus: ImageFocus
  /** Schemat i UTC ("...Z"), null = ingen gräns. */
  availableFrom: string | null
  availableUntil: string | null
  /** Bongens station, "none" = ingen bong, null = kategorins. */
  station: string | null
  /** Meny/combo: delarna (tomma namn är borttagna). */
  components: DishComponent[]
  allergens: Allergen[]
  options: OptionGroup[]
}

const GAP_ERROR =
  'Den tiden finns inte (klockan ställs fram en timme vid sommartid). Välj en annan tid.'

/**
 * Inmatat schemafält -> UTC. Oförändrat fält behåller det sparade värdet,
 * så en tid i höstens dubbeltimme eller med sekunder ändras inte av en
 * omöjlig tur-och-retur. undefined = tiden finns inte.
 */
function scheduleValue(
  input: string,
  initialInput: string,
  stored: string | null,
  timeZone: string,
): string | null | undefined {
  if (!input) return null
  if (input === initialInput) return stored
  return zonedInputToUtc(input, timeZone) ?? undefined
}

/**
 * Popup för att lägga till eller redigera en rätt: bild, namn, beskrivning,
 * kategori, pris och aktiv-status. Samma dialog för båda flödena.
 *
 * Bilden är frivillig för alla rätter (en dryck behöver ingen); utan bild
 * visas en neutral platshållare i listan och på sajten.
 */
export function DishModal({
  title,
  initial,
  timeZone,
  locationId = null,
  categories,
  onSave,
  onCancel,
  latest = null,
}: {
  title: string
  initial: Dish | null
  /** Platsens tidszon (IANA); schemat matas in och visas i den. */
  timeZone: string
  /** Platsen rätten hör till; behövs för planfunktionernas fält (Slot). */
  locationId?: string | null
  /** Platsens kategorier i visningsordning. */
  categories: MenuCategoryEntry[]
  onSave: (values: DishFormValues) => Promise<void>
  onCancel: () => void
  /**
   * Rätten som den ser ut på servern just nu (listan hämtas levande). Skiljer
   * den sig från `initial`, som formuläret öppnades med, har någon annan
   * ändrat den under tiden: fälten får en rad med det nya värdet, ditt står kvar.
   */
  latest?: Dish | null
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState<DishCategory>(
    initial?.category ??
      (categories.some((c) => c.categoryId === 'mains') ? 'mains' : categories[0]?.categoryId ?? 'mains'),
  )
  const [allergens, setAllergens] = useState<Allergen[]>(initial?.allergens ?? [])
  const [optionDrafts, setOptionDrafts] = useState<DraftGroup[]>(() => toDraft(initial?.options))
  const [removeImage, setRemoveImage] = useState(false)
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [alcohol, setAlcohol] = useState(initial?.alcohol ?? false)
  // Förhandsvisning: befintlig CDN-bild eller data-URL för nyvald fil.
  const [preview, setPreview] = useState<string | null>(initial?.image ?? null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageFocus, setImageFocus] = useState<ImageFocus>(initial?.imageFocus ?? CENTRE)
  const [zoomed, setZoomed] = useState(false)
  const [initialFrom] = useState(() => utcToZonedInput(initial?.availableFrom ?? null, timeZone))
  const [initialUntil] = useState(() => utcToZonedInput(initial?.availableUntil ?? null, timeZone))
  const [openedAt] = useState(() => Date.now())
  const [fromInput, setFromInput] = useState(initialFrom)
  const [untilInput, setUntilInput] = useState(initialUntil)
  // Schemat är ett tillval: stängt tills någon vill begränsa när rätten syns.
  const [scheduleOn, setScheduleOn] = useState(Boolean(initialFrom || initialUntil))
  const [station, setStation] = useState<string>(initial?.station ?? '')
  const [parts, setParts] = useState<DishComponent[]>(initial?.components ?? [])
  const [stations, setStations] = useState<Station[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Stationerna (Kök, Bar ...) för bongvalet; utan dem visas bara kategorins.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getRouting(locationId).then((r) => !cancelled && setStations(r.stations)).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [locationId])
  const fileRef = useRef<HTMLInputElement>(null)

  // Stäng med Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setRemoveImage(false)
    // ett nytt foto börjar i mitten
    setImageFocus(CENTRE)
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result))
    reader.readAsDataURL(file)
    // så att samma fil kan väljas igen efter ett byte
    e.target.value = ''
  }

  // "195", "129,50" och "129.50" går bra; "abc", "-10" och tre decimaler ger fel.
  const priceResult = parsePrice(price)
  const parsedPrice = priceResult.value ?? 0
  const priceError = priceResult.error
  const nameError = validateDishName(name)
  const optionsResult = draftToGroups(optionDrafts)
  const availableFrom = scheduleValue(fromInput, initialFrom, initial?.availableFrom ?? null, timeZone)
  const availableUntil = scheduleValue(untilInput, initialUntil, initial?.availableUntil ?? null, timeZone)
  const orderError =
    availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom)
      ? 'Slutet måste vara efter starten.'
      : null
  const scheduleWarning =
    !orderError && availableUntil && Date.parse(availableUntil) <= openedAt
      ? 'Sluttiden har redan passerat - rätten visas inte för gäster.'
      : null
  const scheduleValid = availableFrom !== undefined && availableUntil !== undefined && !orderError
  const valid = !nameError && !priceError && !optionsResult.error && scheduleValid
  // Ändrat på annat håll sedan dialogen öppnades (bara fält som skiljer sig från formuläret).
  const drift = initial ? serverChanges(initial, latest, ['name', 'description', 'price', 'category', 'active']) : {}
  const driftName = drift.name !== undefined && drift.name !== name.trim() ? drift.name : undefined
  const driftDescription = drift.description !== undefined && drift.description !== description.trim() ? drift.description : undefined
  const driftPrice = drift.price !== undefined && drift.price !== parsedPrice ? drift.price : undefined
  const driftCategory = drift.category !== undefined && drift.category !== category ? drift.category : undefined
  const driftActive = drift.active !== undefined && drift.active !== active ? drift.active : undefined

  async function save() {
    if (busy || !valid || availableFrom === undefined || availableUntil === undefined || !optionsResult.groups) return
    setError(null)
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category,
        price: parsedPrice,
        active,
        alcohol,
        imageFile,
        removeImage: removeImage && !imageFile,
        imageFocus,
        availableFrom,
        availableUntil,
        station: station || null,
        components: parts
          .map((p) => ({ name: p.name.trim(), ...(p.station ? { station: p.station } : {}) }))
          .filter((p) => p.name),
        allergens: ALLERGENS.filter((a) => allergens.includes(a)),
        options: optionsResult.groups,
      })
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.'))
      focusErrorField(err, {
        name: 'dish-name', description: 'dish-description', category: 'dish-category', price: 'dish-price',
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

        <div className="form-field">
          <label>Bild (frivilligt)</label>
          <div className="dish-upload">
            {preview ? (
              <FocusFrame
                src={preview}
                alt={name.trim() || 'Rättens bild'}
                focus={imageFocus}
                onChange={setImageFocus}
                onOpen={() => setZoomed(true)}
              />
            ) : (
              <span className="dish-placeholder large" aria-hidden="true">
                <Icon name="dish" size={30} />
              </span>
            )}
            <div className="dish-upload-actions">
              <div className="dish-upload-buttons">
                <button
                  type="button"
                  className="btn outline square"
                  data-help="meny:byt-bild"
                  onClick={() => fileRef.current?.click()}
                >
                  {preview ? 'Byt bild' : 'Ladda upp bild'}
                </button>
                {preview && (
                  <button
                    type="button"
                    className="btn outline square"
                    onClick={() => {
                      setPreview(null)
                      setImageFile(null)
                      setImageFocus(CENTRE)
                      setRemoveImage(Boolean(initial?.imageKey))
                    }}
                  >
                    Ta bort bild
                  </button>
                )}
                {preview && (
                  <button
                    type="button"
                    className="btn outline square"
                    data-help="meny:aterstall-bildfokus"
                    disabled={isCentre(imageFocus)}
                    onClick={() => setImageFocus(CENTRE)}
                  >
                    Återställ
                  </button>
                )}
              </div>
              {preview && (
                <div className="dish-focus-help">
                  <img
                    className="dish-focus-plate"
                    src={preview}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{ objectPosition: focusPosition(imageFocus) }}
                  />
                  <p className="dish-focus-hint">
                    Dra för att välja utsnitt.
                  </p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/avif,image/jpeg,image/png,image/webp"
                hidden
                onChange={onPickImage}
              />
            </div>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="dish-name">Namn</label>
          <input
            id="dish-name"
            value={name}
            placeholder="t.ex. Smörstekt Torskrygg"
            onChange={(e) => setName(e.target.value)}
          />
          {driftName !== undefined && <ChangedNote value={driftName} onUse={() => setName(driftName)} />}
        </div>

        <div className="form-field">
          <label htmlFor="dish-description">Beskrivning (frivilligt)</label>
          <input
            id="dish-description"
            value={description}
            placeholder="t.ex. Serveras med brynt smör och pepparrot"
            onChange={(e) => setDescription(e.target.value)}
          />
          {driftDescription !== undefined && (
            <ChangedNote value={driftDescription} onUse={() => setDescription(driftDescription)} />
          )}
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="dish-category">Kategori</label>
            <Select
              id="dish-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as DishCategory)}
            >
              {categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
              {!categories.some((c) => c.categoryId === category) && (
                <option value={category}>Övrigt</option>
              )}
            </Select>
            {driftCategory !== undefined && (
              <ChangedNote value={categoryName(categories, driftCategory)} onUse={() => setCategory(driftCategory)} />
            )}
          </div>
          <div className="form-field">
            <label htmlFor="dish-price">Pris (kr)</label>
            <input
              id="dish-price"
              inputMode="decimal"
              placeholder="t.ex. 195"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={price.trim() !== '' && priceError ? true : undefined}
              aria-describedby={price.trim() !== '' && priceError ? 'dish-price-error' : undefined}
            />
            {price.trim() !== '' && priceError && (
              <p id="dish-price-error" className="form-error">{priceError}</p>
            )}
            {driftPrice !== undefined && (
              <ChangedNote value={`${driftPrice.toLocaleString('sv-SE')} kr`} onUse={() => setPrice(String(driftPrice))} />
            )}
          </div>
        </div>
        {locationId && initial && (
          <Slot
            id="meny.dish.cost"
            props={{ locationId, menuItemId: initial.id, priceSek: parsedPrice, alcohol }}
          />
        )}

        <fieldset className="dish-allergens">
          <legend>Allergener</legend>
          <div className="meny-checks">
            {ALLERGENS.map((a) => (
              <label key={a} className="meny-check">
                <input
                  type="checkbox"
                  checked={allergens.includes(a)}
                  onChange={() =>
                    setAllergens((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
                  }
                />
                {ALLERGEN_LABEL[a]}
              </label>
            ))}
          </div>
        </fieldset>

        <OptionsEditor value={optionDrafts} onChange={setOptionDrafts} />
        {optionDrafts.length > 0 && optionsResult.error && (
          <p className="form-error">{optionsResult.error}</p>
        )}

        <div className="toggle-row">
          <span className="toggle-row-label">
            Aktiv
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label="Aktiv"
            className="switch"
            onClick={() => setActive((a) => !a)}
          />
        </div>
        {driftActive !== undefined && (
          <ChangedNote value={driftActive ? 'aktiv' : 'pausad'} onUse={() => setActive(driftActive)} />
        )}

        <div className="toggle-row">
          <span className="toggle-row-label">
            Innehåller alkohol
            <InfoTooltip label="Alkohol">25 % moms. Kan bara beställas vid bordet.</InfoTooltip>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={alcohol}
            aria-label="Innehåller alkohol"
            className="switch"
            onClick={() => setAlcohol((a) => !a)}
          />
        </div>

        <fieldset className="dish-ticket">
          <legend>
            Bong
            <InfoTooltip label="Meny eller combo">
              En meny eller combo delas upp: varje del får sin egen bong, till exempel burgare och pommes till köket och drycken till baren.
            </InfoTooltip>
          </legend>
          <div className="form-field">
            <label htmlFor="dish-station">Vart går rätten?</label>
            <Select id="dish-station" value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">Som kategorin {categoryName(categories, category).toLowerCase()}</option>
              {stations.map((s) => (
                <option key={s.stationId} value={s.stationId}>{s.name}</option>
              ))}
              <option value={NO_TICKET}>Ingen bong</option>
            </Select>
          </div>
          {parts.map((part, i) => (
            <div key={i} className="dish-part">
              <div className="form-field">
                <label htmlFor={`dish-part-${i}`}>Del {i + 1}</label>
                <input id={`dish-part-${i}`} value={part.name} maxLength={60} placeholder="Till exempel Pommes"
                  onChange={(e) => setParts((prev) => prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))} />
              </div>
              <div className="form-field">
                <label htmlFor={`dish-part-station-${i}`}>Bong</label>
                <Select id={`dish-part-station-${i}`} value={part.station ?? ''}
                  onChange={(e) => setParts((prev) => prev.map((p, j) => (j === i ? { ...p, station: e.target.value || null } : p)))}>
                  <option value="">Som rätten</option>
                  {stations.map((s) => (
                    <option key={s.stationId} value={s.stationId}>{s.name}</option>
                  ))}
                  <option value={NO_TICKET}>Ingen bong</option>
                </Select>
              </div>
              <button type="button" className="btn outline square" aria-label={`Ta bort del ${i + 1}`}
                onClick={() => setParts((prev) => prev.filter((_, j) => j !== i))}>
                Ta bort
              </button>
            </div>
          ))}
          {parts.length < 8 && (
            <button type="button" className="btn outline square dish-part-add"
              onClick={() => setParts((prev) => [...prev, { name: '' }])}>
              {parts.length ? 'Lägg till del' : 'Dela upp som meny/combo'}
            </button>
          )}
        </fieldset>

        <div className="toggle-row">
          <span className="toggle-row-label">
            Bara under en viss tid
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={scheduleOn}
            aria-controls={scheduleOn ? 'dish-schedule' : undefined}
            aria-label="Bara under en viss tid"
            className="switch"
            onClick={() => {
              // av = rätten syns hela tiden igen, så tiderna töms
              if (scheduleOn) {
                setFromInput('')
                setUntilInput('')
              }
              setScheduleOn((on) => !on)
            }}
          />
        </div>

        {scheduleOn && (
          <fieldset className="dish-schedule" id="dish-schedule">
            <legend className="sr-only">När rätten visas</legend>
            <div className="dish-schedule-help">
              Svensk tid
              <InfoTooltip label="Tider">
                Lämna en ruta tom för ingen gräns åt det hållet. Rätten är borta på till-tiden (till 14:00 = borta 14:00). Svensk tid ({timeZone}).
              </InfoTooltip>
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="dish-available-from">Visas från</label>
                <DateTimeInput
                  id="dish-available-from" timeLabel="Visas från, tid"
                  value={fromInput}
                  onChange={(e) => setFromInput(e.target.value)}
                  aria-invalid={availableFrom === undefined ? true : undefined}
                  aria-describedby={availableFrom === undefined ? 'dish-from-error' : undefined}
                />
                {availableFrom === undefined && (
                  <p id="dish-from-error" className="form-error">{GAP_ERROR}</p>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="dish-available-until">Visas till</label>
                <DateTimeInput
                  id="dish-available-until" timeLabel="Visas till, tid"
                  value={untilInput}
                  onChange={(e) => setUntilInput(e.target.value)}
                  aria-invalid={availableUntil === undefined || orderError ? true : undefined}
                  aria-describedby={
                    availableUntil === undefined || orderError ? 'dish-until-error' : undefined
                  }
                />
                {(availableUntil === undefined || orderError) && (
                  <p id="dish-until-error" className="form-error">
                    {availableUntil === undefined ? GAP_ERROR : orderError}
                  </p>
                )}
              </div>
            </div>
            {scheduleWarning && <p className="dish-schedule-warning">{scheduleWarning}</p>}
          </fieldset>
        )}

        {error && (
          <div className="dish-save-error">
            <ErrorNote text={error} />
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onCancel}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn primary square"
            disabled={!valid || busy}
            onClick={save}
          >
            {busy ? 'Sparar…' : initial ? 'Spara ändringar' : 'Lägg till rätt'}
          </button>
        </div>
      </div>
      {zoomed && preview && (
        <ImageLightbox src={preview} alt={name.trim() || 'Rättens bild'} onClose={() => setZoomed(false)} />
      )}
    </ModalOverlay>
  )
}
