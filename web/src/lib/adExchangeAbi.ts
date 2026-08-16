// web/src/lib/adExchangeAbi.ts
// ABI stub — replace the array contents with the real ABI from:
//   contracts/out/AdExchange.sol/AdExchange.json  (.abi field)
// after Person A deploys the contract.
//
// Field order is stable — do NOT rename or reorder after ABI handoff.

export const adExchangeAbi = [
  // ── registerSlot ─────────────────────────────────────────────────────────
  {
    name: 'registerSlot',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slotId',     type: 'uint256' },
      { name: 'publisher',  type: 'address' },
      { name: 'floorPrice', type: 'uint256' },
    ],
    outputs: [],
  },

  // ── openAuction ───────────────────────────────────────────────────────────
  {
    name: 'openAuction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },

  // ── placeBid ──────────────────────────────────────────────────────────────
  {
    name: 'placeBid',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'auctionId',   type: 'uint256' },
      { name: 'creativeRef', type: 'string'  },
    ],
    outputs: [],
  },

  // ── settleAuction ─────────────────────────────────────────────────────────
  {
    name: 'settleAuction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [],
  },

  // ── withdraw ──────────────────────────────────────────────────────────────
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },

  // ── getAuction (view) ─────────────────────────────────────────────────────
  {
    name: 'getAuction',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'slotId',             type: 'uint256' },
          { name: 'openBlock',          type: 'uint256' },
          { name: 'closeBlock',         type: 'uint256' },
          { name: 'settled',            type: 'bool'    },
          { name: 'highestBidder',      type: 'address' },
          { name: 'highestBid',         type: 'uint256' },
          { name: 'highestCreativeRef', type: 'string'  },
          { name: 'winner',             type: 'address' },
          { name: 'winningPrice',       type: 'uint256' },
          { name: 'winningCreativeRef', type: 'string'  },
        ],
      },
    ],
  },

  // ── getSlotCurrentAuction (view) ─────────────────────────────────────────
  {
    name: 'getSlotCurrentAuction',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },

  // ── pendingWithdrawals (view) ─────────────────────────────────────────────
  {
    name: 'pendingWithdrawals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },

  // ── Events ────────────────────────────────────────────────────────────────
  {
    name: 'AuctionOpened',
    type: 'event',
    inputs: [
      { name: 'auctionId',  type: 'uint256', indexed: true  },
      { name: 'slotId',     type: 'uint256', indexed: true  },
      { name: 'floorPrice', type: 'uint256', indexed: false },
      { name: 'closeBlock', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'BidPlaced',
    type: 'event',
    inputs: [
      { name: 'auctionId',  type: 'uint256', indexed: true  },
      { name: 'bidder',     type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
      { name: 'creativeRef',type: 'string',  indexed: false },
    ],
  },
  {
    name: 'AuctionSettled',
    type: 'event',
    inputs: [
      { name: 'auctionId',          type: 'uint256', indexed: true  },
      { name: 'slotId',             type: 'uint256', indexed: true  },
      { name: 'winner',             type: 'address', indexed: true  },
      { name: 'winningPrice',       type: 'uint256', indexed: false },
      { name: 'winningCreativeRef', type: 'string',  indexed: false },
    ],
  },
] as const

// ── Contract address (set via env after deploy) ────────────────────────────
export const AD_EXCHANGE_ADDRESS = (
  (typeof import.meta !== 'undefined'
    ? (import.meta.env as Record<string, string>)?.VITE_AD_EXCHANGE_ADDRESS
    : process.env.VITE_AD_EXCHANGE_ADDRESS) ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`
