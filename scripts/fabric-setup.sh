#!/bin/bash
# =============================================================================
# fabric-setup.sh — First-time Hyperledger Fabric setup on a new machine
# =============================================================================
# Run this ONCE after cloning the project on a new device (in WSL2/Ubuntu).
# After this completes, use fabric-start.sh for all future restarts.
#
# What this does:
#   1. Checks required tools (Docker, Node.js, curl, git)
#   2. Creates the docker-compose shim if needed
#   3. Downloads Hyperledger Fabric 2.5 samples + binaries (~1.5 GB)
#   4. Installs chaincode npm dependencies
#   5. Calls fabric-start.sh to launch the network
#
# Prerequisites (install these manually before running):
#   - WSL2 with Ubuntu 20.04 / 22.04
#   - Docker Desktop for Windows with WSL2 integration enabled
#   - Node.js 18+ (sudo apt install nodejs or use nvm)
#
# Usage:
#   bash scripts/fabric-setup.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHAINCODE_DIR="$PROJECT_ROOT/blockchain/chaincode"

FABRIC_VERSION="2.5.0"
FABRIC_CA_VERSION="1.5.7"

# ── Color helpers ──────────────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()   { echo -e "\033[1;32m  ✓\033[0m $*"; }
skip() { echo -e "\033[1;33m  ○\033[0m $* (skipped — already done)"; }
err()  { echo -e "\033[1;31m  ✗ ERROR:\033[0m $*" >&2; exit 1; }
line() { echo -e "\033[1;34m────────────────────────────────────────────────\033[0m"; }

line
echo -e "\033[1;36m  MSWDO IDMS — Hyperledger Fabric First-Time Setup\033[0m"
line
echo ""

# ── Step 1: Check prerequisites ────────────────────────────────────────────────
log "Step 1/5 — Checking prerequisites..."

command -v docker >/dev/null 2>&1 \
  || err "Docker not found.\n       Install Docker Desktop for Windows and enable WSL2 integration:\n       https://docs.docker.com/desktop/wsl/"

docker info >/dev/null 2>&1 \
  || err "Docker daemon is not responding.\n       Start Docker Desktop (Windows), wait for it to fully load, then retry."

command -v node >/dev/null 2>&1 \
  || err "Node.js not found.\n       Install it: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs"

command -v curl >/dev/null 2>&1 || err "curl not found. Run: sudo apt install -y curl"
command -v git  >/dev/null 2>&1 || err "git not found. Run: sudo apt install -y git"

NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo ok || echo fail)
[ "$NODE_VER" = "fail" ] && err "Node.js 18+ required. Current: $(node --version)"

ok "Docker     : $(docker --version | awk '{print $3}' | tr -d ',')"
ok "Node.js    : $(node --version)"
ok "All prerequisites met"
echo ""

# ── Step 2: docker-compose shim ────────────────────────────────────────────────
log "Step 2/5 — Setting up docker-compose shim..."
# Fabric scripts call 'docker-compose' (hyphen) but modern Docker uses 'docker compose' (space)
if command -v docker-compose >/dev/null 2>&1; then
  skip "docker-compose shim"
else
  echo '#!/bin/bash
exec docker compose "$@"' | sudo tee /usr/local/bin/docker-compose > /dev/null
  sudo chmod +x /usr/local/bin/docker-compose
  ok "docker-compose shim created at /usr/local/bin/docker-compose"
fi
echo ""

# ── Step 3: Download fabric-samples + binaries ────────────────────────────────
log "Step 3/5 — Downloading Hyperledger Fabric ${FABRIC_VERSION} (fabric-samples + binaries)..."
echo "  Note: This downloads ~1.5 GB of Docker images. May take 5-15 minutes on first run."
echo ""

if [ -d "$HOME/fabric-samples" ]; then
  skip "fabric-samples (already exists at $HOME/fabric-samples)"
  echo "         To reinstall: rm -rf ~/fabric-samples then re-run this script."
else
  cd "$HOME"
  curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
  FABRIC_VERSION="$FABRIC_VERSION" FABRIC_CA_VERSION="$FABRIC_CA_VERSION" \
    ./install-fabric.sh docker samples binary
  rm -f install-fabric.sh
  ok "fabric-samples installed at $HOME/fabric-samples"
fi
echo ""

# ── Step 4: Chaincode dependencies ────────────────────────────────────────────
log "Step 4/5 — Installing chaincode npm dependencies..."
cd "$CHAINCODE_DIR"
if [ -d "node_modules" ]; then
  skip "chaincode node_modules (already installed)"
else
  npm install --omit=dev
  ok "Chaincode dependencies installed"
fi
echo ""

# ── Step 5: Launch the network ────────────────────────────────────────────────
log "Step 5/5 — Launching Fabric network..."
bash "$SCRIPT_DIR/fabric-start.sh"
