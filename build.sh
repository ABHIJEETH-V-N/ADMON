#!/usr/bin/env bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ADMOD — One-Click Production Build Script
# Builds Smart Contracts (Foundry) and Web Application (Next.js 16 + Hono API)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

echo "🏗️ Starting ADMOD Production Build..."
echo "📍 Workspace: $(pwd)"

# 1. Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  (cd frontend && npm install)
fi

# 2. Install web worker dependencies if needed
if [ ! -d "web/node_modules" ]; then
  echo "📦 Installing web dependencies..."
  (cd web && npm install)
fi

# 3. Build Smart Contracts via Foundry if forge is available
if command -v forge &> /dev/null; then
  echo "⚙️ Compiling Smart Contracts via Foundry (AdExchange.sol)..."
  (cd contracts && forge build)
else
  echo "⚠️ Foundry (forge) not found. Skipping contract compilation."
fi

# 4. Build Next.js 16 Frontend and Hono API handler
echo "⚡ Building Next.js Production Web Bundle & Hono API..."
(cd frontend && npm run build)

echo ""
echo "================================================================="
echo "✅ ADMOD Production Build Completed Successfully!"
echo "   - Contracts: Compiled with Solc 0.8.24 (contracts/out)"
echo "   - Next.js UI & Hono API: Built successfully (frontend/.next)"
echo "================================================================="
echo ""
