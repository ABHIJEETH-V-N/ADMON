#!/usr/bin/env bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ADMOD — One-Click Development Launcher
# Starts the Next.js Frontend & Hono API Handler on http://localhost:3000
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

echo "🚀 Starting ADMOD On-Chain RTB Exchange..."
echo "📍 Workspace: $(pwd)"

# 1. Verify / Install Frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  (cd frontend && pnpm install)
fi

# 2. Verify / Install Web worker dependencies if needed
if [ ! -d "web/node_modules" ]; then
  echo "📦 Installing web dependencies..."
  (cd web && npm install)
fi

echo ""
echo "================================================================="
echo "🟢 ADMOD Exchange Server starting on http://localhost:3000"
echo "   - Next.js 16 UI: http://localhost:3000"
echo "   - Hono REST API:  http://localhost:3000/api/*"
echo "   - Monad Testnet: https://testnet-rpc.monad.xyz/"
echo "================================================================="
echo ""

cd frontend
exec npx next dev --port 3000
