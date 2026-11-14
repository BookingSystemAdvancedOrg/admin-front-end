import { useState } from 'react'
import { Icon } from './Icon'
import { showDownloadNav } from './desktopDownloads'
import { APP_HINT_KEY } from './storageRegistry'

/**
 * Tipset om skrivbordsappen (den ser skrivbordet genom glaset, en webbsida
 * kan inte). Visas bara i en webbläsare på en dator, i flödet längst ned i
 * sidomenyn under "Ladda ner appen" (som är länken), aldrig svävande över
 * innehållet, tills man stänger det. En rad, och dolt i låga fönster så att
 * Logga ut alltid syns utan att rulla sidomenyn.
 */
function dismissed(): boolean {
  try {
    return localStorage.getItem(APP_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function shouldShowDesktopHint(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  // Aldrig i skrivbordsappen (också med minskad genomskinlighet) och bara på en dator.
  return showDownloadNav() && !dismissed()
}

function dismissDesktopHint(): void {
  try {
    localStorage.setItem(APP_HINT_KEY, '1')
  } catch {
    // utan lagring syns tipset igen nästa gång
  }
}

/** Liten glaslapp längst ned i sidomenyn, i flödet: täcker aldrig något. */
export function DesktopHint() {
  const [show, setShow] = useState(shouldShowDesktopHint)
  if (!show) return null
  const hide = () => {
    dismissDesktopHint()
    setShow(false)
  }
  return (
    <div className="admin-app-hint" role="note">
      <p>Appen ser genom glaset.</p>
      <button type="button" className="admin-app-hint-close" aria-label="Stäng tipset" onClick={hide}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
