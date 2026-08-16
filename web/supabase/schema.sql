/**
 * Supabase SQL Schema
 * Run this in the Supabase SQL editor (or via supabase db push).
 *
 * IMPORTANT: Only publisher/slot METADATA lives here.
 * All auction state (bids, winner, settlement) is read directly from
 * the Monad blockchain — it never touches Supabase.
 */

-- ── Enable RLS ─────────────────────────────────────────────────────────────
-- Row Level Security ensures users can only read/write their own data.

-- ── Profiles ───────────────────────────────────────────────────────────────
-- Extended metadata for Supabase Auth users (role: publisher | advertiser)
create table if not exists public.profiles (
  id         uuid references auth.users(id) on delete cascade primary key,
  role       text not null check (role in ('publisher', 'advertiser')),
  created_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ── Slots ──────────────────────────────────────────────────────────────────
-- Static ad slot metadata. The on-chain slotId links this to the blockchain.
-- auction state (currentAuctionId, bids, winner) is NOT stored here.
create table if not exists public.slots (
  id              bigserial primary key,
  slot_id         integer    not null unique,        -- mirrors the on-chain uint256 slotId
  publisher_id    uuid       references public.profiles(id) on delete cascade not null,
  title           text       not null,
  description     text,
  floor_price_eth numeric    not null,               -- stored as ETH (e.g. 0.001), also sent to contract
  created_at      timestamptz default now() not null
);

alter table public.slots enable row level security;

-- Anyone can read slots (marketplace view)
create policy "Anyone can read slots"
  on public.slots for select
  using (true);

-- Only the owning publisher can insert/update their slot
create policy "Publishers can insert their own slots"
  on public.slots for insert
  with check (auth.uid() = publisher_id);

create policy "Publishers can update their own slots"
  on public.slots for update
  using (auth.uid() = publisher_id);
