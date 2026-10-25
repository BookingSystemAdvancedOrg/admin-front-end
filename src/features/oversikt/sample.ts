import type { Reservation } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { RequestSummary } from '../catering/cateringApi'
import { SAMPLE_DATA_KEY } from '../../shared/storageRegistry'

/**
 * Exempeldata för Översikten: en fullsatt kväll på en påhittad restaurang,
 * så att en ny kund (eller den som visar Booqy) ser hur sidan ser ut när
 * den används. Visas bara när användaren själv valt det, alltid med en
 * stämpel som säger att det är exempel, och sparas aldrig till API:t.
 * Siffrorna sitter ihop: beställningarna summerar till dagens omsättning,
 * förfrågningarna och den misslyckade betalningen räknas i "Att hantera".
 */

/** Bordens namn i exemplet (riktiga ritningar har egna id:n). */
export const SAMPLE_TABLE_LABELS: ReadonlyMap<string, string> = new Map([
  ['sample-1', '1'],
  ['sample-2', '2'],
  ['sample-3', '3'],
  ['sample-5', '5'],
  ['sample-6', '6'],
  ['sample-8', '8'],
  ['sample-9', '9'],
  ['sample-11', '11'],
  ['sample-12', '12'],
])

/** Omsättningen samma tid förra veckan i exemplet (öre): dagens 9 405 kr är lite bättre. */
export const SAMPLE_REVENUE_LAST_WEEK = 812_000

export interface SampleData {
  today: Reservation[]
  orders: Order[]
  catering: RequestSummary[]
}

function reservation(
  n: number,
  date: string,
  startTime: string,
  endTime: string,
  partySize: number,
  customerName: string,
  tableIds: string[],
  status: Reservation['status'],
  extra: Partial<Reservation> = {},
): Reservation {
  return {
    reservationId: `sample-res-${n}`,
    locationId: 'sample',
    date,
    startTime,
    endTime,
    partySize,
    customerName,
    tableIds,
    status,
    source: 'online',
    ...extra,
  }
}

function order(
  n: number,
  status: Order['status'],
  mode: Order['mode'],
  totalAmount: number,
  lines: [string, number, number][],
  extra: Partial<Order> = {},
): Order {
  return {
    orderId: `sample-order-${n}`,
    locationId: 'sample',
    number: 140 + n,
    status,
    paymentStatus: 'paid',
    mode,
    totalAmount,
    lines: lines.map(([name, quantity, unitPrice], i) => ({
      menuItemId: `sample-item-${n}-${i}`,
      name,
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      vatRate: 12,
    })),
    ...extra,
  }
}

