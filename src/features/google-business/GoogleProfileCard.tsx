import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, Button, Card, Field, Select, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import {
  ERRORS,
  disconnect,
  finishConnect,
  getConnection,
  getLocationView,
  linkLocation,
  listGoogleLocations,
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

/** Inställningar > Profil: koppla Google, välj Google-plats, synka öppettider (Booqy styr). */
export default function GoogleProfileCard({ locationId }: { locationId: string }) {
  const [params, setParams] = useSearchParams()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [view, setView] = useState<LocationView | null>(null)
  const [places, setPlaces] = useState<GoogleLocation[] | null>(null)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const c = await getConnection()
      setConnection(c)
      const v = await getLocationView(locationId)
      setView(v)
      if (c.status === 'connected' && !v.link) setPlaces((await listGoogleLocations()).locations)
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta Google-profilen.', ERRORS))
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
    setParams(next, { replace: true })
    finishConnect(code, oauthState)
      .then(() => { toast('Google är kopplat. Välj vilken plats som är er restaurang.', { tone: 'success' }); return load() })
      .catch((err) => setError(errorText(err, 'Det gick inte att koppla Google.', ERRORS)))
  }, [params, setParams, load])

  async function run(name: string, fn: () => Promise<void>, fallback: string) {
    setBusy(name)
    try {
      await fn()
    } catch (err) {
      toast(errorText(err, fallback, ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const connect = () => run('connect', async () => {
    const { authorizeUrl } = await startConnect()
    window.location.assign(authorizeUrl)
  }, 'Det gick inte att starta kopplingen.')

  const link = () => run('link', async () => {
    await linkLocation(locationId, picked, view?.link?.version)
    toast('Kopplat. Öppettiderna skickas till Google inom en timme, eller tryck Synka nu.', { tone: 'success' })
    await load()
  }, 'Kunde inte koppla platsen.')

  const sync = () => run('sync', async () => {
    const result = await syncNow(locationId)
    toast(result.changed ? 'Öppettiderna är skickade till Google.' : 'Google har redan rätt öppettider.', { tone: 'success' })
    await load()
  }, 'Kunde inte synka.')

  const unlink = () => run('unlink', async () => {
    await unlinkLocation(locationId)
    await load()
  }, 'Kunde inte ta bort kopplingen.')

  const remove = () => run('disconnect', async () => {
    await disconnect()
    setPlaces(null)
    await load()
  }, 'Kunde inte koppla bort Google.')

  if (error) return <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng" action={<ErrorActions text={error} />}>{error}</Bar>
  if (!connection || !view) return null

  if (connection.status !== 'connected') {
    return (
      <Card title="Google-profil">
        <p>
          Koppla er Google-profil så visar Google samma öppettider och avvikande dagar som ni har i Booqy.
          Inga uppgifter om era gäster skickas till Google.
        </p>
        {connection.status === 'needs_reauth' ? (
          <Bar variant="banner" tone="warning">Kopplingen till Google har gått ut. Koppla igen.</Bar>
        ) : null}
        <Button busy={busy === 'connect'} busyLabel="Öppnar Google…" onClick={connect}>Koppla Google</Button>
      </Card>
    )
  }

  const free = (places ?? []).filter((p) => !p.linkedTo || p.linkedTo === locationId)
  return (
    <Card title="Google-profil" actions={<Button size="sm" variant="ghost" busy={busy === 'disconnect'} onClick={remove}>Koppla bort</Button>}>
      <Bar variant="banner" tone="info">Ändringar i Google skrivs över av Booqy. Ändra öppettiderna här i stället.</Bar>
      {view.link ? (
        <>
          <p className="google-status">
            <strong>{view.link.title}</strong>
            <span className="status-badge">{syncedText(view.link)}</span>
          </p>
          <Preview view={view} />
          <Bar variant="action" label="Google-plats">
            <Button type="button" variant="secondary" busy={busy === 'unlink'} onClick={unlink}>Byt plats</Button>
            <Button type="button" busy={busy === 'sync'} busyLabel="Synkar…" onClick={sync}>Synka nu</Button>
          </Bar>
        </>
      ) : (
        <>
          {places && free.length === 0 ? (
            <p className="admin-empty">Kontot har ingen ledig Google-plats. Skapa eller verifiera platsen hos Google först.</p>
          ) : null}
          <Field label="Vilken Google-plats är den här restaurangen?" required>
            <Select value={picked} required onChange={(e) => setPicked(e.target.value)}>
              <option value="">Välj</option>
              {free.map((p) => <option key={p.googleLocation} value={p.googleLocation}>{p.title}, {p.address}</option>)}
            </Select>
          </Field>
          <Preview view={view} />
          <Bar variant="action" label="Koppla Google-plats">
            <Button type="button" disabled={!picked} busy={busy === 'link'} busyLabel="Kopplar…" onClick={link}>Koppla platsen</Button>
          </Bar>
        </>
      )}
    </Card>
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
      <p className="cell-muted">Dagar utan onlinebokning och era anteckningar skickas inte till Google.</p>
    </div>
  )
}
