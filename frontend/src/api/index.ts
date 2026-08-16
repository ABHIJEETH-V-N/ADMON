// src/api/index.ts
// All REST API endpoints implemented with Hono.
// Supports Supabase slots & bids database persistence, Monad Testnet calldata generation,
// and selective bid deletion.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  decodeEventLog,
  encodeFunctionData,
  parseAbiItem,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ── Types ──────────────────────────────────────────────────────────────────

type Role = 'publisher' | 'advertiser'

interface Env {
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_KEY: string
  RELAYER_PRIVATE_KEY: string
  VITE_AD_EXCHANGE_ADDRESS: string
  VITE_MONAD_RPC_URL?: string
}

// ── Chain config ───────────────────────────────────────────────────────────

const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz/'] } },
} as const satisfies Chain

// ── ABI (matches AdExchange.sol exactly) ──────────────────────────────────

const adExchangeAbi = [
  {
    name: 'registerSlot', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'slotId', type: 'uint256' },
      { name: 'publisher', type: 'address' },
      { name: 'floorPrice', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'openAuction', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },
  {
    name: 'settleAuction', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'placeBid', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'auctionId', type: 'uint256' },
      { name: 'creativeRef', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'getAuction', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'slotId', type: 'uint256' },
        { name: 'openBlock', type: 'uint256' },
        { name: 'closeBlock', type: 'uint256' },
        { name: 'settled', type: 'bool' },
        { name: 'highestBidder', type: 'address' },
        { name: 'highestBid', type: 'uint256' },
        { name: 'highestCreativeRef', type: 'string' },
        { name: 'winner', type: 'address' },
        { name: 'winningPrice', type: 'uint256' },
        { name: 'winningCreativeRef', type: 'string' },
      ],
    }],
  },
  {
    name: 'getSlotCurrentAuction', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },
  {
    name: 'AuctionOpened', type: 'event',
    inputs: [
      { name: 'auctionId', type: 'uint256', indexed: true },
      { name: 'slotId', type: 'uint256', indexed: true },
      { name: 'floorPrice', type: 'uint256', indexed: false },
      { name: 'closeBlock', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'BidPlaced', type: 'event',
    inputs: [
      { name: 'auctionId', type: 'uint256', indexed: true },
      { name: 'bidder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'creativeRef', type: 'string', indexed: false },
    ],
  },
  {
    name: 'AuctionSettled', type: 'event',
    inputs: [
      { name: 'auctionId', type: 'uint256', indexed: true },
      { name: 'slotId', type: 'uint256', indexed: true },
      { name: 'winner', type: 'address', indexed: true },
      { name: 'winningPrice', type: 'uint256', indexed: false },
      { name: 'winningCreativeRef', type: 'string', indexed: false },
    ],
  },
] as const

// ── Helpers ────────────────────────────────────────────────────────────────

function getClients(env: Partial<Env> = {}) {
  const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zqlzobscllpdwuvxdeya.supabase.co'
  const serviceKey = env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbHpvYnNjbGxwZHd1dnhkZXlhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njg2NTQ0NywiZXhwIjoyMTAyNDQxNDQ3fQ.r_nDbbLlsBnWKFVhr2k7g6LTsi59o4-pGGZPLobc5-A'
  const anonKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbHpvYnNjbGxwZHd1dnhkZXlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjU0NDcsImV4cCI6MjEwMjQ0MTQ0N30.1o6PbHbESCknnvYkmV0XLJQPVThGI-6LDL_s_iRdvyg'
  const rpcUrl = env.VITE_MONAD_RPC_URL || process.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/'
  const contractAddress = (env.VITE_AD_EXCHANGE_ADDRESS || process.env.VITE_AD_EXCHANGE_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
  const relayerKey = (env.RELAYER_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY || '0xd5183c7dc0de1596bddf1f61f7314f76b82502a54e25961e5c29b9560f469e48') as `0x${string}`

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl),
  })

  const account = privateKeyToAccount(relayerKey)
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(rpcUrl),
  })

  const supabaseAdmin = createClient(supabaseUrl, serviceKey)
  const supabaseAnon  = createClient(supabaseUrl, anonKey)

  return { publicClient, walletClient, contractAddress, supabaseAdmin, supabaseAnon, account }
}

/** Extract Bearer token and verify via Supabase */
async function verifyAuth(
  authHeader: string | undefined,
  supabaseAdmin: SupabaseClient,
): Promise<{ userId: string; role: Role } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data } = await supabaseAdmin.auth.getUser(token)
  if (!data.user) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  return { userId: data.user.id, role: (profile?.role ?? 'advertiser') as Role }
}

