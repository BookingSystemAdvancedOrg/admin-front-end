import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { ERRORS, draftsFromMenu } from './api'

/** Meny > rätt > "Dela": gör ett utkast av rätten och öppnar Marknadsföring > Inlägg. */
export default function ShareDishAction({ locationId, menuItemId }: { locationId: string; menuItemId: string }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function share() {
    setBusy(true)
    try {
      const { posts } = await draftsFromMenu(locationId, [menuItemId])
      if (!posts.length) {
        toast('Rätten behöver en bild, och drycker med alkohol delas inte automatiskt.', { tone: 'warning' })
        return
      }
      navigate(`/marknadsforing?flik=inlagg&inlagg=${encodeURIComponent(posts[0].postId)}`)
    } catch (err) {
      toast(errorText(err, 'Kunde inte skapa inlägget.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return <Button size="sm" variant="ghost" busy={busy} busyLabel="Skapar…" onClick={share}>Dela</Button>
}
