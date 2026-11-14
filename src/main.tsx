import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import '@booqy/brand/styles.css'
import './index.css'
import { installPress } from './shared/press'
import { installGlide } from './shared/glide'
import { installGlassFilter } from './shared/glassFilter'
import { installDesktopGlass } from './shared/desktopGlass'
import { startUpdateNotice } from './shared/updateNotice'
import { hasUnsaved } from './shared/unsaved'
import { installPwa } from './shared/pwa'
import App from './App.tsx'
import { AuthProvider } from './features/auth/AuthContext.tsx'
import { RequireAuth } from './features/auth/RequireAuth.tsx'
import LoginPage from './features/auth/LoginPage.tsx'
import NewPasswordPage from './features/auth/NewPasswordPage.tsx'
import ForgotPasswordPage from './features/auth/ForgotPasswordPage.tsx'
import ResetPasswordPage from './features/auth/ResetPasswordPage.tsx'
import CookiesPage from './features/cookies/CookiesPage.tsx'

// Top-level router. Only /logga-in, /nytt-losenord, the forgot-password
// pages (/glomt-losenord, /aterstall-losenord - the emailed reset link) and
// /cookies are reachable while signed out; everything else is the admin panel (App.tsx)
// and is gated by RequireAuth, which redirects signed-out visitors to
// /logga-in.
installPress()
installGlide()
installGlassFilter()
installDesktopGlass()
// "Ny version finns" efter en deploy (bara i bygget, inte i npm run dev).
// Osparade utkast (webbplats, bordskarta) frågas om innan omladdningen.
if (import.meta.env.PROD) startUpdateNotice({ hasUnsaved })
// Appen på telefonen: service worker och installationsknappen (bara i bygget).
if (import.meta.env.PROD) installPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/logga-in" element={<LoginPage />} />
          <Route path="/nytt-losenord" element={<NewPasswordPage />} />
          <Route path="/glomt-losenord" element={<ForgotPasswordPage />} />
          <Route path="/aterstall-losenord" element={<ResetPasswordPage />} />
          <Route path="/cookies" element={<CookiesPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <App />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