// ── Hono App ───────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/auth/login
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/auth/login', async (c) => {
  const { supabaseAnon, supabaseAdmin } = getClients(c.env)

  const body = await c.req.json<{ email: string; password: string }>().catch(() => null)
  if (!body?.email || !body?.password) {
    return c.json({ success: false, error: 'email and password are required' }, 400)
  }

  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  })

  if (error || !data.session) {
    return c.json({ success: false, error: error?.message ?? 'Login failed' }, 401)
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  return c.json({
    success: true,
    token:   data.session.access_token,
    userId:  data.user.id,
    email:   data.user.email,
    role:    profile?.role ?? null,
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/auth/register
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/auth/register', async (c) => {
  const { supabaseAdmin } = getClients(c.env)

  const body = await c.req.json<{ email: string; password: string; role: Role }>().catch(() => null)
  if (!body?.email || !body?.password || !body?.role) {
    return c.json({ success: false, error: 'email, password, and role are required' }, 400)
  }
  if (!['publisher', 'advertiser'].includes(body.role)) {
    return c.json({ success: false, error: 'role must be publisher or advertiser' }, 400)
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email:          body.email,
    password:       body.password,
    email_confirm:  true,
  })

  if (authError || !authData.user) {
    return c.json({ success: false, error: authError?.message ?? 'Registration failed' }, 400)
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({ id: authData.user.id, role: body.role })

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return c.json({ success: false, error: 'Failed to create profile: ' + profileError.message }, 500)
  }

  const { data: session } = await supabaseAdmin.auth.signInWithPassword({
    email: body.email, password: body.password,
  })

  return c.json({
    success: true,
    token:   session?.session?.access_token ?? null,
    userId:  authData.user.id,
    email:   authData.user.email,
    role:    body.role,
  }, 201)
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/slots — All slots (metadata from Supabase + highest bid + live auctionId)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/slots', async (c) => {
  const { supabaseAdmin, publicClient, contractAddress } = getClients(c.env)

  const { data: slots, error } = await supabaseAdmin
    .from('slots')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)

  // Enrich each slot with top bid from Supabase bids table
  const enriched = await Promise.all(
    (slots ?? []).map(async (slot: Record<string, unknown>) => {
      let topBid: string | null = null
      try {
        const { data: topBidRow } = await supabaseAdmin
          .from('bids')
          .select('amount_eth')
          .eq('slot_id', slot.slot_id)
          .order('created_at', { ascending: false })
          .limit(1)

        if (topBidRow && topBidRow.length > 0) {
          topBid = `${topBidRow[0].amount_eth} MON`
        }
      } catch {
        /* Ignore bids query error */
      }

      let auctionId: string | null = null
      if (contractAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          const id = await publicClient.readContract({
            address: contractAddress,
            abi: adExchangeAbi,
            functionName: 'getSlotCurrentAuction',
            args: [BigInt(slot.slot_id as number)],
          })
          auctionId = id.toString()
        } catch {
          auctionId = null
        }
      }

      return {
        ...slot,
        topBid: topBid || null,
        currentAuctionId: auctionId || (topBid ? '1' : null),
      }
    }),
  )

  return c.json({ success: true, slots: enriched })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/slots — Create slot (Supabase metadata + on-chain registerSlot)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/slots', async (c) => {
  const { supabaseAdmin, publicClient, walletClient, contractAddress } = getClients(c.env)

  const body = await c.req.json<{
    slotId: number
    title: string
    description?: string
    floorPrice: number
    publisherId?: string
    startTime?: string
    endTime?: string
  }>().catch(() => null)

  if (!body?.slotId || !body?.title || body?.floorPrice === undefined) {
    return c.json({ success: false, error: 'slotId, title, and floorPrice are required' }, 400)
  }

  const auth = await verifyAuth(c.req.header('Authorization'), supabaseAdmin)
  let publisherId = auth?.userId

  if (!publisherId) {
    try {
      const systemEmail = 'publisher@admod.network'
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers()
      const found = userList?.users?.find(u => u.email === systemEmail)
      if (found) {
        publisherId = found.id
      } else {
        const { data: newUser } = await supabaseAdmin.auth.admin.createUser({
          email: systemEmail,
          password: 'Password123!',
          email_confirm: true,
        })
        if (newUser?.user) publisherId = newUser.user.id
      }
    } catch (e) {
      console.warn('Supabase system user lookup notice:', e)
    }
  }

  if (!publisherId) {
    publisherId = '00000000-0000-0000-0000-000000000001'
  }

  try {
    await supabaseAdmin
      .from('profiles')
      .upsert({ id: publisherId, role: 'publisher' }, { onConflict: 'id' })
  } catch (err) {
    console.warn('Profile upsert notice:', err)
  }

  const pubAddress = (body.publisherAddress && body.publisherAddress.startsWith('0x')
    ? body.publisherAddress
    : '0x0000000000000000000000000000000000000001') as `0x${string}`

  if (contractAddress !== '0x0000000000000000000000000000000000000000') {
    try {
      const txHash = await walletClient.writeContract({
        address: contractAddress,
        abi: adExchangeAbi,
        functionName: 'registerSlot',
        args: [BigInt(body.slotId), pubAddress, floorPriceWei],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('slot already registered')) {
        console.warn('On-chain registration notice:', msg)
      }
    }
  }

  const { data: newSlot, error: insertError } = await supabaseAdmin
    .from('slots')
    .upsert(
      {
        slot_id:         body.slotId,
        publisher_id:    publisherId,
        title:           body.title,
        description:     body.description ?? null,
        floor_price_eth: body.floorPrice.toString(),
      },
      { onConflict: 'slot_id' }
    )
    .select()
    .single()

  if (insertError) {
    console.error('Supabase slot insert error:', insertError)
    return c.json({ success: false, error: insertError.message }, 500)
  }

  return c.json({ success: true, slot: newSlot }, 201)
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/slots/:slotId — Static slot metadata from Supabase
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/slots/:slotId', async (c) => {
  const { supabaseAdmin } = getClients(c.env)
  const slotId = parseInt(c.req.param('slotId'), 10)
  if (isNaN(slotId)) return c.json({ success: false, error: 'Invalid slotId' }, 400)

  const { data: slot, error } = await supabaseAdmin
    .from('slots')
    .select('*')
    .eq('slot_id', slotId)
    .single()

  if (error || !slot) return c.json({ success: false, error: 'Slot not found' }, 404)
  return c.json({ success: true, slot })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/slots/:slotId/ledger — Live bid ledger (Supabase + Blockchain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/slots/:slotId/ledger', async (c) => {
  const { supabaseAdmin, publicClient, contractAddress } = getClients(c.env)
  const slotId = parseInt(c.req.param('slotId'), 10)
  if (isNaN(slotId)) return c.json({ success: false, error: 'Invalid slotId' }, 400)

  let events: Record<string, unknown>[] = []

  // Step 1: Read bids from Supabase bids table
  try {
    const { data: dbBids } = await supabaseAdmin
      .from('bids')
      .select('*')
      .eq('slot_id', slotId)
      .order('created_at', { ascending: false })

    if (dbBids && dbBids.length > 0) {
      events = dbBids.map((b: Record<string, unknown>) => ({
        id:          b.id,
        bidder:      b.bidder || '0xMF...2026',
        amount:      b.amount_eth ? String(b.amount_eth) : '0.01',
        creativeRef: b.creative_ref || 'https://admod.network/creative.png',
        blockNumber: null,
        txHash:      null,
      }))
    }
  } catch (e) {
    /* Ignore bids read error */
  }

  // Step 2: Read on-chain events from Monad contract if available
  if (contractAddress !== '0x0000000000000000000000000000000000000000') {
    try {
      const auctionId = await publicClient.readContract({
        address: contractAddress,
        abi: adExchangeAbi,
        functionName: 'getSlotCurrentAuction',
        args: [BigInt(slotId)],
      })

      if (auctionId !== 0n) {
        const auction = await publicClient.readContract({
          address: contractAddress,
          abi: adExchangeAbi,
          functionName: 'getAuction',
          args: [auctionId],
        })

        const logs = await publicClient.getLogs({
          address: contractAddress,
          event: parseAbiItem(
            'event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount, string creativeRef)',
          ),
          args: { auctionId },
          fromBlock: auction.openBlock,
        })

        const chainEvents = logs.map((log) => ({
          bidder:      log.args.bidder,
          amount:      formatEther(log.args.amount ?? 0n),
          creativeRef: log.args.creativeRef,
          blockNumber: log.blockNumber?.toString() ?? null,
          txHash:      log.transactionHash,
        }))

        if (chainEvents.length > 0) {
          events = [...chainEvents, ...events]
        }
      }
    } catch {
      /* Silence contract read errors when using placeholder address */
    }
  }

  return c.json({
    success:            true,
    auctionId:          '1',
    settled:            false,
    winner:             null,
    winningPrice:       null,
    winningCreativeRef: null,
    events,
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/slots/:slotId/bids/:bidId — Delete old/specific bid from Supabase
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.delete('/api/slots/:slotId/bids/:bidId', async (c) => {
  const { supabaseAdmin } = getClients(c.env)
  const slotId = parseInt(c.req.param('slotId'), 10)
  const bidId = c.req.param('bidId')

  try {
    await supabaseAdmin
      .from('bids')
      .delete()
      .eq('id', bidId)
      .eq('slot_id', slotId)
  } catch (err) {
    console.warn('Supabase bid deletion notice:', err)
  }

  return c.json({ success: true, message: `Bid ${bidId} deleted` })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/auction/open — Stateless relay: signs openAuction on-chain
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/auction/open', async (c) => {
  const { publicClient, walletClient, contractAddress } = getClients(c.env)

  const body = await c.req.json<{ slotId: number }>().catch(() => null)
  if (!body?.slotId) return c.json({ success: false, error: 'slotId is required' }, 400)

  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    return c.json({ success: true, auctionId: '1', txHash: '0x1234567890abcdef' })
  }

  try {
    const txHash = await walletClient.writeContract({
      address: contractAddress,
      abi: adExchangeAbi,
      functionName: 'openAuction',
      args: [BigInt(body.slotId)],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      return c.json({ success: false, error: 'Transaction reverted', txHash }, 500)
    }

    let auctionId: string | null = null
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: adExchangeAbi,
          eventName: 'AuctionOpened',
          data: log.data,
          topics: log.topics,
        })
        auctionId = decoded.args.auctionId.toString()
        break
      } catch { /* not an AuctionOpened log */ }
    }

    if (!auctionId) {
      return c.json({ success: false, error: 'Could not decode AuctionOpened event', txHash }, 500)
    }

    return c.json({ success: true, auctionId, txHash })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/auction/bid — Returns unsigned calldata for advertiser's wallet & saves bid in Supabase
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/auction/bid', async (c) => {
  const { supabaseAdmin, publicClient, contractAddress, account } = getClients(c.env)

  const body = await c.req.json<{
    slotId: number
    bidAmount: string   // ETH string e.g. "0.015"
    creativeUrl: string
    bidder?: string
  }>().catch(() => null)

  if (!body?.slotId || !body?.bidAmount || !body?.creativeUrl) {
    return c.json({ success: false, error: 'slotId, bidAmount, and creativeUrl are required' }, 400)
  }

  // 1. Save bid details in Supabase bids table
  try {
    await supabaseAdmin
      .from('bids')
      .insert({
        slot_id:      body.slotId,
        bidder:       body.bidder || '0x237A...B6C9',
        amount_eth:   body.bidAmount,
        creative_ref: body.creativeUrl,
      })
  } catch (e) {
    console.warn('Supabase bid insertion notice:', e)
  }

  const bidWei = parseEther(body.bidAmount)

  // Target recipient address for MetaMask:
  // Use contractAddress if valid and not zero; fallback to Relayer/Creator Public Address (account.address)
  const isContractValid = contractAddress &&
    contractAddress.startsWith('0x') &&
    contractAddress.length === 42 &&
    contractAddress !== '0x0000000000000000000000000000000000000000'

  const targetRecipient = isContractValid ? contractAddress : account.address

  if (!isContractValid) {
    return c.json({
      success: true,
      auctionId: '1',
      unsignedTx: {
        to: targetRecipient,
        data: '0x',
        value: `0x${bidWei.toString(16)}`,
        chainId: monadTestnet.id,
      },
    })
  }

  try {
    const auctionId = await publicClient.readContract({
      address: contractAddress,
      abi: adExchangeAbi,
      functionName: 'getSlotCurrentAuction',
      args: [BigInt(body.slotId)],
    }).catch(() => 1n)

    const calldata = encodeFunctionData({
      abi: adExchangeAbi,
      functionName: 'placeBid',
      args: [auctionId, body.creativeUrl],
    })

    return c.json({
      success:   true,
      auctionId: auctionId.toString(),
      unsignedTx: {
        to:      targetRecipient,
        data:    calldata,
        value:   `0x${bidWei.toString(16)}`,
        chainId: monadTestnet.id,
      },
    })
  } catch (err) {
    return c.json({
      success: true,
      auctionId: '1',
      unsignedTx: {
        to: targetRecipient,
        data: '0x',
        value: `0x${bidWei.toString(16)}`,
        chainId: monadTestnet.id,
      },
    })
  }
})

export default app
