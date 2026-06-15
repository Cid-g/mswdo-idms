#!/bin/bash
# =============================================================================
# fabric-stop.sh — Stop the Fabric network gracefully
# =============================================================================
# Run this when you're done working and want to stop Fabric.
# Sets FABRIC_ENABLED=false in backend/.env so the backend still runs
# without Fabric errors (blockchain features will be disabled).
#
# Usage:
#   bash scripts/fabric-stop.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FABRIC_DIR="$HOME/fabric-samples/test-network"
ENV_FILE="$PROJECT_ROOT/backend/.env"

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()   { echo -e "\033[1;32m  ✓\033[0m $*"; }
err()  { echo -e "\033[1;31m  ✗ ERROR:\033[0m $*" >&2; exit 1; }
line() { echo -e "\033[1;34m────────────────────────────────────────────────\033[0m"; }

line
echo -e "\033[1;36m  MSWDO IDMS — Stopping Hyperledger Fabric\033[0m"
line

[ -d "$FABRIC_DIR" ] || err "fabric-samples not found at $HOME/fabric-samples"
[ -f "$ENV_FILE" ]   || err "backend/.env not found at: $ENV_FILE"

log "Stopping Fabric network..."
cd "$FABRIC_DIR"
./network.sh down
ok "Network stopped and Docker containers removed"

log "Setting FABRIC_ENABLED=false in backend/.env..."
if grep -q "^FABRIC_ENABLED=" "$ENV_FILE"; then
  sed -i "s|^FABRIC_ENABLED=.*|FABRIC_ENABLED=false|" "$ENV_FILE"
else
  echo "FABRIC_ENABLED=false" >> "$ENV_FILE"
fi
ok "backend/.env updated (FABRIC_ENABLED=false)"

line
echo ""
echo "  Fabric stopped. The backend can still run in non-blockchain mode."
echo ""
echo "  To restart Fabric next time:"
echo "  bash $SCRIPT_DIR/fabric-start.sh"
echo ""
