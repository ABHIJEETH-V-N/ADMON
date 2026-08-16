# SRS — Folder `web/` (Person B: Frontend & Integration Lead)
## On-Chain RTB Exchange — Monad Testnet — Site, Ad Tag & Cloudflare Deployment

> **Repo layout this SRS assumes:**
> ```
> repo/
>   contracts/   <- built by Person A, see /contracts/SRS-CONTRACTS.md
>   web/         <- THIS document, THIS person builds everything here
> ```
> You depend on Person A for exactly two things: the contract **ABI** and the deployed **address** (contracts §6). You can build almost everything else — UI, ad tag, mock publisher page, endpoint scaffolding — against a **local Anvil deployment** before testnet address is ready, so don't block on them past hour 1.

---

## 1. Purpose & the "completely on-chain" requirement

This is the key architecture change from the earlier draft: **there is no off-chain auction-state cache or database, anywhere.**

Previously, a relayer polled the chain, cached "auction #4 settled, winner is X," and served that cache to the browser. That cache was a piece of centralized, off-chain state sitting between the contract and the page — even though it wasn't holding funds, it was still a thing you had to trust to relay results honestly.

In this version:

- The **browser reads chain state directly.** The ad tag and the site use `viem`'s public client to call `getAuction`, `getSlotCurrentAuction`, and to watch `AuctionOpened` / `AuctionSettled` events, straight from a Monad testnet RPC endpoint. TanStack Query just manages the polling/refetch lifecycle around those direct calls — it is not calling *your* backend, it's calling the chain.
- The **only** server-side code that exists is two **stateless, cache-free transaction relays** — `open` and `settle` — because a browser tab cannot safely hold a hot wallet private key. These two endpoints do nothing but sign and broadcast a transaction whose entire logic lives in the contract. They store nothing between requests and make zero decisions. This is explicitly *not* a trust boundary: anyone (a judge, a bot, another dev) could call `openAuction`/`settleAuction` themselves via `cast` and skip your endpoints entirely — they're a convenience, not a gatekeeper.
- If you want to remove even that: §8 documents the fully-trustless alternative (wallet-triggered open/settle) as a stretch goal.

---

## 2. Tech stack

- **TanStack Start** (TanStack Router + TanStack Query, SSR-capable, deploys cleanly to Cloudflare) — use this rather than bare TanStack Router so your two API routes and your React pages live in one project and one deploy.
- **viem** for all chain reads/writes (public client for reads, wallet client only inside the two server routes for writes).
- **Cloudflare Pages** (static assets + Pages Functions) or **Cloudflare Workers** (via `wrangler`) for hosting — TanStack Start has a Cloudflare deployment target; use it directly rather than hand-rolling adapters.
- **Tailwind CSS** for the mock publisher page styling (fast, no design system needed for a hackathon).
- Node 20+, `wrangler` CLI for local dev + deploy.

---

## 3. How the browser reads chain state (no backend involved)

This is the core mechanism both the site and the ad tag use. Write it once, share it everywhere:

```ts
// web/src/lib/chain.ts
import { createPublicClient, http } from "viem";

export const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz/"] } },
} as const;

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});
```

Then a TanStack Query hook wraps a direct `readContract` / `watchContractEvent` call — **not** a fetch to your own API:

```ts
// web/src/lib/useAuctionResult.ts
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "./chain";
import { adExchangeAbi } from "./adExchangeAbi";
import { AD_EXCHANGE_ADDRESS } from "./config";

export function useAuctionResult(auctionId: bigint | undefined) {
  return useQuery({
    queryKey: ["auction", auctionId?.toString()],
    queryFn: () =>
      publicClient.readContract({
        address: AD_EXCHANGE_ADDRESS,
        abi: adExchangeAbi,
        functionName: "getAuction",
        args: [auctionId!],
      }),
    enabled: auctionId !== undefined,
    refetchInterval: (query) => (query.state.data?.settled ? false : 250), // poll every 250ms until settled, per NFR-1
  });
}
```

This is what "completely on-chain" buys you concretely: if your Cloudflare deployment goes down mid-demo, the *reads* still work from any machine with the RPC URL and the ABI — only the two write-relay endpoints (§5) are Cloudflare-dependent.

---

