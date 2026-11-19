/** Table orders (staff take orders at the table): shared contract, spec section 13.1. */

export type Course = 'drinks' | 'starters' | 'mains' | 'desserts' | 'other'
export type ItemState = 'held' | 'sent' | 'void'
export type TabStatus = 'open' | 'closed'
export type RoundKind = 'order' | 'fire' | 'void' | 'move'
export type VoidReason = 'wrong' | 'guest_changed' | 'other'
export type TicketStatus = 'sent' | 'preparing' | 'ready' | 'cancelled'

export interface TabOption { group: string; choice: string }

export interface TabItem {
  itemId: string
  menuItemId: string
  name: string
  /** öre, options included */
  unitPrice: number
  quantity: number
  options: TabOption[]
  note?: string
  allergy?: boolean
  course: Course
  stationId: string | null
  stationName: string | null
  state: ItemState
  round?: number
  addedAt: string
  addedByName: string
  voidedAt?: string
  voidedByName?: string
  voidReason?: VoidReason | 'before_send' | 'closed'
}

export interface RoundTicket { stationId: string; stationName: string; status: TicketStatus }

export interface TabRound {
  round: number
  kind: RoundKind
  at: string
  byName: string
  courses: Course[]
  itemIds: string[]
  dispatched: boolean
  stations: { stationId: string; stationName: string; printers: number; fallback: boolean }[]
  tickets?: RoundTicket[]
  fromLabel?: string
  toLabel?: string
}

export interface TabHistoryEntry { action: string; at: string; byName: string }

export interface Tab {
  tabId: string
  status: TabStatus
  tableId: string
  tableLabel: string
  floorName?: string
  covers: number | null
  guestName: string | null
  reservationId: string | null
  note?: string
  items: TabItem[]
  rounds: TabRound[]
  /** öre, never a receipt: what staff key into the restaurant's own POS */
  referenceTotal: number
  openedAt: string
  openedByName: string
  closedAt?: string
  closedByName?: string
  version: number
  updatedAt: string
  history?: TabHistoryEntry[]
}

export interface TableGuest {
  reservationId: string
  name: string
  partySize: number
  startTime: string
  endTime: string
  status: 'arrived' | 'reserved' | 'pending'
  upcoming?: boolean
}

export interface TableState {
  tableId: string
  label: string
  seats: number
  floorId: string
  floorName: string
  tabId: string | null
  guest: TableGuest | null
}

export interface TabsResponse {
  version: number
  serverTime: string
  tabs: Tab[]
  closedToday: Tab[]
  tables: TableState[]
}

export interface TabMenuItem {
  menuItemId: string
  name: string
  description: string
  /** öre */
  price: number
  categoryId: string
  alcohol: boolean
  allergens: string[]
  options: { name: string; required: boolean; maxChoices: number; choices: { name: string; price: number }[] }[]
  imageKey: string | null
  imageFocus?: { x: number; y: number } | null
  course: Course
  stationId: string | null
  stationName: string | null
}

export interface TabMenu {
  categories: { categoryId: string; name: string; course: Course }[]
  items: TabMenuItem[]
  stations: { stationId: string; name: string; kind: 'kok' | 'dryck' | 'annat'; printers: number }[]
}

export interface NewItem {
  menuItemId: string
  quantity: number
  options?: TabOption[]
  note?: string
  allergy?: boolean
  course?: Course
  hold?: boolean
}

export interface HeldEdit {
  itemId: string
  quantity?: number
  note?: string
  allergy?: boolean
  course?: Course
  hold?: boolean
  remove?: boolean
}

export interface SendWarning { code: 'station_no_printer' | 'dispatch_failed'; stationId?: string; text: string }

export interface SendResult {
  tab: Tab
  round: TabRound | null
  warnings: SendWarning[]
  replayed?: boolean
}

export interface MockRound {
  tabId: string
  round: number
  kind: RoundKind
  tableId: string
  tableLabel: string
  waiter: string
  placedAt: string
  fire?: Course
  items: TabItem[]
}
