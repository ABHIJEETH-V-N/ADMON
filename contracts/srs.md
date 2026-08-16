# SRS — Folder `contracts/` (Person A: Chain Lead)
## On-Chain RTB Exchange — Monad Testnet — Auction Engine & Advertiser Bots

> **Repo layout this SRS assumes:**
> ```
> repo/
>   contracts/   <- THIS document, THIS person builds everything here
>   web/         <- built by Person B, see /web/SRS-WEB.md
> ```
> The only thing Person B needs from this folder is the **ABI + deployed address** (see §6). Everything else in here is independent, so both people can start on hour 0 in parallel using the interface in §6 as the contract between you.

---

## 1. Purpose & the "completely on-chain" requirement

The previous draft of this project used a relayer as a **cache** of auction state that the browser polled. That is no longer the architecture. In this version:

- All auction **logic, state, and money movement** live in the smart contract (this was already true).
- All auction **reads** (has an auction opened, what bids exist, who won) are read **directly from the chain** by the frontend via RPC — nothing off-chain stores or serves auction state. See `web/SRS-WEB.md` §3 for how the browser reads chain state directly with viem + TanStack Query.
- The only off-chain code that still exists is two **stateless transaction relays** (open/settle) and the **advertiser bots**, both described below and in `web/SRS-WEB.md`. Neither holds funds, caches results, or makes pricing decisions. This folder is not responsible for that relay — it lives in `web/`. This folder is responsible for the contract those relays call, and for the bots that bid against it.

Your deliverable: a Solidity contract deployed to Monad testnet, its ABI exported for Person B, and a set of bot scripts that generate realistic bidding activity during the demo.

---

## 2. Tech stack

