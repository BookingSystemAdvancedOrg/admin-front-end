import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './shared/AdminLayout'
import OversiktPage from './features/oversikt/OversiktPage'
import BokningarPage from './features/bokningar/BokningarPage'
import MenyPage from './features/meny/MenyPage'
import LayoutEditorPage from './features/layout-editor/LayoutEditorPage'
import InstallningarPage from './features/installningar/InstallningarPage'

/**
 * Admin-panelen (skyddad av RequireAuth i main.tsx). AdminLayout ritar
 * sidebaren och lägger varje sida i <Outlet />; okända sökvägar skickas
 * tillbaka till översikten istället för att visa 404.
 */
function App() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<OversiktPage />} />
        <Route path="bokningar" element={<BokningarPage />} />
        <Route path="meny" element={<MenyPage />} />
        <Route path="layout" element={<LayoutEditorPage />} />
        <Route path="installningar" element={<InstallningarPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
