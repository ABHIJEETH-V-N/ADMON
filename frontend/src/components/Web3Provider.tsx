'use client'

import React, { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { injected, metaMask } from 'wagmi/connectors'
import type { Chain } from 'viem'

export const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz/'] },
  },
} as const satisfies Chain

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    metaMask({ dappMetadata: { name: 'ADmod RTB Exchange' } }),
    injected(),
  ],
  transports: {
    [monadTestnet.id]: http(),
  },
})

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
