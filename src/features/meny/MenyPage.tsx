import { AdminTopbar } from '../../shared/AdminTopbar'

/** Figma: admin-meny-page — implementeras härnäst. */
export default function MenyPage() {
  return (
    <>
      <AdminTopbar title="Meny" />
      <div className="admin-main">
        <div className="admin-card admin-empty">
          Menyhanteringen byggs härnäst (Figma: admin-meny-page).
        </div>
      </div>
    </>
  )
}
