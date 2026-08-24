import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './features/auth/AuthContext.tsx'
import { RequireAuth } from './features/auth/RequireAuth.tsx'
import LoginPage from './features/auth/LoginPage.tsx'
import NewPasswordPage from './features/auth/NewPasswordPage.tsx'

// Top-level router. Only /logga-in and /nytt-losenord are reachable while
// signed out; everything else is the admin panel (App.tsx) and is gated by
// RequireAuth, which redirects signed-out visitors to /logga-in.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/logga-in" element={<LoginPage />} />
          <Route path="/nytt-losenord" element={<NewPasswordPage />} />
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