/** Exemplets dag: dagens datum (YYYY-MM-DD) så att listan heter "idag". */
export function sampleData(date: string): SampleData {
  const today: Reservation[] = [
    reservation(1, date, '11:30', '13:00', 2, 'Maria Lindqvist', ['sample-2'], 'arrived', { source: 'phone' }),
    reservation(2, date, '12:00', '13:30', 4, 'Johan Berg', ['sample-5'], 'arrived'),
    reservation(3, date, '12:15', '13:45', 3, 'Sara Nyström', ['sample-3'], 'reserved', { source: 'walk_in' }),
    reservation(4, date, '17:30', '19:30', 6, 'Familjen Ek', ['sample-8', 'sample-9'], 'reserved', { notes: 'Barnstol, en glutenfri' }),
    reservation(5, date, '18:00', '20:00', 2, 'Elin Sandberg', ['sample-1'], 'reserved', { cardOnFile: true }),
    reservation(6, date, '18:30', '20:30', 8, 'Nordic Byrå AB', ['sample-11', 'sample-12'], 'reserved', { cardOnFile: true }),
    reservation(7, date, '19:00', '21:00', 4, 'Omar Haddad', ['sample-6'], 'pending', { pendingExpiresAt: `${date}T19:00:00` }),
    reservation(8, date, '19:30', '21:30', 2, 'Anna och Per', ['sample-2'], 'reserved'),
    reservation(9, date, '20:00', '22:00', 5, 'Lisa Åkerlund', ['sample-5'], 'reserved', { source: 'phone' }),
    // Gårdagens uteblivna sällskap: debiteringen gick inte igenom.
    reservation(10, date, '20:30', '22:30', 4, 'Daniel Holm', ['sample-3'], 'no_show_charge_failed', {
      cardOnFile: true,
      payment: { kind: 'no_show', status: 'failed', amount: 40000, attempt: 2, error: 'card_declined' },
    }),
  ]

  const orders: Order[] = [
    order(1, 'completed', 'pickup', 38500, [['Lunch: Dagens fisk', 2, 14500], ['Mineralvatten', 2, 4750]]),
    order(2, 'completed', 'table', 52000, [['Pasta al limone', 2, 18500], ['Husets rött, glas', 2, 7500]], { tableLabel: '2' }),
    order(3, 'completed', 'pickup', 29000, [['Lunch: Vegetarisk', 2, 14500]]),
    order(4, 'completed', 'table', 97500, [['Grillad lax', 3, 24500], ['Sallad', 1, 9500], ['Kaffe', 3, 4500]], { tableLabel: '5' }),
    order(5, 'completed', 'pickup', 14500, [['Lunch: Dagens kött', 1, 14500]]),
    order(6, 'completed', 'table', 143000, [['Entrecôte', 4, 32500], ['Tryffelpommes', 2, 6500]], { tableLabel: '3' }),
    order(7, 'completed', 'pickup', 56000, [['Pizza Margherita', 2, 16500], ['Pizza Capricciosa', 1, 18500], ['Läsk', 1, 4500]]),
    order(8, 'completed', 'table', 68500, [['Räkor på toast', 2, 15500], ['Rosé, glas', 2, 8500], ['Chokladfondant', 2, 10250]], { tableLabel: '8' }),
    order(9, 'completed', 'pickup', 33000, [['Burgare & pommes', 2, 16500]]),
    order(10, 'completed', 'table', 171000, [['Trerätters meny', 4, 42750]], { tableLabel: '11' }),
    order(11, 'completed', 'pickup', 47500, [['Pad thai', 2, 15500], ['Vårrullar', 2, 8250]]),
    order(12, 'ready', 'pickup', 51500, [['Pizza Quattro Formaggi', 2, 18500], ['Tiramisu', 1, 14500]], { customerName: 'Hanna L.' }),
    order(13, 'preparing', 'table', 92500, [['Grillad lax', 2, 24500], ['Pasta al limone', 1, 18500], ['Husets vitt, flaska', 1, 25000]], { tableLabel: '6' }),
    order(14, 'confirmed', 'pickup', 46000, [['Burgare & pommes', 2, 16500], ['Milkshake', 2, 6500]], { customerName: 'Viktor S.' }),
    // Ännu inte betald: räknas varken i omsättningen eller som aktiv.
    order(15, 'pending_payment', 'pickup', 16500, [['Pizza Margherita', 1, 16500]], { paymentStatus: 'processing' }),
  ]

  const catering: RequestSummary[] = [
    {
      requestId: 'sample-cat-1',
      status: 'requested',
      customerType: 'company',
      customerName: 'Karin Öberg',
      companyName: 'Nordic Byrå AB',
      deliveryDate: date,
      deliveryTime: '11:30',
      fulfilment: 'delivery',
      createdAt: `${date}T08:12:00`,
      portions: 40,
    },
    {
      requestId: 'sample-cat-2',
      status: 'change_requested',
      customerType: 'private',
      customerName: 'Mats Pettersson',
      deliveryDate: date,
      deliveryTime: '16:00',
      fulfilment: 'pickup',
      createdAt: `${date}T09:40:00`,
      portions: 12,
      total: 1890000,
    },
    {
      requestId: 'sample-cat-3',
      status: 'offer_sent',
      customerType: 'company',
      customerName: 'Jonas Wiklund',
      companyName: 'Stadsteatern',
      deliveryDate: date,
      deliveryTime: '18:00',
      fulfilment: 'delivery',
      createdAt: `${date}T07:05:00`,
      portions: 60,
      total: 5400000,
    },
  ]

  return { today, orders, catering }
}

/* --- Valet att se exempel, sparat i webbläsaren ---------------------------- */

export function sampleModeOn(): boolean {
  try {
    return localStorage.getItem(SAMPLE_DATA_KEY) === '1'
  } catch {
    return false
  }
}

export function setSampleMode(on: boolean) {
  try {
    if (on) localStorage.setItem(SAMPLE_DATA_KEY, '1')
    else localStorage.removeItem(SAMPLE_DATA_KEY)
  } catch {
    /* privat läge utan lagring: valet gäller tills sidan laddas om */
  }
}
