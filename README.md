# ADMOD — On-Chain Real-Time Bidding (RTB) Ad Exchange

[![Monad Testnet](https://img.shields.io/badge/Network-Monad%20Testnet%20(10143)-8a2be2)](https://testnet-rpc.monad.xyz/)
[![Framework](https://img.shields.io/badge/Framework-Next.js%2016%20%7C%20Hono-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)

ADMOD is a high-performance, decentralized ad exchange delivering sub-second real-time bidding, slot isolation, and transparent on-chain auction settlement on the Monad network.

---

## 🛠️ Build & Development Commands

### 1. Build Smart Contracts & Web App
```bash
./build.sh
```
Compiles smart contracts (`AdExchange.sol`) with Solc 0.8.24 and builds the production Next.js 16 UI and Hono REST API.

### 2. Start Application Locally
```bash
./start.sh
```
Starts Next.js UI and Hono REST API on **`http://localhost:3000`**.

### 3. Docker Container Deployment
```bash
docker compose up --build
```
Builds the multi-stage Docker image and serves the application at **`http://localhost:3000`**.

---

## 🏛️ Application Navigation & Workspaces

### 1. Publisher Workspace
- **Overview**: Real-time stats (`Active ad slots`, `Fill rate`, `Settlement`, `Total impressions`).
- **My Ad Slots**: Create and inspect inventory slot placements.
- **Live Ledgers**: Monitor live MON bid streams and on-chain auction states.

### 2. Advertiser Workspace
- **Marketplace**: Browse active ad inventory cards with embedded bidding inputs (`[ 0.000 MON ]`) and **Submit bid ↗** buttons.
- **Live Ledgers**: Track incoming bids, current highest bid badge (`32px` mint font), MON counter buttons (`+0.005 MON`, `+0.01 MON`, `+0.05 MON`), and selective bid deletion.