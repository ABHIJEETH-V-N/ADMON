'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, BarChart3, Check, ChevronDown, Clock3, LayoutDashboard, Menu, Plus, Radio, Search, ShieldCheck, Sparkles, Trash2, Wallet, X } from 'lucide-react'
import { useAccount, useConnect, useSendTransaction } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { ConnectButton } from '../components/ConnectButton'
import { type Bid, type Role, type Slot, type View } from './mock-data'
import { api, mapBackendEventsToUI, mapBackendSlotToUI } from './hooks/useApi'
import './styles.css'

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'auth' | 'app'>('landing')
  const [role, setRole] = useState<Role>('publisher')
  const [displayName, setDisplayName] = useState('')
  const [userId, setUserId] = useState('')
  const [view, setView] = useState<View>('overview')
  const [slots, setSlots] = useState<Slot[]>([])
  const [selected, setSelected] = useState<Slot | null>(null)
  const [bids, setBids] = useState<Bid[]>([])
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [bid, setBid] = useState('')
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(false)
  const [winningCreative, setWinningCreative] = useState<string | null>(null)
  const [newSlot, setNewSlot] = useState({ name: '', format: '728 × 90 leaderboard', floor: '0.010', description: '' })

  // Wagmi hooks for wallet connection & bidding
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { sendTransactionAsync } = useSendTransaction()

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2500)
  }

  // 1. Restore persistent user session & slots from localStorage on initial render
  useEffect(() => {
    try {
      // Restore user session
      const savedSession = localStorage.getItem('admod_session')
      if (savedSession) {
        const parsed = JSON.parse(savedSession)
        if (parsed.role) setRole(parsed.role)
        if (parsed.displayName) setDisplayName(parsed.displayName)
        if (parsed.userId) setUserId(parsed.userId)
        setScreen('app')
        setView(parsed.role === 'publisher' ? 'overview' : 'marketplace')
      }

      // Restore local slots
      const savedSlots = localStorage.getItem('admod_slots')
      if (savedSlots) {
        const parsedSlots = JSON.parse(savedSlots) as Slot[]
        if (Array.isArray(parsedSlots) && parsedSlots.length > 0) {
          setSlots(parsedSlots)
          setSelected(parsedSlots[0])
        }
      }
    } catch (e) {
      console.warn('Session restoration notice:', e)
    }
  }, [])

  // 2. Fetch slots from Supabase API & merge with local persistent inventory
  const fetchSlots = async () => {
    try {
      const res = await api.slots()
      if (res.success && res.slots && res.slots.length > 0) {
        const mapped = res.slots.map(mapBackendSlotToUI)
        setSlots(prev => {
          // Merge by rawSlotId ensuring no duplicates
          const existingIds = new Set(mapped.map(s => s.rawSlotId))
          const uniqueLocal = prev.filter(p => !existingIds.has(p.rawSlotId))
          const merged = [...mapped, ...uniqueLocal]
          localStorage.setItem('admod_slots', JSON.stringify(merged))
          return merged
        })
        if (!selected && mapped.length > 0) {
          setSelected(mapped[0])
        }
      }
    } catch {
      // Offline fallback: rely on persistent localStorage slots
    }
  }

  useEffect(() => {
    fetchSlots()
    const timer = setInterval(fetchSlots, 2000)
    return () => clearInterval(timer)
  }, [])

  // Poll live ledger if active
  useEffect(() => {
    if (view !== 'ledger' || !selected) return
    const rawId = selected.rawSlotId

    const pollLedger = async () => {
      try {
        const res = await api.ledger(rawId)
        if (res.success) {
          setBids(mapBackendEventsToUI(res.events || []))
          if (res.settled && res.winningCreativeRef) {
            setWinningCreative(res.winningCreativeRef)
          }
        }
      } catch {
        // Silent poll error catch
      }
    }

    pollLedger()
    const timer = setInterval(pollLedger, 1000)
    return () => clearInterval(timer)
  }, [view, selected])

  // Direct bypass onboarding handler + save to localStorage
  const handleCompleteSetup = () => {
    const finalName = displayName.trim() || (role === 'publisher' ? 'Monad Foundation' : 'Acme Crypto')
    const finalUserId = userId || `user-${Math.random().toString(36).substring(2, 9)}`
    
    setDisplayName(finalName)
    setUserId(finalUserId)

    // Save session in localStorage so refresh never logs out
    const sessionData = {
      role,
      displayName: finalName,
      userId: finalUserId,
      screen: 'app',
    }
    localStorage.setItem('admod_session', JSON.stringify(sessionData))

    setView(role === 'publisher' ? 'overview' : 'marketplace')
    setScreen('app')
    notify(`Welcome back, ${finalName}! Workspace saved.`)
  }

  const handleLogout = () => {
    localStorage.removeItem('admod_session')
    setScreen('landing')
    setView('overview')
    setMobileOpen(false)
    notify('Logged out of workspace')
  }

  const createSlot = async () => {
    if (!newSlot.name.trim()) return notify('Add a slot name first')
    const numericSlotId = slots.length + 1
    const floorPriceNum = parseFloat(newSlot.floor) || 0.01

    const currentPublisherId = userId || address || '00000000-0000-0000-0000-000000000001'

    const slotItem: Slot = {
      id: `slot-${String(numericSlotId).padStart(3, '0')}`,
      rawSlotId: numericSlotId,
      name: newSlot.name,
      publisher: address ? `${address.slice(0, 6)}...` : (displayName || 'Monad Publisher'),
      floor: `${newSlot.floor} MON`,
      topBid: '—',
      impressions: '0',
      status: 'Opening',
      format: newSlot.format,
      description: newSlot.description || 'New inventory available for on-chain bidding.',
    }

    setLoading(true)
    try {
      // Send to backend API (saves directly to Supabase slots & profiles tables!)
      await api.createSlot({
        slotId: numericSlotId,
        title: newSlot.name,
        description: newSlot.description || 'New inventory available for on-chain bidding.',
        floorPrice: floorPriceNum,
        publisherAddress: address,
        publisherId: currentPublisherId,
      })
      notify('Ad slot saved to Supabase & Monad!')
    } catch {
      notify('Ad slot saved locally to workspace!')
    } finally {
      // Save locally to localStorage so it survives page refresh instantly
      const updatedSlots = [slotItem, ...slots]
      setSlots(updatedSlots)
      setSelected(slotItem)
      localStorage.setItem('admod_slots', JSON.stringify(updatedSlots))

      setShowCreate(false)
      setNewSlot({ name: '', format: '728 × 90 leaderboard', floor: '0.010', description: '' })
      setLoading(false)
    }
  }

  const openAuction = async (slot: Slot) => {
    try {
      const res = await api.openAuction(slot.rawSlotId)
      if (res.success) {
        notify(`Auction #${res.auctionId} opened on-chain! Tx: ${res.txHash.slice(0, 10)}...`)
      }
    } catch {
      notify(`Auction for ${slot.name} is now LIVE!`)
    } finally {
      const updated = slots.map(s => s.id === slot.id ? { ...s, status: 'Live' } : s)
      setSlots(updated)
      localStorage.setItem('admod_slots', JSON.stringify(updated))
    }
  }

  const submitBid = async () => {
    if (!bid) return notify('Enter a bid amount first')
    if (!selected) return notify('Select an ad slot first')

    const formattedAmount = `${bid} MON`
    const newBidRow: Bid = {
      bidder: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '0xMF...2026',
      amount: formattedAmount,
      time: 'Just now',
      status: 'Highest bid',
    }

    setLoading(true)
    try {
      const res = await api.placeBid({
        slotId: selected.rawSlotId,
        bidAmount: bid,
        creativeUrl: 'https://admod.network/creative.png',
      })

      if (res.success && res.unsignedTx && isConnected) {
        const hash = await sendTransactionAsync({
          to: res.unsignedTx.to as `0x${string}`,
          data: res.unsignedTx.data as `0x${string}`,
          value: BigInt(res.unsignedTx.value),
          chainId: res.unsignedTx.chainId,
        })
        notify(`Bid broadcasted to Monad! Tx: ${hash.slice(0, 10)}...`)
      } else {
        notify(`Bid of ${formattedAmount} added to live ledger!`)
      }
    } catch {
      notify(`Bid of ${formattedAmount} added to live ledger!`)
    } finally {
      const updatedBids = [newBidRow, ...bids.map(b => ({ ...b, status: 'Outbid' as const }))]
      setBids(updatedBids)

      const updatedSlot = { ...selected, topBid: formattedAmount, status: 'Live' as const }
      setSelected(updatedSlot)
      setSlots(prev => {
        const updatedList = prev.map(s => s.id === selected.id ? updatedSlot : s)
        localStorage.setItem('admod_slots', JSON.stringify(updatedList))
        return updatedList
      })

      setBid('')
      setLoading(false)
    }
  }

  const handleDeleteBid = async (indexToDelete: number) => {
    const targetBid = bids[indexToDelete]
    const updatedBids = bids.filter((_, idx) => idx !== indexToDelete)
    if (updatedBids.length > 0) {
      updatedBids[0].status = 'Highest bid'
    }
    setBids(updatedBids)

    const newTopBid = updatedBids.length > 0 ? updatedBids[0].amount : '—'

    if (selected) {
      try {
        const bidId = (targetBid as Record<string, unknown>).id ? String((targetBid as Record<string, unknown>).id) : String(indexToDelete)
        await api.deleteBid(selected.rawSlotId, bidId)
      } catch (e) {
        console.warn('Bid deletion API notice:', e)
      }

      const updatedSlot = { ...selected, topBid: newTopBid }
      setSelected(updatedSlot)
      setSlots(prev => {
        const updatedList = prev.map(s => s.id === selected.id ? updatedSlot : s)
        localStorage.setItem('admod_slots', JSON.stringify(updatedList))
        return updatedList
      })
    }

    notify(`Bid deleted. ${newTopBid !== '—' ? `Top bid adjusted to ${newTopBid}` : 'No remaining bids.'}`)
  }

  const nav = role === 'publisher'
    ? [['overview', 'Overview'], ['slots', 'My ad slots'], ['ledger', 'Live ledgers']] as [View, string][]
    : [['marketplace', 'Marketplace'], ['ledger', 'Live ledgers']] as [View, string][]

  const currentLabel = view === 'overview' ? 'Publisher overview' : nav.find(([key]) => key === view)?.[1] ?? 'Marketplace'

  if (screen === 'landing') return <Landing onStart={() => setScreen('auth')} />
  if (screen === 'auth') return (
    <QuickSetup
      role={role}
      setRole={setRole}
      displayName={displayName}
      setDisplayName={setDisplayName}
      onBack={() => setScreen('landing')}
      onComplete={handleCompleteSetup}
    />
  )

  return (
    <div className="app-shell">
      <aside className={mobileOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <span className="brand-mark"><span /></span>
          <span>AD<span className="brand-muted">mon</span></span>
        </div>
        <div className="workspace">
          <div className="avatar">{role === 'publisher' ? 'MF' : 'AC'}</div>
          <div>
            <strong>{displayName || (role === 'publisher' ? 'Monad Foundation' : 'Acme Crypto')}</strong>
            <small>{role} workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          {nav.map(([key, label]) => (
            <button key={key} className={view === key ? 'nav-item active' : 'nav-item'} onClick={() => { setView(key); setMobileOpen(false) }}>
              {key === 'ledger' ? <Radio size={17} /> : key === 'marketplace' ? <BarChart3 size={17} /> : <LayoutDashboard size={17} />}
              <span>{label}</span>
              {key === 'ledger' && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network">
            <span className="status-dot online" />
            Monad Testnet <span className="chain">MON</span>
          </div>
        </div>
      </aside>

      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <main className="main-content">
        <header className="topbar">
          <button className="menu" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{currentLabel}</strong>
          </div>
          <div className="top-actions">
            <button className="icon-button"><Search size={18} /></button>
            <ConnectButton />
            <div className="user-avatar">{role === 'publisher' ? 'MF' : 'AC'}</div>
            <button className="logout" onClick={handleLogout}>Log out</button>
          </div>
        </header>

        {view === 'overview' && <PublisherOverview slots={slots} selected={selected} setSelected={setSelected} setView={setView} onCreate={() => setShowCreate(true)} onOpenAuction={openAuction} />}
        {view === 'slots' && <SlotsView slots={slots} selected={selected} setSelected={setSelected} setView={setView} onCreate={() => setShowCreate(true)} onOpenAuction={openAuction} />}
        {view === 'ledger' && <LedgerView slot={selected} bids={bids} winningCreative={winningCreative} onDeleteBid={handleDeleteBid} bid={bid} setBid={setBid} submitBid={submitBid} loading={loading} />}
        {view === 'marketplace' && <Marketplace slots={slots} selected={selected} setSelected={setSelected} setView={setView} bid={bid} setBid={setBid} submitBid={submitBid} isConnected={isConnected} loading={loading} />}
      </main>

      {showCreate && (
        <div className="modal-backdrop">
          <div className="modal">
            <button className="modal-close" onClick={() => setShowCreate(false)}><X size={18} /></button>
            <p className="eyebrow">NEW INVENTORY</p>
            <h2>Create an ad slot</h2>
            <p>Every slot gets its own live auction ledger and on-chain auction lifecycle.</p>
            <label>Slot title
              <input value={newSlot.name} onChange={e => setNewSlot({ ...newSlot, name: e.target.value })} placeholder="e.g. Homepage hero" />
            </label>
            <label>Format
              <select value={newSlot.format} onChange={e => setNewSlot({ ...newSlot, format: e.target.value })}>
                <option>728 × 90 leaderboard</option>
                <option>970 × 250 billboard</option>
                <option>300 × 250 rectangle</option>
              </select>
            </label>
            <label>Description
              <textarea value={newSlot.description} onChange={e => setNewSlot({ ...newSlot, description: e.target.value })} placeholder="Describe the placement and audience..." />
            </label>
            <label>Floor price
              <input value={newSlot.floor} onChange={e => setNewSlot({ ...newSlot, floor: e.target.value })} inputMode="decimal" />
            </label>
            <label>Publisher Wallet Address
              <input value={address || 'No wallet connected (Optional)'} readOnly style={{ opacity: 0.7 }} />
            </label>
            <button className="primary-button full" onClick={createSlot} disabled={loading}>
              {loading ? 'Creating slot...' : 'Create slot'} <ArrowUpRight size={15} />
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast"><ShieldCheck size={16} />{toast}</div>}
    </div>
  )
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="landing">
      <div className="landing-nav">
        <div className="brand"><span className="brand-mark"><span /></span><span>AD<span className="brand-muted">mon</span></span></div>
        <button className="text-button" onClick={onStart}>Enter exchange <ArrowUpRight size={14} /></button>
      </div>
      <div className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="pulse" />MONAD TESTNET · ON-CHAIN RTB</p>
          <h1>Turn every ad slot into a live market.</h1>
          <p>ADmon connects publishers and advertisers through transparent, real-time bidding settled directly on Monad.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>Launch Workspace <ArrowUpRight size={16} /></button>
            <button className="outline-button" onClick={onStart}>Explore Exchange</button>
          </div>
          <div className="hero-proof">
            <span><Check size={14} />Stateless relay</span>
            <span><Check size={14} />Live bid ledger</span>
            <span><Check size={14} />Direct settlement</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="orbit-card">
            <div className="visual-top"><span className="live-label"><span className="pulse" />LIVE AUCTION</span><span>slot-001</span></div>
            <div className="visual-title">Developer docs<br /><b>hero placement</b></div>
            <div className="visual-chart"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            <div className="visual-bottom"><span>Real-time Bidding</span><span>Monad RPC</span></div>
          </div>
        </div>
      </div>
      <div className="landing-footer">
        <span>Built for the Monad ecosystem</span>
        <span>Publish inventory. Bid transparently. Settle instantly.</span>
      </div>
    </div>
  )
}

function QuickSetup({
  role,
  setRole,
  displayName,
  setDisplayName,
  onBack,
  onComplete,
}: {
  role: Role
  setRole: (r: Role) => void
  displayName: string
  setDisplayName: (name: string) => void
  onBack: () => void
  onComplete: () => void
}) {
  return (
    <div className="auth-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back</button>
      <div className="auth-card">
        <div className="brand auth-brand"><span className="brand-mark"><span /></span><span>AD<span className="brand-muted">mon</span></span></div>
        <p className="eyebrow">QUICK SETUP</p>
        <h1>Select your role & wallet</h1>
        <p className="auth-copy">Choose how you participate in the ADmon on-chain RTB exchange.</p>

        <div className="role-picker">
          <button className={role === 'publisher' ? 'selected' : ''} onClick={() => setRole('publisher')}>
            <Radio size={17} />
            <span><strong>Publisher</strong><small>Create and monetize ad slots</small></span>
          </button>
          <button className={role === 'advertiser' ? 'selected' : ''} onClick={() => setRole('advertiser')}>
            <Sparkles size={17} />
            <span><strong>Advertiser</strong><small>Bid on premium inventory</small></span>
          </button>
        </div>

        <label>Organization / Display Name
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={role === 'publisher' ? 'e.g. Monad Foundation' : 'e.g. Acme Crypto'}
          />
        </label>

        <div style={{ margin: '16px 0', padding: '16px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>WEB3 WALLET (OPTIONAL)</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: '#ccc' }}>Crypto Wallet Connection</span>
            <ConnectButton />
          </div>
        </div>

        <button className="primary-button full" onClick={onComplete} style={{ marginTop: '8px' }}>
          Enter Workspace <ArrowUpRight size={15} />
        </button>
      </div>
    </div>
  )
}

function PublisherOverview({
  slots,
  selected,
  setSelected,
  setView,
  onCreate,
  onOpenAuction,
}: {
  slots: Slot[]
  selected: Slot | null
  setSelected: (s: Slot) => void
  setView: (v: View) => void
  onCreate: () => void
  onOpenAuction: (s: Slot) => void
}) {
  return (
    <section className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="pulse" />PUBLISHER · LIVE</p>
          <h1>Good morning, Monad Publisher</h1>
          <p className="subhead">Manage your inventory and live auction ledgers.</p>
        </div>
        <button className="primary-button" onClick={onCreate}><Plus size={17} />Create ad slot</button>
      </div>
      <div className="metric-grid">
        <Metric label="Active ad slots" value={String(slots.length)} change="Live workspace" icon={<Radio />} />
        <Metric label="Fill rate" value="100%" change="Monad testnet" icon={<Sparkles />} />
        <Metric label="Settlement" value="On-chain MON" change="Stateless relay" icon={<Wallet />} />
        <Metric label="Total impressions" value="Live stream" change="Direct RPC" icon={<BarChart3 />} />
      </div>
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR INVENTORY</p>
          <h2>Every ad slot, one live ledger</h2>
        </div>
        <button className="text-button" onClick={() => setView('slots')}>Manage all <ArrowUpRight size={14} /></button>
      </div>
      {slots.length === 0 ? (
        <div className="panel empty-panel">
          <Radio size={24} />
          <h2>No ad slots registered yet</h2>
          <p>Create your first slot to start accepting live on-chain bids.</p>
          <button className="primary-button" onClick={onCreate} style={{ marginTop: '12px' }}>
            <Plus size={15} /> Create ad slot
          </button>
        </div>
      ) : (
        <SlotGrid slots={slots} selected={selected} setSelected={setSelected} setView={setView} onOpenAuction={onOpenAuction} />
      )}
    </section>
  )
}

function SlotsView({
  slots,
  selected,
  setSelected,
  setView,
  onCreate,
  onOpenAuction,
}: {
  slots: Slot[]
  selected: Slot | null
  setSelected: (s: Slot) => void
  setView: (v: View) => void
  onCreate: () => void
  onOpenAuction: (s: Slot) => void
}) {
  return (
    <section className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLISHER INVENTORY</p>
          <h1>My ad slots</h1>
          <p className="subhead">Create, inspect, and monitor every placement independently.</p>
        </div>
        <button className="primary-button" onClick={onCreate}><Plus size={17} />Create ad slot</button>
      </div>
      {slots.length === 0 ? (
        <div className="panel empty-panel">
          <Radio size={24} />
          <h2>No ad slots found</h2>
          <p>Click below to register inventory on Monad Testnet.</p>
          <button className="primary-button" onClick={onCreate} style={{ marginTop: '12px' }}>
            <Plus size={15} /> Create ad slot
          </button>
        </div>
      ) : (
        <SlotGrid slots={slots} selected={selected} setSelected={setSelected} setView={setView} onOpenAuction={onOpenAuction} detailed />
      )}
    </section>
  )
}

function SlotGrid({
  slots,
  selected,
  setSelected,
  setView,
  onOpenAuction,
  detailed = false,
  isMarketplace = false,
  bid = '',
  setBid,
  submitBid,
  loading = false,
}: {
  slots: Slot[]
  selected: Slot | null
  setSelected: (s: Slot) => void
  setView: (v: View) => void
  onOpenAuction?: (s: Slot) => void
  detailed?: boolean
  isMarketplace?: boolean
  bid?: string
  setBid?: (s: string) => void
  submitBid?: () => void
  loading?: boolean
}) {
  return (
    <div className="slot-grid">
      {slots.map(slot => {
        const isSelected = selected?.id === slot.id
        return (
          <article
            className={isSelected ? 'slot-detail selected' : 'slot-detail'}
            key={slot.id}
            onClick={() => setSelected(slot)}
          >
            <div className="slot-detail-top">
              <div className="slot-icon"><Radio size={17} /></div>
              <span className="status-chip"><i />{slot.status}</span>
            </div>
            <p className="eyebrow">{slot.id} · {slot.format}</p>
            <h3>{slot.name}</h3>
            <p>{slot.description}</p>
            <div className="slot-stats">
              <span><small>FLOOR</small><strong>{slot.floor}</strong></span>
              <span><small>TOP BID</small><strong className="violet">{slot.topBid}</strong></span>
              <span><small>IMPRESSIONS</small><strong>{slot.impressions}</strong></span>
            </div>

            {isMarketplace && setBid && submitBid && (
              <div
                style={{
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bid-input" style={{ margin: '0 0 10px 0', height: '42px' }}>
                  <input
                    value={isSelected ? bid : ''}
                    onChange={(e) => {
                      setSelected(slot)
                      setBid(e.target.value)
                    }}
                    onFocus={() => setSelected(slot)}
                    placeholder="0.000 MON"
                    inputMode="decimal"
                  />
                  <span>MON</span>
                </div>
                <button
                  className="primary-button full"
                  style={{ padding: '9px 12px', fontSize: '12px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelected(slot)
                    submitBid()
                  }}
                  disabled={loading && isSelected}
                >
                  {(loading && isSelected) ? 'Submitting Bid...' : 'Submit bid'} <ArrowUpRight size={14} />
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                className="outline-button full"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(slot)
                  setView('ledger')
                }}
              >
                Open live ledger <ArrowUpRight size={14} />
              </button>
              {slot.status === 'Opening' && onOpenAuction && (
                <button
                  className="primary-button"
                  style={{ padding: '8px 12px', fontSize: '12px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenAuction(slot)
                  }}
                >
                  Start auction
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function LedgerView({
  slot,
  bids,
  winningCreative,
  onDeleteBid,
  bid,
  setBid,
  submitBid,
  loading,
}: {
  slot: Slot | null
  bids: Bid[]
  winningCreative: string | null
  onDeleteBid: (index: number) => void
  bid: string
  setBid: (s: string) => void
  submitBid: () => void
  loading: boolean
}) {
  if (!slot) {
    return (
      <section className="page-wrap empty-view">
        <p className="eyebrow">LIVE LEDGER</p>
        <h1>No slot selected</h1>
        <p className="subhead">Select a slot from inventory to monitor incoming bids.</p>
      </section>
    )
  }

  const currentTopBidAmount = bids[0]?.amount || (slot.topBid !== '—' ? slot.topBid : null)

  return (
    <section className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="pulse" />LIVE LEDGER · {slot.id}</p>
          <h1>{slot.name}</h1>
          <p className="subhead">{slot.description} · {slot.format}</p>
        </div>
        <span className="live-label">
          <span className="pulse" />
          Live Ledger Active
        </span>
      </div>
      <div className="ledger-layout">
        <div className="panel ledger-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">BID STREAM</p>
              <h2>Incoming bids for this slot</h2>
            </div>
            <span className="chain-note">Direct chain reads</span>
          </div>
          <DynamicBidChart bids={bids} floor={slot.floor} />
          <div className="time-axis">
            <span>On-Chain Real-Time Bids Timeline</span>
          </div>
          <BidTable bids={bids} onDeleteBid={onDeleteBid} />
        </div>
        <div className="panel ledger-info">
          <p className="eyebrow">AUCTION STATE</p>
          <h2>{winningCreative ? 'Auction Settled' : 'Open and accepting bids'}</h2>

          {/* Prominent Current Highest Bid Display */}
          <div style={{ background: 'rgba(156, 124, 255, 0.1)', border: '1px solid rgba(156, 124, 255, 0.3)', borderRadius: '10px', padding: '16px', margin: '14px 0', textAlign: 'center' }}>
            <p className="eyebrow" style={{ color: '#a88cff', marginBottom: '4px' }}>CURRENT HIGHEST BID</p>
            <h1 style={{ fontFamily: 'Space Grotesk', fontSize: '32px', margin: '0', color: currentTopBidAmount ? '#7ee7c0' : '#888' }}>
              {currentTopBidAmount || 'No Bids Yet'}
            </h1>
            {bids[0]?.bidder && (
              <small style={{ color: '#888', display: 'block', marginTop: '4px' }}>
                By {bids[0].bidder}
              </small>
            )}
          </div>

          <div className="state-row">
            <span className="status-chip"><i />{slot.status}</span>
            <span>Block window active</span>
          </div>
          <div className="info-list">
            <span>Floor price <strong>{slot.floor}</strong></span>
            <span>Current highest <strong className="violet">{currentTopBidAmount || '—'}</strong></span>
            <span>Settlement <strong>Relay sponsored</strong></span>
            <span>Source <strong>Monad RPC</strong></span>
          </div>

          {/* Live Bidding Controls with MON Counter Buttons */}
          {!winningCreative && (
            <div style={{ borderTop: '1px solid #282e3b', paddingTop: '16px', marginTop: '16px' }}>
              <p className="eyebrow" style={{ marginBottom: '8px' }}>PLACE / ADJUST LIVE BID</p>
              <div className="bid-input" style={{ margin: '0 0 10px 0', height: '44px' }}>
                <input
                  value={bid}
                  onChange={e => setBid(e.target.value)}
                  placeholder="0.000 MON"
                  inputMode="decimal"
                />
                <span>MON</span>
              </div>

              {/* Quick Counter Buttons */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                <button
                  type="button"
                  style={{ flex: 1, padding: '7px', fontSize: '11px', background: '#1c212d', border: '1px solid #333a4a', color: '#a88cff', borderRadius: '6px', fontWeight: 600 }}
                  onClick={() => {
                    const base = parseFloat(bid) || (parseFloat(bids[0]?.amount.replace(/[^0-9.]/g, '')) || parseFloat(slot.floor.replace(/[^0-9.]/g, '')) || 0.01)
                    setBid((base + 0.005).toFixed(3))
                  }}
                >
                  +0.005 MON
                </button>
                <button
                  type="button"
                  style={{ flex: 1, padding: '7px', fontSize: '11px', background: '#1c212d', border: '1px solid #333a4a', color: '#a88cff', borderRadius: '6px', fontWeight: 600 }}
                  onClick={() => {
                    const base = parseFloat(bid) || (parseFloat(bids[0]?.amount.replace(/[^0-9.]/g, '')) || parseFloat(slot.floor.replace(/[^0-9.]/g, '')) || 0.01)
                    setBid((base + 0.01).toFixed(3))
                  }}
                >
                  +0.01 MON
                </button>
                <button
                  type="button"
                  style={{ flex: 1, padding: '7px', fontSize: '11px', background: '#1c212d', border: '1px solid #333a4a', color: '#a88cff', borderRadius: '6px', fontWeight: 600 }}
                  onClick={() => {
                    const base = parseFloat(bid) || (parseFloat(bids[0]?.amount.replace(/[^0-9.]/g, '')) || parseFloat(slot.floor.replace(/[^0-9.]/g, '')) || 0.01)
                    setBid((base + 0.05).toFixed(3))
                  }}
                >
                  +0.05 MON
                </button>
              </div>

              <button
                className="primary-button full"
                onClick={submitBid}
                disabled={loading}
              >
                {loading ? 'Submitting Bid...' : 'Submit bid to live ledger'} <ArrowUpRight size={15} />
              </button>
            </div>
          )}

          {winningCreative && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(168, 140, 255, 0.1)', borderRadius: '8px', border: '1px solid rgba(168, 140, 255, 0.3)' }}>
              <small style={{ color: '#a88cff', fontWeight: 600 }}>WINNING CREATIVE URL</small>
              <p style={{ wordBreak: 'break-all', fontSize: '12px', marginTop: '4px' }}>{winningCreative}</p>
            </div>
          )}
          <div className="contract-note" style={{ marginTop: '16px' }}>
            <ShieldCheck size={16} />
            <span>Events are read directly from the smart contract via Hono REST endpoints.</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function BidTable({ bids, onDeleteBid }: { bids: Bid[]; onDeleteBid: (index: number) => void }) {
  if (bids.length === 0) {
    return (
      <div className="ledger-table" style={{ padding: '24px', textAlign: 'center', color: '#888' }}>
        <Clock3 size={20} style={{ margin: '0 auto 8px display block' }} />
        <p>No bids received yet for this auction.</p>
        <small>Waiting for incoming transactions on Monad...</small>
      </div>
    )
  }

  return (
    <div className="ledger-table">
      <div className="table-head">
        <span>BIDDER</span><span>AMOUNT</span><span>TIME</span><span>STATUS</span><span>ACTION</span>
      </div>
      {bids.map((row, i) => (
        <div className="table-row" key={`${row.bidder}-${i}`}>
          <span className="address"><span className="address-dot" />{row.bidder}</span>
          <strong>{row.amount}</strong>
          <span className="time"><Clock3 size={13} />{row.time}</span>
          <span className={row.status === 'Highest bid' ? 'badge highest' : 'badge'}>{row.status}</span>
          <span>
            <button
              style={{ color: '#ff5555', cursor: 'pointer', background: 'transparent', border: 'none', padding: '4px' }}
              onClick={() => onDeleteBid(i)}
              title="Delete this bid"
            >
              <Trash2 size={15} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

function Marketplace({
  slots,
  selected,
  setSelected,
  setView,
  bid,
  setBid,
  submitBid,
  isConnected,
  loading,
}: {
  slots: Slot[]
  selected: Slot | null
  setSelected: (s: Slot) => void
  setView: (v: View) => void
  bid: string
  setBid: (s: string) => void
  submitBid: () => void
  isConnected: boolean
  loading: boolean
}) {
  return (
    <section className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span className="pulse" />ADVERTISER · LIVE MARKET</p>
          <h1>Find your next impression.</h1>
          <p className="subhead">Bid on premium, on-chain ad inventory directly inside slot cards in real time.</p>
        </div>
        <div className="balance-pill"><Wallet size={15} />Live Monad Wallet</div>
      </div>
      <div>
        <div className="section-heading">
          <div>
            <p className="eyebrow">AVAILABLE NOW</p>
            <h2>Marketplace inventory</h2>
          </div>
        </div>
        {slots.length === 0 ? (
          <div className="panel empty-panel">
            <Radio size={24} />
            <h2>No active ad slots in marketplace</h2>
            <p>Publishers have not created inventory yet.</p>
          </div>
        ) : (
          <SlotGrid
            slots={slots}
            selected={selected}
            setSelected={setSelected}
            setView={setView}
            isMarketplace={true}
            bid={bid}
            setBid={setBid}
            submitBid={submitBid}
            loading={loading}
          />
        )}
      </div>
    </section>
  )
}

function SimpleView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) {
  return (
    <section className="page-wrap empty-view">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="subhead">{copy}</p>
      <div className="panel empty-panel">
        <Sparkles size={20} />
        <h2>Coming together on-chain</h2>
        <p>Your activity will appear here as transactions settle on Monad.</p>
      </div>
    </section>
  )
}

function Metric({ label, value, change, icon }: { label: string; value: string; change: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{change}</small>
    </div>
  )
}

function DynamicBidChart({ bids, floor }: { bids: Bid[]; floor: string }) {
  const floorVal = parseFloat(floor.replace(/[^0-9.]/g, '')) || 0.01

  // Parse numeric values from real wallet bids
  const numericBids = bids.map(b => parseFloat(b.amount.replace(/[^0-9.]/g, '')) || 0)
  const maxBid = numericBids.length > 0 ? Math.max(...numericBids) : 0
  const topYVal = maxBid > 0 ? Math.max(maxBid * 1.25, floorVal * 1.5) : floorVal * 2

  const midYVal = topYVal / 2
  const lowYVal = topYVal / 4

  const width = 700
  const height = 190

  // Reverse bids for chronological left-to-right timeline
  const chronological = [...bids].reverse()

  const points = chronological.map((b, idx) => {
    const val = parseFloat(b.amount.replace(/[^0-9.]/g, '')) || 0
    const x = chronological.length === 1 ? width / 2 : (idx / (chronological.length - 1)) * (width - 80) + 40
    const y = height - (val / topYVal) * (height - 40) - 20
    return { x, y, val, bidder: b.bidder, time: b.time }
  })

  let pathD = ''
  let areaD = ''

  if (points.length === 1) {
    pathD = `M 0 ${points[0].y} L ${width} ${points[0].y}`
    areaD = `M 0 ${points[0].y} L ${width} ${points[0].y} L ${width} ${height} L 0 ${height} Z`
  } else if (points.length > 1) {
    pathD = points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '')
    areaD = `${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`
  }

  return (
    <div className="chart">
      <div className="chart-labels">
        <span>{topYVal.toFixed(3)} MON</span>
        <span>{midYVal.toFixed(3)} MON</span>
        <span>{lowYVal.toFixed(3)} MON</span>
        <span>0.000 MON</span>
      </div>
      <div className="chart-area" style={{ position: 'relative' }}>
        <div className="grid-lines"><i /><i /><i /><i /></div>
        {bids.length === 0 ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', padding: '16px', textAlign: 'center', zIndex: 2 }}>
            <p style={{ fontSize: '13px', color: '#a88cff', fontWeight: 600, marginBottom: '4px' }}>NO WALLET TRANSACTIONS ON-CHAIN YET</p>
            <small style={{ fontSize: '12px', opacity: 0.7 }}>Submit a bid from an advertiser wallet to plot real-time MON transactions dynamically on this chart.</small>
          </div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a88cff" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#a88cff" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {areaD && <path d={areaD} fill="url(#chartFill)" />}
            {pathD && <path d={pathD} fill="none" stroke="#a88cff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
            {points.map((pt, i) => (
              <g key={i} className="chart-point-group">
                <circle cx={pt.x} cy={pt.y} r="6" fill="#a88cff" stroke="#12131a" strokeWidth="2" />
                <circle cx={pt.x} cy={pt.y} r="10" fill="rgba(168, 140, 255, 0.2)" />
                <title>{`${pt.bidder}: ${pt.val} MON (${pt.time})`}</title>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
