/**
 * AdExchange Advertiser Bot — FR-7 & FR-8
 *
 * Usage:
 *   npm run bot -- --name=acme --color=blue
 *   npm run bot -- --name=buzz --color=red
 *   npm run bot -- --name=core --color=green
 *
 * Each bot instance:
 *   - Uses its own funded private key from .env
 *   - Subscribes to AuctionOpened events on-chain
 *   - Waits a random jitter (0–800ms) then places a bid
 *   - Logs every action with timestamp to stdout
 *
 * Run against Anvil first:
 *   anvil --block-time 1 &
 *   npm run bot -- --name=acme --color=blue
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env manually (no external dotenv needed for basic use) ──────────
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, ".env");
  try {
    const raw = readFileSync(envPath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      result[key] = val;
    }
    return result;
  } catch {
    // Fall back to process.env if no .env file
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };

// ── CLI argument parsing ──────────────────────────────────────────────────
function getArg(name: string): string | undefined {
  const flag = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(flag));
  return arg?.slice(flag.length);
}

const BOT_NAME  = getArg("name")  ?? "bot";
const BOT_COLOR = getArg("color") ?? "blue";

// ── Creative URLs per color ───────────────────────────────────────────────
// Each bot advertises a different brand/creative. Use real hosted images.
const CREATIVE_MAP: Record<string, string> = {
  blue:   "https://placehold.co/300x250/3B82F6/FFFFFF.png?text=ACME+Blue+Ad",
  red:    "https://placehold.co/300x250/EF4444/FFFFFF.png?text=BUZZ+Red+Ad",
  green:  "https://placehold.co/300x250/22C55E/FFFFFF.png?text=CORE+Green+Ad",
  yellow: "https://placehold.co/300x250/EAB308/000000.png?text=NOVA+Yellow+Ad",
  purple: "https://placehold.co/300x250/A855F7/FFFFFF.png?text=APEX+Purple+Ad",
};

const CREATIVE_URL = CREATIVE_MAP[BOT_COLOR] ?? CREATIVE_MAP.blue;

// ── Config ────────────────────────────────────────────────────────────────
const RPC_URL           = env.MONAD_RPC_URL ?? "http://127.0.0.1:8545";
const CONTRACT_ADDRESS  = (env.AD_EXCHANGE_ADDRESS ?? "") as `0x${string}`;
const BOT_MIN_ETH       = parseFloat(env.BOT_BID_MIN_ETH ?? "0.010");
const BOT_MAX_ETH       = parseFloat(env.BOT_BID_MAX_ETH ?? "0.025");
const BOT_MODE          = env.BOT_MODE ?? "random"; // "random" | "scripted"

// Scripted bid schedule for the demo run (bot:acme bids low first, then bot:core snipes)
const SCRIPTED_BIDS: Record<string, number> = {
  acme: 0.012,  // bids first, early in the window
  buzz: 0.016,  // outbids acme
  core: 0.022,  // snipes near end (highest, should win)
};

// ── Private key lookup ────────────────────────────────────────────────────
const KEY_MAP: Record<string, string | undefined> = {
  acme: env.BOT_PRIVATE_KEY_ACME,
  buzz: env.BOT_PRIVATE_KEY_BUZZ,
  core: env.BOT_PRIVATE_KEY_CORE,
};

// For Anvil local testing, use the well-known Anvil default keys if no .env
const ANVIL_DEFAULT_KEYS: Record<string, string> = {
  acme: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  buzz: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  core: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};

const rawKey =
  KEY_MAP[BOT_NAME] ??
  (RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost")
    ? ANVIL_DEFAULT_KEYS[BOT_NAME] ?? ANVIL_DEFAULT_KEYS.acme
    : undefined);

if (!rawKey) {
  console.error(`[bot:${BOT_NAME}] ❌ No private key found. Set BOT_PRIVATE_KEY_${BOT_NAME.toUpperCase()} in bots/.env`);
  process.exit(1);
}

if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS === "0x") {
  console.error(`[bot:${BOT_NAME}] ❌ AD_EXCHANGE_ADDRESS not set in bots/.env`);
  process.exit(1);
}

const account = privateKeyToAccount(rawKey as `0x${string}`);

// ── Monad testnet chain definition ────────────────────────────────────────
const monadChain = {
  id: RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost") ? 31337 : 10143,
  name: RPC_URL.includes("127.0.0.1") ? "Anvil" : "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: monadChain,
  transport: http(RPC_URL),
});

// ── Minimal ABI (only what the bot needs) ─────────────────────────────────
const ABI = [
  {
    name: "AuctionOpened",
    type: "event",
    inputs: [
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "slotId",    type: "uint256", indexed: true },
      { name: "floorPrice",type: "uint256", indexed: false },
      { name: "closeBlock",type: "uint256", indexed: false },
    ],
  },
  {
    name: "placeBid",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "auctionId",   type: "uint256" },
      { name: "creativeRef", type: "string"  },
    ],
    outputs: [],
  },
  {
    name: "getAuction",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "slotId",            type: "uint256" },
          { name: "openBlock",         type: "uint256" },
          { name: "closeBlock",        type: "uint256" },
          { name: "settled",           type: "bool"    },
          { name: "highestBidder",     type: "address" },
          { name: "highestBid",        type: "uint256" },
          { name: "highestCreativeRef",type: "string"  },
          { name: "winner",            type: "address" },
          { name: "winningPrice",      type: "uint256" },
          { name: "winningCreativeRef",type: "string"  },
        ],
      },
    ],
  },
] as const;

// ── Utilities ─────────────────────────────────────────────────────────────
function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
  console.log(`[${ts}] [bot:${BOT_NAME}] ${msg}`);
}

function randomJitter(): Promise<void> {
  const ms = Math.floor(Math.random() * 800);
  log(`⏳ jitter ${ms}ms before bidding`);
  return new Promise((r) => setTimeout(r, ms));
}

function chooseBidAmount(floorPrice: bigint): bigint {
  if (BOT_MODE === "scripted" && BOT_NAME in SCRIPTED_BIDS) {
    return parseEther(SCRIPTED_BIDS[BOT_NAME].toString());
  }
  // Random: pick between MIN and MAX, but always above floor
  const minWei = parseEther(BOT_MIN_ETH.toString());
  const maxWei = parseEther(BOT_MAX_ETH.toString());
  const range  = maxWei - minWei;
  const rand   = BigInt(Math.floor(Math.random() * Number(range)));
  const chosen = minWei + rand;
  // Ensure we beat the floor
  return chosen > floorPrice ? chosen : floorPrice + 1n;
}

// ── Main bot loop ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  log(`🤖 Starting | wallet: ${account.address}`);
  log(`📡 RPC: ${RPC_URL}`);
  log(`📋 Contract: ${CONTRACT_ADDRESS}`);
  log(`🎨 Creative: ${CREATIVE_URL}`);
  log(`🎲 Mode: ${BOT_MODE}`);
  log("👂 Listening for AuctionOpened events...");

  // Track auctions we've already bid on to avoid double-bidding
  const biddedOn = new Set<bigint>();

  const unwatch = publicClient.watchContractEvent({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    eventName: "AuctionOpened",
    pollingInterval: 500, // poll every 500ms — no WebSocket needed
    onLogs: async (logs) => {
      for (const event of logs) {
        const { auctionId, slotId, floorPrice, closeBlock } = event.args;
        if (auctionId === undefined) continue;

        log(`🔔 AuctionOpened — auctionId=${auctionId} slotId=${slotId} floor=${formatEther(floorPrice!)} MON closeBlock=${closeBlock}`);

        // Skip if already bid on this auction
        if (biddedOn.has(auctionId)) {
          log(`⏭️  Already bid on auction ${auctionId}, skipping`);
          continue;
        }

        biddedOn.add(auctionId);

        // Fire-and-forget bid attempt with jitter
        bidOnAuction(auctionId, floorPrice!).catch((err: unknown) => {
          log(`❌ Error bidding on auction ${auctionId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    },
    onError: (error) => {
      log(`⚠️  Event watcher error: ${error.message}`);
    },
  });

  log("✅ Event watcher active. Press Ctrl+C to stop.");

  // Keep the process alive
  process.on("SIGINT", () => {
    log("🛑 Shutting down...");
    unwatch();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    log("🛑 Shutting down...");
    unwatch();
    process.exit(0);
  });

  // Block forever
  await new Promise<void>(() => {});
}

async function bidOnAuction(auctionId: bigint, floorPrice: bigint): Promise<void> {
  await randomJitter();

  // Check auction is still open before bidding
  const auction = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: "getAuction",
    args: [auctionId],
  });

  const currentBlock = await publicClient.getBlockNumber();
  if (currentBlock >= auction.closeBlock) {
    log(`⏰ Auction ${auctionId} already closed (block ${currentBlock} >= closeBlock ${auction.closeBlock}), skipping`);
    return;
  }

  if (auction.settled) {
    log(`✅ Auction ${auctionId} already settled, skipping`);
    return;
  }

  const bidAmount = chooseBidAmount(floorPrice);

  // Ensure we outbid the current highest
  const effectiveBid = bidAmount > auction.highestBid ? bidAmount : auction.highestBid + parseEther("0.001");

  log(`💸 Placing bid of ${formatEther(effectiveBid)} MON on auction ${auctionId}`);

  try {
    const txHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: "placeBid",
      args: [auctionId, CREATIVE_URL],
      value: effectiveBid,
    });

    log(`📤 Bid tx sent: ${txHash}`);

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "success") {
      log(`✅ Bid confirmed in block ${receipt.blockNumber} | auction=${auctionId} | amount=${formatEther(effectiveBid)} MON`);
    } else {
      log(`❌ Bid tx reverted | auction=${auctionId} | txHash=${txHash}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ placeBid failed: ${msg}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(`[bot:${BOT_NAME}] Fatal error:`, err);
  process.exit(1);
});