## 4. Functional Requirements — Publisher-side ad tag (`web/public/adtag.js`)

**FR-1.** Publisher embeds one `<div>` + one script tag, no more integration effort than a typical ad tag:
```html
<div id="rtb-slot-4" data-slot-id="4" data-slot-size="300x250"></div>
<script src="/adtag.js" async></script>
```

**FR-2.** On load, scan the page for every `[data-slot-id]` element. For each one:
1. Read `slotId` from the attribute.
2. Call your `POST /api/auction/open` endpoint (§5) with `{ slotId }` to open a fresh auction (or, for the demo, this can be a manual "Request Ad" button instead of automatic-on-load — your call, FR-2 in the original spec allows either).
3. Take the returned `auctionId` and start polling `getAuction(auctionId)` **directly via viem** (§3) — not via a second backend call.

**FR-3.** Render "Ad loading…" immediately. Poll every ~250ms (fast enough to feel real-time against ~1s Monad blocks). If `settled` isn't `true` within 3 seconds, show a "no fill" fallback state — this is expected, legitimate ad-tech behavior, not a bug.

**FR-4.** On `settled === true`, inject the `winningCreativeRef` into the slot as an `<img>` wrapped in an `<a>` — keep creative format to "image URL + click-through link," nothing more elaborate.

---

## 5. Functional Requirements — the two stateless API endpoints

Built as TanStack Start server routes (which compile to Cloudflare Pages Functions), under `web/src/routes/api/`.

### `POST /api/auction/open`
**Request:** `{ "slotId": number }`
**Behavior:** loads a hot wallet from a Cloudflare secret (`RELAYER_PRIVATE_KEY`), calls `openAuction(slotId)` on-chain, waits for the transaction receipt, decodes the `AuctionOpened` event from the receipt logs.
**Response:** `{ "auctionId": string, "txHash": string }`
**Explicitly does not:** store the auction anywhere, cache anything, or make any decision — it is a thin signer. If this endpoint is down, anyone can call `openAuction` directly with `cast` or their own wallet and the system still works.

### `POST /api/auction/settle`
**Request:** `{ "auctionId": string }`
**Behavior:** calls `settleAuction(auctionId)`. Should be safe to call even slightly early — let it revert and surface that revert reason to the caller rather than trying to pre-validate timing client-side (the contract is the source of truth on timing, not this endpoint).
**Response:** `{ "txHash": string, "winner": string, "winningPrice": string }` (decoded from the `AuctionSettled` log in the receipt).
**Trigger:** call this automatically ~`BID_WINDOW_BLOCKS` × block time after open (a `setTimeout` in the browser is fine for a hackathon demo — call it from the ad tag once its local timer expects the window to have closed). No server-side cron needed.

**Both endpoints together are the entire backend.** There is no `GET /auction/:id/result` endpoint — that read happens directly on-chain per §3. This is the concrete difference from the earlier relayer-with-cache design.

---

## 6. Mock publisher page & dashboard

**FR-5.** One TanStack route (`/`) styled as a fake news/blog page with 1 ad slot for the base demo, and a "Request Ad" button to trigger `/api/auction/open` on demand for stage control.

**FR-6 (stretch, do this last if time remains — this is the single highest-value add-on per the original spec).** A `/dashboard` route showing 3–4 slots firing simultaneously, each with its own live event log panel, to visually demonstrate Monad's parallel execution — this is your closing "wow" moment, build it only after §4/§5 fully work end-to-end.

**FR-7.** A visible live event log component (any panel on the page is fine) that subscribes to `AuctionOpened` / `BidPlaced` / `AuctionSettled` via `publicClient.watchContractEvent` and prints each one with a timestamp as it happens — this is your on-screen proof of on-chain activity (NFR-3 from the original spec).

---

## 7. Cloudflare deployment

1. `npm create @tanstack/start@latest` (or add Start to an existing Router project), choose the Cloudflare Workers/Pages target when prompted.
2. `wrangler.toml`:
   ```toml
   name = "onchain-rtb-web"
   compatibility_date = "2026-01-01"
   pages_build_output_dir = "dist"
   ```
3. Secrets (never commit these):
   ```
   wrangler pages secret put RELAYER_PRIVATE_KEY
   ```
