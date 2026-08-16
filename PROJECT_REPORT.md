# ADMOD — Localhost Default Frontend Base URL Report

**Date**: August 16, 2026  
**Target Network**: Monad Testnet (`10143`)  
**Status**: 🟢 **Default NEXT_PUBLIC_API_URL Set to http://localhost:3000**

---

## 1. Executive Summary

ADMOD is a decentralized Real-Time Bids (RTB) ad exchange connecting publishers and advertisers through transparent, on-chain auction ledgers on the Monad network.

All core layers are fully built, integrated, 100% purged of mock data, Web3 Wallet connected, enabled with **Localhost Default Frontend API Base URL**:
1. **Frontend Env ([`frontend/.env`](file:///Users/devnarayanan/Documents/KIMI/kim-ui/ADMOD/frontend/.env))**: Updated line 5 to `NEXT_PUBLIC_API_URL=http://localhost:3000`.
2. **Pushed to GitHub**: Pushed commit `5f4fe7c` directly to `https://github.com/devnarayanan0/ADMOD.git`.

---

## 2. Updated Environment Configuration

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://zqlzobscllpdwuvxdeya.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1...
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz/
NEXT_PUBLIC_AD_EXCHANGE_ADDRESS=0x3a060d063421C3c249E105ceA81f58A5dABf7ce7
```