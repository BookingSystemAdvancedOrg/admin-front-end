import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Bar, Button, Card, Field, toast } from '@booqy/brand'
import { BrandSelect as Select } from '../../shared/Select'
import { errorText } from '../../shared/errors'
import {
  ERRORS,
  GUIDE_STEPS,
  disconnect,
  finishConnect,
  getConnection,
  getLocationView,
  linkLocation,
  listGoogleLocations,
  skipGoogle,
  specialLines,
  startConnect,
  syncNow,
  syncedText,
  unlinkLocation,
  weekLines,
  type Connection,
  type GoogleLocation,
  type LocationView,
} from './api'
import './google.css'
import { ErrorActions } from '../../shared/ErrorNote'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Disclosure } from '../../shared/Disclosure'
import { Icon } from '../../shared/Icon'
import { withBusy } from '../../shared/motion/busy'

/** Inställningar, Restaurangen, Google-profil: koppla Google (valfritt), välj Google-plats, synka öppettider (Booqy styr). */
export default function GoogleProfileCard({ locationId }: { locationId: string }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [view, setView] = useState<LocationView | null>(null)
  const [places, setPlaces] = useState<GoogleLocation[] | null>(null)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const c = await getConnection()
      setConnection(c)
      const v = await getLocationView(locationId)
      setView(v)
      if (c.status === 'connected' && !v.link && !v.skipped) setPlaces((await listGoogleLocations()).locations)
    } catch (err) {
      setError(errorText(err, 'Google-profilen kunde inte visas.', ERRORS))
    }
  }, [locationId])

  // Google skickar tillbaka hit med ?code=&state= efter inloggningen.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = params.get('code')
    const oauthState = params.get('state')
    if (!code || !oauthState || params.get('google') !== '1') {
      void load()
      return
    }
    const next = new URLSearchParams(params)
    for (const key of ['code', 'state', 'google', 'scope']) next.delete(key)
    // Grenen (#google) ligger kvar i adressen, annars visar Inställningar fältet.
    navigate({ search: next.size ? `?${next}` : '', hash: '#google' }, { replace: true })
    finishConnect(code, oauthState)
      .then(() => { toast('Google är kopplat. Välj er restaurang i listan.', { tone: 'success' }); return load() })
      .catch((err) => {
        // Felet visas i kortet, så att Vi har ingen Google-profil och hjälpen syns bredvid.
        setError(errorText(err, 'Google kopplades inte.', ERRORS))
        return load()
      })
  }, [params, navigate, load])

  // Kom igång länkar hit (#google): kortet rullas fram när det har laddat.
  const ready = Boolean(connection && view)
  useEffect(() => {
    if (hash !== '#google' || !ready) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ref.current?.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' })
  }, [hash, ready])

  async function run(name: string, fn: () => Promise<void>, fallback: string) {
    setBusy(name)
    try {
      await withBusy(fn)
    } catch (err) {
      toast(errorText(err, fallback, ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const connect = () => run('connect', async () => {
    const { authorizeUrl } = await startConnect()
    window.location.assign(authorizeUrl)
  }, 'Google gick inte att öppna.')

  const link = () => run('link', async () => {
    await linkLocation(locationId, picked, view?.link?.version)
    toast('Klart! Öppettiderna skickas till Google inom en timme, eller tryck Synka nu.', { tone: 'success' })
    await load()
  }, 'Platsen kopplades inte.')

  const sync = () => run('sync', async () => {
    const result = await syncNow(locationId)
    toast(result.changed ? 'Öppettiderna är skickade till Google.' : 'Google har redan rätt öppettider.', { tone: 'success' })
    await load()
  }, 'Uppdateringen till Google gick inte.')

  const unlink = () => run('unlink', async () => {
    await unlinkLocation(locationId)
    await load()
  }, 'Kopplingen togs inte bort.')

  const remove = () => run('disconnect', async () => {
    await disconnect()
    setPlaces(null)
    await load()
  }, 'Google kopplades inte bort.')

  const skip = () => run('skip', async () => {
    await skipGoogle(locationId)
    setPlaces(null)
    await load()
  }, 'Valet sparades inte.')

  // Ångra hoppa över: samma anrop som tar bort en koppling.
  const unskip = () => run('unskip', async () => {
    await unlinkLocation(locationId)
    await load()
  }, 'Valet ändrades inte.')

  const wrap = (body: ReactElement) => <div id="google" ref={ref} className="google-card">{body}</div>
  const banner = error
    ? <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng" action={<ErrorActions text={error} />}>{error}</Bar>
    : null

  // Kortet kunde inte laddas alls: bara felet.
  if (!connection || !view) return banner ? wrap(banner) : null

  const skipLink = (
    <p className="google-skip">
      <button type="button" className="link-action" disabled={busy !== null} onClick={skip}>Vi har ingen Google-profil</button>
    </p>
  )

  if (view.skipped && !view.link) {
    return wrap(
      <Card className="google-skipped">
        {banner}
        <div className="google-skipped__line">
          <span className="google-skipped__text">
            <Icon name="globe" size={18} />
            Google är inte kopplat.
          </span>
          <Button size="sm" variant="secondary" busy={busy === 'unskip'} onClick={unskip}>Koppla Google ändå</Button>
        </div>
        <p className="google-skipped__hint">
          Vill ni synas på Google Maps?{' '}
          <a href="https://business.google.com" target="_blank" rel="noreferrer">Skapa en gratis profil</a>
        </p>
        {connection.status === 'connected' ? (
          <p className="google-skipped__hint">
            <button type="button" className="link-action" disabled={busy !== null} onClick={remove}>Koppla bort Google</button>
          </p>
        ) : null}
      </Card>,
    )
  }

  if (connection.status !== 'connected') {
    return wrap(
      <Card title="Google-profil (valfritt)" actions={
        <InfoTooltip label="Google-profil">
          Google visar samma öppettider och avvikande dagar som ni har i Booqy. Inga uppgifter om era gäster skickas till Google.
        </InfoTooltip>
      }>
        {banner}
        {connection.status === 'needs_reauth' ? (
          <Bar variant="banner" tone="warning">Kopplingen till Google har gått ut. Gör om steg 1-5.</Bar>
        ) : null}
        <Guide current={0} />
        <Bar variant="action" label="Koppla Google">
          <Button type="button" variant="primary" busy={busy === 'connect'} busyLabel="Öppnar Google…" onClick={connect}>Koppla Google</Button>
        </Bar>
        {view.link ? null : skipLink}
        <Help connected={false} />
      </Card>,
    )
  }

  const free = (places ?? []).filter((p) => !p.linkedTo || p.linkedTo === locationId)
  return wrap(
    <Card title="Google-profil" actions={<Button size="sm" variant="ghost" busy={busy === 'disconnect'} onClick={remove}>Koppla bort</Button>}>
      {banner}
      <Bar variant="banner" tone="info">Ändra öppettiderna här, inte i Google.</Bar>
      {view.link ? (
        <>
          <p className="google-status">
            <strong>{view.link.title}</strong>
            <span className="status-badge">{syncedText(view.link)}</span>
          </p>
          <div className="google-link-row">
            <Preview view={view} />
            <div className="google-link-actions">
              <Bar variant="action" label="Google-plats">
                <Button type="button" variant="secondary" busy={busy === 'unlink'} onClick={unlink}>Byt plats</Button>
                <Button type="button" variant="primary" busy={busy === 'sync'} busyLabel="Synkar…" onClick={sync}>Synka nu</Button>
              </Bar>
            </div>
          </div>
        </>
      ) : (
        <>
          <Guide current={picked ? 4 : 3} />
          {places && free.length === 0 ? (
            <p className="admin-empty">Ert Google-konto har ingen restaurang att välja. Öppna Fungerade det inte? här nedanför. Eller tryck på Hoppa över.</p>
          ) : null}
          <Field label="Vilken Google-plats är den här restaurangen?" required>
            <Select value={picked} required onChange={(e) => setPicked(e.target.value)}>
              <option value="">Välj</option>
              {free.map((p) => <option key={p.googleLocation} value={p.googleLocation}>{p.title}, {p.address}</option>)}
            </Select>
          </Field>
          <div className="google-link-row">
            <Preview view={view} />
            <div className="google-link-actions">
              <Bar variant="action" label="Koppla Google-plats">
                <Button type="button" variant="primary" disabled={!picked} busy={busy === 'link'} busyLabel="Kopplar…" onClick={link}>Koppla platsen</Button>
              </Bar>
              <p className="google-skip">
                <button type="button" className="link-action" disabled={busy !== null} onClick={skip}>Hoppa över</button>
              </p>
            </div>
          </div>
          <Help connected />
        </>
      )}
    </Card>,
  )
}

/** Steg 1-5; de före `current` är klara, `current` är där ägaren är nu. */
function Guide({ current }: { current: number }) {
  return (
    <ol className="google-guide" aria-label="Så kopplar ni Google">
      {GUIDE_STEPS.map((text, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : 'next'
        return (
          <li key={i} className={`google-guide__step is-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="google-guide__n" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={16} /> : i + 1}
            </span>
            <span className="google-guide__text">
              {state === 'done' ? <span className="sr-only">Klart: </span> : null}
              {text}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Help({ connected }: { connected: boolean }) {
  return (
    <Disclosure title="Fungerade det inte?" className="google-help">
      <h3>Fel Google-konto</h3>
      <p>
        På Googles sida: tryck på kontot högst upp och välj Använd ett annat konto. Logga in med kontot som äger
        restaurangens Google-profil.
      </p>
      <h3>Restaurangen finns inte i listan</h3>
      <p>
        Kontot ni valde är inte ägare eller administratör för profilen. Be den som äger profilen att lägga till er:
        Google Maps eller business.google.com, välj profilen, Personer och åtkomst, Lägg till.
      </p>
      <p>Öppna mejlet från Google och tryck på Acceptera. Koppla sedan Google igen.</p>
      <p>Har ni ingen Google-profil? Tryck på Vi har ingen Google-profil.</p>
      <h3>Google har inte verifierat appen</h3>
      <p>Booqys app väntar på Googles godkännande. Tryck på Avancerat och sedan på Gå till Booqy (osäkert). Det är säkert.</p>
      {connected ? (
        <>
          <h3>Koppla bort</h3>
          <p>Tryck på Koppla bort uppe till höger i kortet. Booqy slutar då ändra era öppettider i Google.</p>
        </>
      ) : null}
    </Disclosure>
  )
}

function Preview({ view }: { view: LocationView }) {
  const special = specialLines(view.preview)
  return (
    <div className="google-preview">
      <h3>Det här visar Google</h3>
      <dl className="google-hours">
        {weekLines(view.preview).map((l) => (
          <div key={l.day}><dt>{l.day}</dt><dd>{l.text}</dd></div>
        ))}
      </dl>
      {special.length ? (
        <>
          <h4>Avvikande dagar</h4>
          <dl className="google-hours">
            {special.map((l) => <div key={l.date}><dt>{l.date}</dt><dd>{l.text}</dd></div>)}
          </dl>
        </>
      ) : null}
    </div>
  )
}