4. Public env vars (`.env`, safe to commit as `.env.example` with placeholders):
   ```
   VITE_AD_EXCHANGE_ADDRESS=0x...
   VITE_MONAD_RPC_URL=https://testnet-rpc.monad.xyz/
   ```
5. Deploy: `wrangler pages deploy dist` (or connect the GitHub repo to a Cloudflare Pages project for auto-deploy on push — recommended so Person C/A can see the live URL update without asking you to redeploy).
6. **Do this deploy early** (end of hour 1, even with a stub page) — first-deploy configuration issues are the #1 hackathon time sink, and you want them behind you before the contract address even exists.

---

## 8. Stretch goal — remove the relay entirely

If time allows, replace §5's two endpoints with wallet-triggered calls: the "Request Ad" button and the settle-timer both call `writeContract` through a browser wallet (e.g. `injected` connector, MetaMask configured for Monad testnet) instead of hitting your API. This makes the publisher-side app **literally zero-backend** — genuinely nothing but static files reading and writing chain state directly. Mention this explicitly in the pitch as the "even more on-chain than what we shipped" roadmap item if you don't have time to build it; it's a legitimate answer to "why do you have any backend at all."

---

## 9. Build plan with test checkpoints

### Step 1 — Scaffold + deploy skeleton (Target: 45 min)
**Build:** `npm create @tanstack/start`, a placeholder home route, Cloudflare Pages project connected to the repo.
**Test:** Push to `main`, confirm the Cloudflare Pages URL serves the placeholder page. Do this before writing any chain code.

### Step 2 — Chain read layer against local Anvil (Target: +45 min)
**Build:** `lib/chain.ts`, `lib/useAuctionResult.ts` per §3, pointed at a local Anvil instance running Person A's contract (get the ABI from them as soon as it exists, even mid-development).
**Test:** Manually call `openAuction`/`placeBid` via `cast` against Anvil in one terminal, confirm your React page's polling hook picks up the state change within ~250ms without a page refresh.

### Step 3 — API relay endpoints (Target: +45 min)
**Build:** `/api/auction/open` and `/api/auction/settle` per §5, using a locally-funded Anvil private key first.
**Test:** `curl -X POST localhost:8788/api/auction/open -d '{"slotId":4}'` returns a real `auctionId` and `txHash`; confirm on `cast receipt`. Repeat for settle after rolling blocks.

### Step 4 — Ad tag (Target: +60 min)
**Build:** `public/adtag.js` per FR-1–FR-4, embedded in the mock publisher route.
**Test:** Load the publisher page, click "Request Ad," watch the slot go loading → creative within a few seconds, purely from your own local Anvil + local dev server. Kill the settle-timer deliberately once to confirm the 3-second no-fill fallback renders correctly.

### Step 5 — Switch to Monad testnet (Target: +30 min)
**Build:** swap `.env` values to the testnet address Person A hands off, redeploy relayer wallet funded from faucet.
**Test:** Repeat Step 4's test but against testnet — confirm real latency is still within NFR-1's 1–3 second target, confirm the explorer link for the settlement tx works.

### Step 6 — Live event log + dashboard stretch (Target: remaining time)
**Build:** FR-7, then FR-6 if time remains.
**Test:** Trigger 3 slots' auctions back-to-back (or via the dashboard button), confirm all three event logs update independently and don't cross-contaminate each other's state (this is literally testing the parallel-execution claim you're pitching).

### Step 7 — Joint rehearsal
Same as `contracts/SRS-CONTRACTS.md` §8 Step 7 — run the full demo script together at least twice against the deployed Cloudflare URL and the real testnet contract, without redeploying either in between.

---

## 10. Definition of done for this folder

- [ ] Site deployed and reachable at a Cloudflare Pages URL
- [ ] Ad tag reads auction state directly from chain (no custom `GET` result endpoint exists)
- [ ] `/api/auction/open` and `/api/auction/settle` are the only two server routes, both stateless
- [ ] Mock publisher page: loading → creative render cycle works end-to-end on testnet
- [ ] Live event log visibly streams `AuctionOpened`/`BidPlaced`/`AuctionSettled`
- [ ] (Stretch) multi-slot dashboard demonstrating parallel auctions