- **Solidity** ^0.8.24, **Foundry** (forge/cast/anvil) — faster iteration than Hardhat for a 6-hour window, and `forge test` gives you the fastest feedback loop.
- **Monad Testnet**
  - Chain ID: `10143` (`0x279f`)
  - RPC: `https://testnet-rpc.monad.xyz/`
  - Explorer: `https://testnet.monadexplorer.com/`
  - Faucet: `https://faucet.monad.xyz/`
  - Native gas token: `MON`
  - *(Confirm these against Monad's docs right before the hackathon — testnet endpoints occasionally rotate.)*
- **viem** (TypeScript) for the bot scripts — same library Person B uses, so ABI types are shareable.
- **Node.js 20+** to run the bots as long-running local/dev scripts during the demo (bots are advertiser-side infrastructure in real ad tech too — they are not part of the hosted publisher website, so they do not need to live on Cloudflare).

---

## 3. Functional Requirements — Smart Contract (`AdExchange.sol`)

**FR-1 `registerSlot(uint256 slotId, address publisher, uint256 floorPrice)`**
Registers an ad slot once. Reverts if `slotId` already registered. Stores `{publisher, floorPrice}`.

**FR-2 `openAuction(uint256 slotId) returns (uint256 auctionId)`**
- Reverts if slot not registered.
- Reverts if slot already has an unsettled auction open (prevents double-auctioning the same slot).
- Records `openBlock = block.number`, `closeBlock = block.number + BID_WINDOW_BLOCKS` (constant, default 3).
- Emits `AuctionOpened(auctionId, slotId, floorPrice, closeBlock)`.
- Callable by **anyone** — this is what makes it trustless; there is no privileged "relayer" role in the contract itself, only a convenience caller off-chain.

**FR-3 `placeBid(uint256 auctionId, string calldata creativeRef) payable`**
- `msg.value` **is** the bid amount — bidders escrow their bid directly, no separate approve/allowance step (simpler and more "on-chain-native" than an ERC20 approve flow for a hackathon).
- Reverts if `block.number >= closeBlock` (auction closed).
- Reverts if `msg.value <= floorPrice` and if `msg.value <= currentHighestBid`.
- Refunds the *previous* highest bidder's escrow immediately via a pull-pattern credit (see FR-5) when they're outbid — do not attempt a push-refund inside `placeBid`, that's a reentrancy footgun under time pressure.
- Emits `BidPlaced(auctionId, bidder, bidAmount, creativeRef)`.

**FR-4 `settleAuction(uint256 auctionId)`**
- Callable by **anyone**, only once `block.number >= closeBlock` and not already settled.
- Determines winner = highest bidder. Second-price logic (optional stretch, see §7): winner is charged `max(secondHighestBid + 1, floorPrice)`, difference between their full escrowed bid and that price is credited to their pull-balance.
- Transfers the clearing price to `slot.publisher` directly (`.call{value: ...}`, checked).
- Marks `settled = true`, stores `winner`, `winningPrice`, `winningCreativeRef`.
- Emits `AuctionSettled(auctionId, slotId, winner, winningPrice, winningCreativeRef)`.

**FR-5 `withdraw()`**
- Pull-pattern withdrawal for any address with a non-zero refund credit (outbid bidders, and winners' second-price rebate). Standard checks-effects-interactions: zero the balance before sending.

**FR-6 View helpers** (no state change, these are what the frontend calls directly — see `web/SRS-WEB.md` §3):
- `getAuction(uint256 auctionId) returns (Auction memory)`
- `getSlotCurrentAuction(uint256 slotId) returns (uint256 auctionId)` — lets the ad tag find "the auction currently open for slot X" without needing to know the ID in advance.
- `pendingWithdrawals(address) returns (uint256)`

---

## 4. Data model

```solidity
struct Slot {
    address publisher;
    uint256 floorPrice;
    uint256 currentAuctionId; // 0 if none open
}

struct Auction {
    uint256 slotId;
    uint256 openBlock;
    uint256 closeBlock;
    bool settled;
    address highestBidder;
    uint256 highestBid;
    string  highestCreativeRef;
    address winner;
    uint256 winningPrice;
    string  winningCreativeRef;
}
```

Events (this is the schema Person B's frontend decodes directly off-chain — keep field order stable, don't rename after sharing the ABI):

```solidity
event AuctionOpened(uint256 indexed auctionId, uint256 indexed slotId, uint256 floorPrice, uint256 closeBlock);
event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount, string creativeRef);
event AuctionSettled(uint256 indexed auctionId, uint256 indexed slotId, address indexed winner, uint256 winningPrice, string winningCreativeRef);
```

---

## 5. Advertiser bots (`contracts/bots/`)

**FR-7** — `bots/bot.ts`, run once per simulated advertiser (e.g. `npm run bot -- --name=acme --color=blue`):
- Connects to Monad testnet with its own funded private key (fund 3–4 bot wallets from the faucet ahead of time, don't do this live).
- Subscribes to `AuctionOpened` logs (viem `watchContractEvent`, polling is fine at this block speed — no need for a websocket provider).
- On hearing one, waits a small **random jitter** (0–800ms) then calls `placeBid` with:
  - a bid amount randomized within a configurable range, OR
  - a scripted value so one bot deterministically outbids another late in the window — do this for the demo run, not every test run, so the outcome doesn't look staged in your dry runs.
- Each bot has a **distinct `creativeRef`** (a hosted image URL, one per bot/color) — this is FR-15 from the original doc, kept as-is.

**FR-8** — Each bot script must print every action it takes to stdout with a timestamp (`[bot:acme] bid 0.014 MON on auction 3`). This terminal output *is* your visible on-chain-activity proof for the demo alongside the explorer tab — don't hide it in a log file.

---

## 6. The interface contract with `web/` (deliver this by end of Hour 2)

The moment your contract compiles and you have a local Anvil deployment working, export and hand off:

1. `contracts/out/AdExchange.sol/AdExchange.json` → copy the `abi` array to `web/src/lib/adExchangeAbi.ts` as a `const ... as const`.
2. The deployed address, once you deploy to Monad testnet, goes in `web/.env` as `VITE_AD_EXCHANGE_ADDRESS`.
3. Do **not** change function signatures or event field order after this handoff without telling Person B — they are decoding events by ABI shape.

---

## 7. What NOT to build (scope discipline)

- ERC20 payments (native MON `payable` bids only)
- Real second-price auction math is a nice-to-have, not required — a first-price ("highest bid wins and pays what they bid") auction is a legitimate, simpler fallback if you're short on time. Say so plainly in the demo narration if you ship first-price.
- Multi-slot-type/size auction rules
- Any admin/owner role beyond `registerSlot` — keep the contract permissionless for `openAuction`/`settleAuction`, that permissionlessness is part of the trustless pitch.
- Fraud detection / bid validation beyond floor price

---

## 8. Build plan with test checkpoints

Work through these in order. Do not move to the next step until the test for the current one passes — this is a 6-hour build, not a place to debug three broken layers at once.

### Step 1 — Contract skeleton + registerSlot (Target: 45 min)
**Build:** `Slot` struct, mapping, `registerSlot`. No auctions yet.
**Test:** `forge test` — write `test_RegisterSlot_StoresCorrectData()` and `test_RegisterSlot_RevertsOnDuplicate()`. Both green before moving on.

### Step 2 — openAuction (Target: +30 min)
**Build:** `Auction` struct, mapping, auto-incrementing `auctionId`, FR-2 logic, `AuctionOpened` event.
**Test:** `test_OpenAuction_EmitsEvent()`, `test_OpenAuction_RevertsIfSlotUnregistered()`, `test_OpenAuction_RevertsIfAlreadyOpen()`. Also manually: `forge script` to open one auction against local Anvil and confirm with `cast logs`.

### Step 3 — placeBid (Target: +60 min, the trickiest piece)
**Build:** FR-3, including the outbid-refund-credit path.
**Test:**
- `test_PlaceBid_RejectsBelowFloor()`
- `test_PlaceBid_RejectsBelowCurrentHighest()`
- `test_PlaceBid_RejectsAfterCloseBlock()` — use `vm.roll()` to fast-forward blocks in Foundry.
- `test_PlaceBid_CreditsOutbidBidder()` — place two bids, assert first bidder's `pendingWithdrawals` equals their original bid.
- Manual: two `cast send` calls from two different test private keys against local Anvil, then `cast call getAuction`.

### Step 4 — settleAuction + withdraw (Target: +60 min)
**Build:** FR-4, FR-5.
**Test:**
- `test_Settle_RevertsBeforeCloseBlock()`
- `test_Settle_PaysPublisher()` — assert publisher's balance increased by clearing price.
- `test_Settle_RevertsIfAlreadySettled()`
- `test_Withdraw_SendsCreditedBalance()`
- Manual end-to-end on local Anvil: register → open → 2 bids → roll blocks → settle → check publisher balance on `cast balance` and check loser can `withdraw`.

### Step 5 — Deploy to Monad testnet (Target: +30 min)
**Build:** `script/Deploy.s.sol`, deploy with `forge script ... --rpc-url $MONAD_RPC --broadcast`.
**Test:** Confirm the deploy tx and contract creation on `https://testnet.monadexplorer.com/`. Run `registerSlot` for one demo slot via `cast send` and confirm it on-chain. **Hand off ABI + address to Person B now** (§6) — this is the critical path dependency, don't sit on it.

### Step 6 — Bots (Target: +60 min)
**Build:** `bots/bot.ts` per FR-7/FR-8, fund 3 bot wallets from faucet, hardcode 3 distinct `creativeRef` image URLs.
**Test:** Run 2 bot instances in separate terminals against testnet, manually trigger `openAuction` via `cast send`, watch both bots log bids in real time, confirm on explorer, confirm `settleAuction` (call manually or let Person B's endpoint do it) picks the correct winner.

### Step 7 — Joint rehearsal (Target: remaining time)
**Build:** nothing new — this is integration time with Person B.
**Test:** Full script in `contracts/../DEMO.md` (write this jointly): open auction from the live website → bots bid live → settle → creative appears in the browser → explorer tab shows the real settlement tx. Run this exact sequence at least twice before presenting, without redeploying the contract in between (NFR-2 from the original spec still applies: don't touch a working deployment right before demo).

---

## 9. Definition of done for this folder

- [ ] Contract deployed to Monad testnet, address recorded in shared `.env.example`
- [ ] All `forge test` cases pass
- [ ] ABI handed to `web/`
- [ ] 3 bot scripts run concurrently and bid on a live testnet auction
- [ ] One full open → bid ×3 → settle cycle completes in under ~5 seconds on testnet (block time ~1s × `BID_WINDOW_BLOCKS`)
- [ ] Explorer link to a real settlement tx saved for the pitch deck
