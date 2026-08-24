/**
 * MOCKDATA — ersätts med backend-anrop när API:t är på plats:
 *   const reservations = await apiFetch<Reservation[]>('/reservations')
 * (se src/shared/api.ts och docs/BACKEND-KOPPLING.md)
 */

export type ReservationStatus =
  | 'reserved'
  | 'waiting'
  | 'arrived'
  | 'noshow-charged'
  | 'cancelled-charged'
  | 'cancelled'

export interface Reservation {
  id: string
  customer: string
  dateLabel: string
  table: string
  guests: number
  /** Debiterad avgift i kr; null = ingen avgift. */
  amount: number | null
  status: ReservationStatus
  phone: string
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  reserved: 'Reserverad',
  waiting: 'Väntar',
  arrived: 'Anlänt',
  'noshow-charged': 'Uteblev (debiterad)',
  'cancelled-charged': 'Avbokad (debiterad)',
  cancelled: 'Avbokad',
}

export const STATUS_CLASS: Record<ReservationStatus, string> = {
  reserved: 'reserved',
  waiting: 'waiting',
  arrived: 'arrived',
  'noshow-charged': 'noshow',
  'cancelled-charged': 'cancelled-charged',
  cancelled: 'cancelled-free',
}

export const MOCK_RESERVATIONS: Reservation[] = [
  {
    id: 'KL-48213',
    customer: 'Erik Lindqvist',
    dateLabel: '17 aug · 18:30',
    table: 'Bord 3',
    guests: 2,
    amount: null,
    status: 'reserved',
    phone: '070 123 45 67',
  },
  {
    id: 'KL-48214',
    customer: 'Sofia Bergman',
    dateLabel: '17 aug · 19:00',
    table: 'Bord 8',
    guests: 6,
    amount: null,
    status: 'waiting',
    phone: '073 555 12 34',
  },
  {
    id: 'KL-48201',
    customer: 'Johan Åkesson',
    dateLabel: '16 aug · 20:00',
    table: 'Bord 5',
    guests: 4,
    amount: null,
    status: 'arrived',
    phone: '076 222 98 11',
  },
  {
    id: 'KL-48188',
    customer: 'Maria Holm',
    dateLabel: '15 aug · 18:00',
    table: 'Bord 1',
    guests: 2,
    amount: 450,
    status: 'noshow-charged',
    phone: '072 888 44 20',
  },
  {
    id: 'KL-48172',
    customer: 'Anders Berg',
    dateLabel: '14 aug · 19:30',
    table: 'Bord 4',
    guests: 3,
    amount: 300,
    status: 'cancelled-charged',
    phone: '070 333 21 09',
  },
  {
    id: 'KL-48169',
    customer: 'Lisa Nyström',
    dateLabel: '13 aug · 17:30',
    table: 'Bord 7',
    guests: 5,
    amount: 0,
    status: 'cancelled',
    phone: '076 444 77 65',
  },
]
