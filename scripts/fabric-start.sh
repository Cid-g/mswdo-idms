#!/bin/bash
# =============================================================================
# fabric-start.sh — Start / restart the Hyperledger Fabric test-network
# =============================================================================
# Run this from WSL2 every time you open a new session and need Fabric running.
# It will:
#   1. Stop any existing network cleanly
#   2. Start a fresh network with CA
#   3. Deploy the id-contract chaincode
#   4. Auto-detect the new private key (it changes on every restart!)
#   5. Update backend/.env automatically — no manual editing needed
#
# Usage:
#   bash scripts/fabric-start.sh
# =============================================================================

set -euo pipefail

# ── Paths (auto-detected from script location — works on any machine) ─────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FABRIC_DIR="$HOME/fabric-samples/test-network"
CHAINCODE_DIR="$PROJECT_ROOT/blockchain/chaincode"
ENV_FILE="$PROJECT_ROOT/backend/.env"

# ── Color helpers ──────────────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()   { echo -e "\033[1;32m  ✓\033[0m $*"; }
err()  { echo -e "\033[1;31m  ✗ ERROR:\033[0m $*" >&2; exit 1; }
line() { echo -e "\033[1;34m────────────────────────────────────────────────\033[0m"; }

line
echo -e "\033[1;36m  MSWDO IDMS — Hyperledger Fabric Launcher\033[0m"
line

# ── Pre-flight checks ──────────────────────────────────────────────────────────
[ -d "$FABRIC_DIR" ]    || err "fabric-samples not found. Run: bash scripts/fabric-setup.sh first."
[ -f "$ENV_FILE" ]      || err "backend/.env not found at: $ENV_FILE"
[ -d "$CHAINCODE_DIR" ] || err "Chaincode not found at: $CHAINCODE_DIR"

command -v docker >/dev/null 2>&1 || err "Docker is not running. Start Docker Desktop (Windows) first."

# Verify Docker is actually responsive (not just installed)
docker info >/dev/null 2>&1 || err "Docker daemon is not responding. Start Docker Desktop and try again."
ok "Docker is running"

# ── Stop existing network ──────────────────────────────────────────────────────
log "Stopping any existing Fabric network..."
cd "$FABRIC_DIR"
./network.sh down 2>/dev/null && ok "Previous network stopped" || ok "No previous network was running"

# ── Start network ──────────────────────────────────────────────────────────────
log "Starting Fabric network with CA (this takes ~60 seconds)..."
./network.sh up createChannel -ca
ok "Network started, channel 'mychannel' created"

# ── Deploy chaincode ───────────────────────────────────────────────────────────
log "Deploying chaincode: id-contract..."
./network.sh deployCC \
  -ccn id-contract \
  -ccp "$CHAINCODE_DIR" \
  -ccl javascript
ok "Chaincode deployed on mychannel"

# ── Auto-detect new private key ────────────────────────────────────────────────
KEY_DIR="$FABRIC_DIR/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore"
KEY_PATH=$(ls "$KEY_DIR/"*_sk 2>/dev/null | head -1)
[ -z "$KEY_PATH" ] && err "Could not find private key in: $KEY_DIR"
ok "Private key detected: $(basename "$KEY_PATH")"

# ── Update backend/.env ────────────────────────────────────────────────────────
log "Updating backend/.env..."

# Update or append each Fabric env var
update_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

update_env "FABRIC_ENABLED"          "true"
update_env "FABRIC_PRIVATE_KEY_PATH" "$KEY_PATH"

ok "backend/.env updated (FABRIC_ENABLED=true, new key path set)"

# ── Summary ────────────────────────────────────────────────────────────────────
line
echo -e "\033[1;32m  Fabric network is ready!\033[0m"
line
echo ""
echo "  Channel   : mychannel"
echo "  Chaincode : id-contract"
echo "  Key file  : $(basename "$KEY_PATH")"
echo ""
echo "  Start the backend (in WSL2):"
echo "  cd $PROJECT_ROOT/backend && npm run dev"
echo ""
echo "  To stop Fabric later:"
echo "  bash $SCRIPT_DIR/fabric-stop.sh"
echo ""
