import { apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Bokföring (functions/accounting, bara ägare): kontoplanen per plats och
 * exporten av en verifikation per dag som SIE 4 eller CSV.
 * Utan API (VITE_API_BASE_URL osatt) körs allt på mockdata nedan.
 */

export const ACCOUNT_ROLES = [
  'sales25', 'sales12', 'sales6', 'vat25', 'vat12', 'vat6',
  'stripe', 'bank', 'receivables', 'advances',
  'cardFees', 'tips', 'refundsOwed', 'unclassified', 'rounding',
] as const

export type AccountRole = (typeof ACCOUNT_ROLES)[number]
export type Accounts = Record<AccountRole, string>

export interface AccountingSettings {
  accounts: Accounts
  defaults: Accounts
  /** BAS-namnet på standardkontot. */
  names: Accounts
  series: string
  fiscalYearStartMonth: number
  /** Kostnadsställe när flera restauranger delar Stripe-konto. */
  costCenter: string
  defaultCostCenter: string
  version: number
}

export type ExportFormat = 'sie' | 'csv'

export interface ExportWarning {
  date: string | null
  text: string
}

export interface ExportResult {
  from: string
  to: string
  format: ExportFormat
  filename: string
  mediaType: string
  /** base64 */
  content: string
  summary: {
    days: number
    bookedDays: number
    verifications: number
    /** Restaurangerna i filen (fler än en när de delar Stripe-konto). */
    locations: { locationId: string; name?: string | null }[]
    /** öre, exklusive moms */
    sales: number
    vat: number
    balanced: boolean
    warnings: ExportWarning[]
  }
}

const ACCOUNT = /^[1-8]\d{3}$/

/** Felet för ett kontonummer, eller null när det är giltigt. */
export function accountError(value: string): string | null {
  if (!value) return 'Fyll i ett kontonummer.'
  return ACCOUNT.test(value) ? null : 'Fyra siffror, 1000-8999.'
}

// --- mockdata --------------------------------------------------------------------

const DEFAULTS: Accounts = {
  sales25: '3001', sales12: '3002', sales6: '3003', vat25: '2611', vat12: '2621', vat6: '2631',
  stripe: '1580', bank: '1930', receivables: '1510', advances: '2420', cardFees: '6570',
  tips: '2890', refundsOwed: '2890', unclassified: '2999', rounding: '3740',
}

const NAMES: Accounts = {
  sales25: 'Försäljning inom Sverige, 25 % moms',
  sales12: 'Försäljning inom Sverige, 12 % moms',
  sales6: 'Försäljning inom Sverige, 6 % moms',
  vat25: 'Utgående moms på försäljning inom Sverige, 25 %',
  vat12: 'Utgående moms på försäljning inom Sverige, 12 %',
  vat6: 'Utgående moms på försäljning inom Sverige, 6 %',
  stripe: 'Fordringar för kontokort och kuponger',
  bank: 'Företagskonto/checkkonto/affärskonto',
  receivables: 'Kundfordringar',
  advances: 'Förskott från kunder',
  cardFees: 'Bankkostnader',
  tips: 'Övriga kortfristiga skulder',
  refundsOwed: 'Övriga kortfristiga skulder',
  unclassified: 'OBS-konto',
  rounding: 'Öres- och kronutjämning',
}

let mock: AccountingSettings = {
  accounts: { ...DEFAULTS }, defaults: DEFAULTS, names: NAMES, series: 'B', fiscalYearStartMonth: 1,
  costCenter: 'DEMO1', defaultCostCenter: 'DEMO1', version: 0,
}

function mockFile(from: string, to: string, format: ExportFormat): ExportResult {
  const text = format === 'sie'
    ? `#FLAGGA 0\r\n#FORMAT PC8\r\n#SIETYP 4\r\n#PROGRAM "Booqy" 1.0\r\n#FNAMN "Demo"\r\n`
    : `﻿Datum;Verifikation;Konto;Kontonamn;Debet;Kredit;Text\r\n`
  const bytes = new TextEncoder().encode(text)
  return {
    from, to, format,
    filename: `booqy-demo-${from}-${to}.${format === 'sie' ? 'se' : 'csv'}`,
    mediaType: format === 'sie' ? 'application/octet-stream' : 'text/csv; charset=utf-8',
    content: btoa(String.fromCharCode(...bytes)),
    summary: {
      days: 30, bookedDays: 26, verifications: 26, sales: 18_452_000, vat: 2_214_240, balanced: true,
      locations: [{ locationId: 'demo-1', name: 'Demo' }],
      warnings: [{ date: from, text: 'Stripe visar 1 250,00 kr i kortbetalningar, Booqy har bokat 1 200,00 kr: stäm av Stripe-avräkningen.' }],
    },
  }
}

// --- API -----------------------------------------------------------------------------

export async function getAccounting(locationId: string): Promise<AccountingSettings> {
  if (!isApiConfigured()) return structuredClone(mock)
  return apiFetch<AccountingSettings>(`/locations/${encodeURIComponent(locationId)}/accounting`)
}

export async function saveAccounting(
  locationId: string,
  body: { accounts: Accounts; series: string; fiscalYearStartMonth: number; costCenter: string; version: number },
): Promise<AccountingSettings> {
  if (!isApiConfigured()) {
    mock = { ...mock, ...body, version: mock.version + 1 }
    return structuredClone(mock)
  }
  return apiFetch<AccountingSettings>(`/locations/${encodeURIComponent(locationId)}/accounting`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function exportAccounting(
  locationId: string,
  from: string,
  to: string,
  format: ExportFormat,
): Promise<ExportResult> {
  if (!isApiConfigured()) return mockFile(from, to, format)
  const query = new URLSearchParams({ from, to, format })
  return apiFetch<ExportResult>(`/locations/${encodeURIComponent(locationId)}/accounting/export?${query}`)
}

/** Sparar filen i webbläsaren (base64 från API:t, bytes oförändrade: SIE är PC8). */
export function saveFile(result: ExportResult): void {
  const binary = atob(result.content)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mediaType }))
  const link = document.createElement('a')
  link.href = url
  link.download = result.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
