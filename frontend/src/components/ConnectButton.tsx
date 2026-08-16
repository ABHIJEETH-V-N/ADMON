'use client'

import React from 'react'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { Wallet, AlertTriangle } from 'lucide-react'

export function ConnectButton() {
  const { address, isConnected, chain } = useAccount()
  const { connectors, connect } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

  const handleConnectMetaMask = async () => {
    // 1. Try Wagmi metaMask / injected connector first
    const mmConnector = connectors.find(
      c => c.id === 'metaMask' || c.name.toLowerCase().includes('metamask')
    ) || connectors[0]

    if (mmConnector) {
      try {
        connect({ connector: mmConnector })
        return
      } catch (err) {
        console.warn('Wagmi connector failed, trying direct window.ethereum request', err)
      }
    }

    // 2. Direct EIP-1193 fallback if MetaMask extension is installed in browser
    if (typeof window !== 'undefined' && (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum) {
      try {
        await (window as unknown as { ethereum: { request: (args: { method: string }) => Promise<unknown> } }).ethereum.request({
          method: 'eth_requestAccounts',
        })
      } catch (e) {
        console.error('MetaMask connection request rejected or failed:', e)
      }
    } else {
      window.open('https://metamask.io/download/', '_blank')
    }
  }

  if (!isConnected) {
    return (
      <button
        className="primary-button"
        style={{ padding: '8px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        onClick={handleConnectMetaMask}
      >
        <Wallet size={15} />
        Connect MetaMask
      </button>
    )
  }

  if (chain?.id !== 10143) {
    return (
      <button
        className="outline-button"
        style={{ padding: '8px 14px', fontSize: '13px', color: '#ff5555', borderColor: '#ff5555', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        onClick={() => switchChain({ chainId: 10143 })}
      >
        <AlertTriangle size={15} />
        Switch to Monad Testnet
      </button>
    )
  }

  const formattedAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''

  return (
    <button
      className="balance-pill"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
      onClick={() => disconnect()}
      title="Click to disconnect wallet"
    >
      <Wallet size={14} />
      <span>{formattedAddress}</span>
    </button>
  )
}
