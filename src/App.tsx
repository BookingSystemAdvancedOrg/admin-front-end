import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminLayout } from './shared/AdminLayout'
import OversiktPage from './features/oversikt/OversiktPage'
import BokningarPage from './features/bokningar/BokningarPage'
import BestallningarPage from './features/bestallningar/BestallningarPage'
import MenyPage from './features/meny/MenyPage'
import CateringkalkylPage from './features/cateringkalkyl/CateringkalkylPage'
import CateringPage from './features/catering/CateringPage'
import CateringRequestPage from './features/catering/CateringRequestPage'
import LayoutEditorPage from './features/layout-editor/LayoutEditorPage'
import InstallningarPage from './features/installningar/InstallningarPage'
import HjalpPage from './features/guide/HjalpPage'
import MarknadsforingPage from './features/marknadsforing/MarknadsforingPage'

/**
 * Stripe skickar tillbaka ägaren hit efter onboardingen (return/refresh-URL:er
 * som backend bygger: ADMIN_APP_URL/settings/payments?stripe=return|refresh).
 * Frågesträngen följer med till Inställningar, som visar resultatet.
 */
function StripeReturn() {
  const { search } = useLocation()
  return <Navigate to={`/installningar${search}#betalningar`} replace />
}

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
        <Route path="bestallningar" element={<BestallningarPage />} />
        <Route path="meny" element={<MenyPage />} />
        <Route path="cateringkalkyl" element={<CateringkalkylPage />} />
        <Route path="catering" element={<CateringPage />} />
        <Route path="catering/:locationId/:requestId" element={<CateringRequestPage />} />
        <Route path="layout" element={<LayoutEditorPage />} />
        <Route path="marknadsforing" element={<MarknadsforingPage />} />
        <Route path="installningar" element={<InstallningarPage />} />
        <Route path="hjalp" element={<HjalpPage />} />
        <Route path="settings/payments" element={<StripeReturn />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
