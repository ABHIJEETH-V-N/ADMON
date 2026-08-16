export type Role = 'publisher' | 'advertiser'
export type View = 'overview' | 'slots' | 'ledger' | 'marketplace'

export type Slot = {
  id: string
  rawSlotId: number
  name: string
  publisher: string
  floor: string
  topBid: string
  impressions: string
  status: 'Live' | 'Opening' | 'Settled'
  format: string
  description: string
}

export type Bid = {
  bidder: string
  amount: string
  time: string
  status: string
  creativeRef?: string
}

export const apiEndpoints = {
  login: 'POST /api/auth/login',
  register: 'POST /api/auth/register',
  slots: 'GET /api/slots',
  createSlot: 'POST /api/slots',
  slot: 'GET /api/slots/:slotId',
  ledger: 'GET /api/slots/:slotId/ledger',
  openAuction: 'POST /api/auction/open',
  placeBid: 'POST /api/auction/bid',
} as const
