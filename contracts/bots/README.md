# Advertiser Bots — Setup & Usage

These scripts simulate advertiser bidding activity during the demo. Each bot instance
represents a distinct advertiser with its own wallet and creative.

## Prerequisites

- Node.js 20+
- 3 Monad Testnet wallets funded from https://faucet.monad.xyz/
- Contract deployed (run `forge script script/Deploy.s.sol` first)

## Setup

```bash
cd contracts/bots
npm install

# Copy the env template
cp .env.example .env
# Fill in your private keys and the deployed contract address
```

## Running Against Local Anvil (development)

Open 4 terminals:

```bash
# Terminal 1 — start Anvil with 1s block time
anvil --block-time 1

# Terminal 2 — deploy contract (uses Anvil default key)
cd contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast -vvvv

# Terminal 3 — start bots (no .env needed on Anvil, uses built-in test keys)
cd contracts/bots
MONAD_RPC_URL=http://127.0.0.1:8545 \
AD_EXCHANGE_ADDRESS=<deployed-address> \
npm run bot -- --name=acme --color=blue &
npm run bot -- --name=buzz --color=red &
npm run bot -- --name=core --color=green

# Terminal 4 — trigger an auction manually to see bots respond
cast send <contract-address> "openAuction(uint256)" 4 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://127.0.0.1:8545

# After 3 blocks, settle:
cast rpc anvil_mine 3 --rpc-url http://127.0.0.1:8545
cast send <contract-address> "settleAuction(uint256)" 1 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://127.0.0.1:8545

# Check winner:
cast call <contract-address> "getAuction(uint256)(uint256,uint256,uint256,bool,address,uint256,string,address,uint256,string)" 1 \
  --rpc-url http://127.0.0.1:8545
```

## Running Against Monad Testnet

```bash
# Fill in bots/.env with real keys and testnet contract address, then:
npm run bot:acme &   # [bot:acme] logs bid 0.012 MON ...
npm run bot:buzz &   # [bot:buzz] logs bid 0.016 MON ...
npm run bot:core     # [bot:core] logs bid 0.022 MON ... (scripted winner)
```

## Demo Mode vs. Random Mode

Set `BOT_MODE=scripted` in `.env` for the demo:
- **acme** bids 0.012 MON (loses)
- **buzz** bids 0.016 MON (loses)  
- **core** bids 0.022 MON (wins) — green creative appears in browser

Set `BOT_MODE=random` for test runs so the outcome isn't predictable.

## What Each Bot Prints

```
[2026-08-16 07:00:00.000] [bot:acme] 🤖 Starting | wallet: 0xf39Fd...
[2026-08-16 07:00:00.100] [bot:acme] 👂 Listening for AuctionOpened events...
[2026-08-16 07:00:03.200] [bot:acme] 🔔 AuctionOpened — auctionId=1 slotId=4 floor=0.001 MON closeBlock=105
[2026-08-16 07:00:03.250] [bot:acme] ⏳ jitter 347ms before bidding
[2026-08-16 07:00:03.600] [bot:acme] 💸 Placing bid of 0.012 MON on auction 1
[2026-08-16 07:00:04.100] [bot:acme] 📤 Bid tx sent: 0xabc123...
[2026-08-16 07:00:05.000] [bot:acme] ✅ Bid confirmed in block 103 | auction=1 | amount=0.012 MON
```
