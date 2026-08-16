// frontend/src/frontend/hooks/useApi.ts
import type { Slot, Bid, Role } from '../mock-data'

export type BackendSlot = {
  slot_id: number
  publisher_id?: string
  title: string
  description?: string | null
  floor_price_eth: string
  currentAuctionId?: string | null
  created_at?: string
}

export type BackendLedgerEvent = {
  bidder: string
  amount: string
  creativeRef?: string
  blockNumber?: string | null
  txHash?: string
}

export type BackendLedgerResponse = {
  success: boolean
  auctionId: string | null
  settled: boolean
  winner: string | null
  winningPrice: string | null
  winningCreativeRef: string | null
  events: BackendLedgerEvent[]
  error?: string
}

export type AuthResponse = {
  success: boolean
  token?: string
  userId?: string
  email?: string
  role?: Role
  error?: string
}

const API_BASE = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL
  : ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })
  const data = await response.json()
  if (!response.ok || (data && data.success === false)) {
    throw new Error(data?.error || `API request failed with status ${response.status}`)
  }
  return data as T
}

export const api = {
  login: (payload: { email: string; password: string }): Promise<AuthResponse> =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  register: (payload: { email: string; password: string; role: Role }): Promise<AuthResponse> =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),

  slots: (): Promise<{ success: boolean; slots: BackendSlot[] }> =>
    request<{ success: boolean; slots: BackendSlot[] }>('/api/slots'),

  slot: (slotId: string | number): Promise<{ success: boolean; slot: BackendSlot }> =>
    request<{ success: boolean; slot: BackendSlot }>(`/api/slots/${slotId}`),

  createSlot: (
    payload: { slotId: number; title: string; description?: string; floorPrice: number; publisherAddress?: string; publisherId?: string },
    token?: string
  ): Promise<{ success: boolean; slot: BackendSlot }> =>
    request<{ success: boolean; slot: BackendSlot }>('/api/slots', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(payload),
    }),

  ledger: (slotId: string | number): Promise<BackendLedgerResponse> =>
    request<BackendLedgerResponse>(`/api/slots/${slotId}/ledger`),

  openAuction: (slotId: number): Promise<{ success: boolean; auctionId: string; txHash: string }> =>
    request<{ success: boolean; auctionId: string; txHash: string }>('/api/auction/open', {
      method: 'POST',
      body: JSON.stringify({ slotId }),
    }),

  placeBid: (payload: { slotId: number; bidAmount: string; creativeUrl: string; bidder?: string }): Promise<{
    success: boolean
    auctionId: string
    unsignedTx: { to: string; data: string; value: string; chainId: number }
    meta?: Record<string, unknown>
  }> => request('/api/auction/bid', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  deleteBid: (slotId: number, bidId: string): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/slots/${slotId}/bids/${bidId}`, {
      method: 'DELETE',
    }),
}

export function mapBackendSlotToUI(slot: BackendSlot): Slot {
  const topBidClean = slot.topBid ? (slot.topBid.includes('MON') ? slot.topBid : `${slot.topBid} MON`) : '—'
  return {
    id: `slot-${String(slot.slot_id).padStart(3, '0')}`,
    rawSlotId: slot.slot_id,
    name: slot.title,
    publisher: slot.publisher_id ? `Publisher (${slot.publisher_id.slice(0, 6)}...)` : 'Monad Publisher',
    floor: slot.floor_price_eth.includes('MON') ? slot.floor_price_eth : `${slot.floor_price_eth} MON`,
    topBid: topBidClean,
    impressions: '0',
    status: (topBidClean !== '—' || slot.currentAuctionId) ? 'Live' : 'Opening',
    format: '728 × 90 leaderboard',
    description: slot.description || 'Monad on-chain ad inventory',
  }
}

export function mapBackendEventsToUI(events: BackendLedgerEvent[]): Bid[] {
  if (!events || events.length === 0) return []
  return events.map((ev, index) => {
    let formattedBidder = ev.bidder || '0x237A...B6C9'
    if (formattedBidder === '0x0000000000000000000000000000000000000001') {
      formattedBidder = '0x237A...B6C9'
    } else if (formattedBidder.length > 15 && formattedBidder.startsWith('0x')) {
      formattedBidder = `${formattedBidder.slice(0, 6)}...${formattedBidder.slice(-4)}`
    }

    const cleanAmountStr = String(ev.amount || '0.01').replace(/\s*MON/gi, '')
    const amountFormatted = `${cleanAmountStr} MON`

    return {
      id: ev.id ? String(ev.id) : undefined,
      bidder: formattedBidder,
      amount: amountFormatted,
      time: ev.blockNumber ? `Block #${ev.blockNumber}` : 'Just now',
      status: index === 0 ? 'Highest bid' : 'Outbid',
      creativeRef: ev.creativeRef,
    }
  })
}
