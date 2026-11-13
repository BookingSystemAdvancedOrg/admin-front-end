import { AdminTopbar } from '../../shared/AdminTopbar'
import { DesktopAppCard } from './DesktopAppCard'

/** /ladda-ner: skrivbordsappen (sidomenyns "Ladda ner appen", bara i webbläsaren). */
export default function LaddaNerPage() {
  return (
    <>
      <AdminTopbar title="Ladda ner appen" subtitle="Booqy Admin för Mac, Windows och Linux" />
      <div className="admin-main">
        <div className="desktop-page">
          <DesktopAppCard heading={false} />
        </div>
      </div>
    </>
  )
}
