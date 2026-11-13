import { Navigate } from 'react-router-dom'
import { isDesktopShell } from '../../shared/desktopDownloads'

/**
 * Gamla länkar till /ladda-ner: i webbläsaren till kortet Skrivbordsappen,
 * i skrivbordsappen till startsidan (där finns ingen nedladdning).
 */
export function DownloadRedirect() {
  return <Navigate to={isDesktopShell() ? '/' : '/installningar#skrivbordsappen'} replace />
}
