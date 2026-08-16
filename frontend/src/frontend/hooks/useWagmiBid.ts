import { useState } from 'react'
import { useSendTransaction } from 'wagmi'
import { parseEther } from 'viem'
import { api } from './useApi'

export function useWagmiBid() {
  const { sendTransactionAsync, isPending, isError, error } = useSendTransaction()
  const [txHash, setTxHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const placeBidWithWallet = async ({
    slotId,
    bidAmount,
    creativeUrl,
  }: {
    slotId: number
    bidAmount: string
    creativeUrl: string
  }) => {
    setLoading(true)
    setTxHash(null)

    try {
      // Step 1: Request unsigned calldata from backend (Private key NEVER leaves browser)
      const response = await api.placeBid({ slotId, bidAmount, creativeUrl })

      if (!response.success || !response.unsignedTx) {
        throw new Error('Failed to obtain unsigned transaction from relayer API')
      }

      const { unsignedTx } = response

      // Step 2: Prompt user's local MetaMask wallet to sign & broadcast via wagmi
      const hash = await sendTransactionAsync({
        to: unsignedTx.to as `0x${string}`,
        data: unsignedTx.data as `0x${string}`,
        value: BigInt(unsignedTx.value),
        chainId: unsignedTx.chainId,
      })

      setTxHash(hash)
      return { success: true, txHash: hash, auctionId: response.auctionId }
    } catch (err) {
      console.error('Wallet bidding error:', err)
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    placeBidWithWallet,
    loading: loading || isPending,
    isError,
    error,
    txHash,
  }
}
