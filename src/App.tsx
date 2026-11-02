import { lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminLayout } from './shared/AdminLayout'
import { pages } from './pages'

const OversiktPage = lazy(pages.oversikt)
const BokningarPage = lazy(pages.bokningar)
const BestallningarPage = lazy(pages.bestallningar)
const MenyPage = lazy(pages.meny)
const CateringkalkylPage = lazy(pages.cateringkalkyl)
const CateringPage = lazy(pages.catering)
const CateringRequestPage = lazy(pages.cateringRequest)
const LayoutEditorPage = lazy(pages.layout)
const InstallningarPage = lazy(pages.installningar)
const HjalpPage = lazy(pages.hjalp)
const MarknadsforingPage = lazy(pages.marknadsforing)
const StatistikPage = lazy(pages.statistik)
const AvtalPage = lazy(pages.avtal)
const TaBetaltPage = lazy(pages.tabetalt)
const KassaPage = lazy(pages.kassa)
const KassaManualPage = lazy(() => pages.kassaGuide().then((m) => ({ default: m.KassaManualPage })))
const PersonalliggarePage = lazy(pages.personalliggare)
const GasterPage = lazy(pages.gaster)
const PresentkortPage = lazy(pages.presentkort)
const WebbplatsPage = lazy(pages.webbplats)
const TelefonPage = lazy(pages.telefon)
const EvenemangPage = lazy(pages.evenemang)
const KassaPrintPage = lazy(() => pages.kassaGuide().then((m) => ({ default: m.KassaPrintPage })))


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
        <Route path="statistik" element={<StatistikPage />} />
        <Route path="bokningar" element={<BokningarPage />} />
        <Route path="bestallningar" element={<BestallningarPage />} />
        <Route path="ta-betalt" element={<TaBetaltPage />} />
        <Route path="kassa" element={<KassaPage />} />
        <Route path="kassa/bruksanvisning" element={<KassaManualPage />} />
        <Route path="kassa/utskrift/:kind" element={<KassaPrintPage />} />
        <Route path="meny" element={<MenyPage />} />
        <Route path="cateringkalkyl" element={<CateringkalkylPage />} />
        <Route path="catering" element={<CateringPage />} />
        <Route path="catering/:locationId/:requestId" element={<CateringRequestPage />} />
        <Route path="personalliggare" element={<PersonalliggarePage />} />
        <Route path="telefon" element={<TelefonPage />} />
        <Route path="telefon/samtal/:callId" element={<TelefonPage />} />
        <Route path="layout" element={<LayoutEditorPage />} />
        <Route path="gaster" element={<GasterPage />} />
        <Route path="presentkort" element={<PresentkortPage />} />
        <Route path="webbplats" element={<WebbplatsPage />} />
        <Route path="evenemang" element={<EvenemangPage />} />
        <Route path="evenemang/:eventId" element={<EvenemangPage />} />
        <Route path="evenemang/:eventId/inslapp/:occurrenceId" element={<EvenemangPage />} />
        <Route path="marknadsforing" element={<MarknadsforingPage />} />
        <Route path="installningar" element={<InstallningarPage />} />
        <Route path="hjalp" element={<HjalpPage />} />
        <Route path="avtal" element={<AvtalPage />} />
        <Route path="settings/payments" element={<StripeReturn />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
