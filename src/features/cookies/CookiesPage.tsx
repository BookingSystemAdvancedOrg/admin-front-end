import { Link } from 'react-router-dom'
import { AuthLayout } from '../auth/AuthLayout'
import { STORAGE_REGISTRY } from '../../shared/storageRegistry'
import type { StorageKind } from '../../shared/storageRegistry'
import './cookies.css'

const KIND_LABEL: Record<StorageKind, string> = {
  cookie: 'Cookie',
  localStorage: 'Lokal lagring',
  sessionStorage: 'Sessionslagring',
}

/**
 * Cookies och lagring i Booqy Admin. Nåbar utan inloggning (länkad från
 * inloggningssidan och Hjälp). Innehållet kommer från storageRegistry.ts,
 * samma lista som koden använder, så sidan kan inte glida isär från appen.
 */
export default function CookiesPage() {
  return (
    <AuthLayout>
      <div className="auth-heading">
        <h1>Cookies och lagring</h1>
        <p>
          Booqy Admin använder inga cookies för statistik eller marknadsföring. Det som sparas i
          din webbläsare behövs för att appen ska fungera, därför frågar vi inte om samtycke.
        </p>
      </div>

      <ul className="cookie-list">
        {STORAGE_REGISTRY.map((entry) => (
          <li key={entry.name} className="cookie-item">
            <div className="cookie-item-head">
              <code>{entry.name}</code>
              <span className="status-badge">{KIND_LABEL[entry.kind]}</span>
            </div>
            <p>{entry.purpose}</p>
            <dl>
              <div>
                <dt>Sätts av</dt>
                <dd>{entry.setBy}</dd>
              </div>
              <div>
                <dt>Sparas</dt>
                <dd>{entry.lifetime}</dd>
              </div>
              <div>
                <dt>Typ</dt>
                <dd>Nödvändig</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <p className="auth-hint">
        Inloggningsuppgifter sparas aldrig i webbläsarens lagring. Rensar du webbläsarens cookies
        loggas du ut; rensar du övrig lagring glömmer appen vald plats.
      </p>

      <Link className="auth-link" to="/">
        Tillbaka
      </Link>
    </AuthLayout>
  )
}
