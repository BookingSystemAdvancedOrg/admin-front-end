import { apiFetch, isApiConfigured } from './api'
import type { ErrorInfo } from './errors'
import { withBusy } from './motion/busy'

/**
 * Rapportera till Booqy: ett klick i felrutan när felet ligger hos oss.
 * Skickar bara det som hjälper oss hitta felet: felkoden, HTTP-status,
 * sidans sökväg (utan frågesträng och #, där en återställningskod eller
 * sökning kan stå), API:ts request id och appens version. Aldrig texten
 * användaren skrivit, formulärets innehåll, tokens eller felets egen text.
 * Restaurang, användare, tid och webbläsare lägger servern till själv
 * (POST /tenant/support/reports, functions/support-reports).
 */

export interface SupportReport {
  code: string
  status: number
  path: string
  requestId?: string
  appVersion?: string
}

const CODE = /^[a-z][a-z0-9_]{0,63}$/

/** Appens version: hashen i huvudskriptets filnamn (index-<hash>.js), annars "dev". */
export function appVersion(doc: Document = document): string {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
  for (const s of scripts) {
    const m = /\/index-([A-Za-z0-9_-]{4,32})\.js(?:$|\?)/.exec(s.getAttribute('src') ?? '')
    if (m) return m[1]
  }
  return 'dev'
}

export function reportPayload(info: ErrorInfo, pathname: string = window.location.pathname): SupportReport {
  const code = info.code.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '') || 'unknown'
  const path = (pathname.split(/[?#]/)[0] || '/').slice(0, 200)
  return {
    code: CODE.test(code) ? code : 'unknown',
    status: Number.isInteger(info.status) && info.status >= 0 && info.status <= 599 ? info.status : 0,
    path: path.startsWith('/') ? path : `/${path}`,
    ...(info.requestId ? { requestId: info.requestId } : {}),
    appVersion: appVersion(),
  }
}

export type ReportResult = 'sent' | 'duplicate'

export async function sendReport(info: ErrorInfo): Promise<ReportResult> {
  const payload = reportPayload(info)
  if (!isApiConfigured()) {
    // Mockläget: inget skickas, men knappen beter sig som i drift.
    await withBusy(() => new Promise((resolve) => setTimeout(resolve, 600)))
    return 'sent'
  }
  const res = await apiFetch<{ reportId: string | null; duplicate: boolean }>('/tenant/support/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.duplicate ? 'duplicate' : 'sent'
}
