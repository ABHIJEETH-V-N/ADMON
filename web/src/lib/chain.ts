// web/src/lib/chain.ts
// Viem public + wallet clients for Monad Testnet.
// Used by API routes for on-chain reads and the relayer writes.
// The frontend imports publicClient directly for TanStack Query polling.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ── Monad Testnet chain definition ─────────────────────────────────────────
export const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        (import.meta.env?.VITE_MONAD_RPC_URL as string | undefined) ??
          'https://testnet-rpc.monad.xyz/',
      ],
    },
  },
} as const satisfies Chain

// ── Public client (read-only, used by frontend & API routes) ───────────────
export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
})

// ── Relayer wallet client (server-side only, signs open/settle txs) ────────
// RELAYER_PRIVATE_KEY must be set as a Cloudflare secret — never exposed to the browser.
export function getRelayerClient() {
  const privateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined
  if (!privateKey) {
    throw new Error('RELAYER_PRIVATE_KEY env var is not set')
  }
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  })
}
