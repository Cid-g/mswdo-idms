#!/bin/bash
# =============================================================================
# backend-setup.sh — First-time backend dependency setup on a new machine
# =============================================================================
# Run this ONCE after cloning the project on a new device (in WSL2/Ubuntu).
# What this does:
#   1. Installs pipx (Python app manager, no system-package conflicts)
#   2. Installs rembg[cpu] — AI background removal for applicant photos
#   3. Pre-warms the rembg ONNX model so first upload is not slow
#   4. Installs backend npm dependencies
#   5. Checks for a backend/.env file
#
# Prerequisites:
#   - WSL2 with Ubuntu 20.04 / 22.04 / 24.04
#   - Node.js 18+ (sudo apt install nodejs or use nvm)
#   - Internet connection for first-time model download (~170 MB)
#
# Usage:
#   bash scripts/backend-setup.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

# ── Color helpers ──────────────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m==>\033[0m $*"; }
ok()   { echo -e "\033[1;32m  ✓\033[0m $*"; }
skip() { echo -e "\033[1;33m  ○\033[0m $* (skipped — already done)"; }
warn() { echo -e "\033[1;33m  !\033[0m $*"; }
err()  { echo -e "\033[1;31m  ✗ ERROR:\033[0m $*" >&2; exit 1; }
line() { echo -e "\033[1;34m────────────────────────────────────────────────\033[0m"; }

line
echo -e "\033[1;36m  MSWDO IDMS — Backend First-Time Setup\033[0m"
line
echo ""

# ── Step 1: pipx ──────────────────────────────────────────────────────────────
log "Step 1/4 — Checking pipx..."

if command -v pipx >/dev/null 2>&1; then
  skip "pipx ($(pipx --version))"
else
  log "Installing pipx..."
  sudo apt-get update -qq
  sudo apt-get install -y pipx
  pipx ensurepath
  # Make pipx available in this session without reopening shell
  export PATH="$HOME/.local/bin:$PATH"
  ok "pipx installed"
fi
echo ""

# ── Step 2: rembg[cpu] ────────────────────────────────────────────────────────
log "Step 2/4 — Checking rembg (AI background removal)..."

if command -v rembg >/dev/null 2>&1; then
  # Check if onnxruntime backend is present (rembg[cli] without [cpu] won't work)
  if python3 -c "import onnxruntime" 2>/dev/null; then
    skip "rembg with onnxruntime"
  else
    warn "rembg is installed but missing onnxruntime — injecting now..."
    pipx inject rembg onnxruntime
    ok "onnxruntime injected into rembg"
  fi
else
  log "Installing rembg[cpu] via pipx (includes onnxruntime)..."
  pipx install "rembg[cpu]"
  export PATH="$HOME/.local/bin:$PATH"
  ok "rembg installed"
fi
echo ""

# ── Step 3: Pre-warm rembg model ──────────────────────────────────────────────
log "Step 3/4 — Pre-warming rembg ONNX model (~170 MB download on first run)..."
echo "  This downloads the u2net.onnx model so the first photo upload is not slow."
echo ""

REMBG_MODEL_DIR="$HOME/.u2net"
if [ -f "$REMBG_MODEL_DIR/u2net.onnx" ]; then
  skip "u2net.onnx model (already cached at $REMBG_MODEL_DIR)"
else
  # Create a tiny PNG and run rembg to trigger the model download
  TMP_IN="/tmp/rembg-warmup-in.png"
  TMP_OUT="/tmp/rembg-warmup-out.png"
  python3 -c "
import struct, zlib, base64, sys
# Minimal 1x1 red PNG (no PIL dependency)
raw = b'\x00\xff\x00\x00'
compressed = zlib.compress(raw)
chunks = [
  b'\x89PNG\r\n\x1a\n',
  b'\x00\x00\x00\rIHDR' + b'\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00' + struct.pack('>I', zlib.crc32(b'IHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00') & 0xffffffff),
  struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', zlib.crc32(b'IDAT' + compressed) & 0xffffffff),
  b'\x00\x00\x00\x00IEND\xaeB\x60\x82',
]
" 2>/dev/null || true

  # Simpler: use curl to grab a tiny test PNG if Python one-liner is complex
  python3 << 'PYEOF'
import struct, zlib
def make_png():
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 4, 8, 2, 0, 0, 0))
    raw  = b''.join(b'\x00\xff\x00\x00\xff' * 4 for _ in range(4))
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend
with open('/tmp/rembg-warmup-in.png', 'wb') as f:
    f.write(make_png())
PYEOF

  echo "  Downloading model... (this may take a few minutes)"
  rembg i "$TMP_IN" "$TMP_OUT" 2>&1 || true
  rm -f "$TMP_IN" "$TMP_OUT"

  if [ -f "$REMBG_MODEL_DIR/u2net.onnx" ]; then
    ok "Model downloaded and cached at $REMBG_MODEL_DIR/u2net.onnx"
  else
    warn "Model may not have downloaded — it will download on first photo upload instead."
  fi
fi
echo ""

# ── Step 4: Backend npm dependencies ──────────────────────────────────────────
log "Step 4/4 — Installing backend npm dependencies..."

command -v node >/dev/null 2>&1 || err "Node.js not found. Install: sudo apt install nodejs"
NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo ok || echo fail)
[ "$NODE_VER" = "fail" ] && err "Node.js 18+ required. Current: $(node --version)"

cd "$BACKEND_DIR"
if [ -d "node_modules" ]; then
  skip "backend node_modules"
else
  npm install
  ok "Backend dependencies installed"
fi
echo ""

# ── Step 5: Check .env ────────────────────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  warn "backend/.env not found!"
  echo "  Copy the example and fill in your values:"
  echo "  cp backend/.env.example backend/.env"
  echo "  Then edit backend/.env with your MongoDB URI, JWT secret, etc."
else
  ok "backend/.env found"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
line
echo -e "\033[1;32m  Backend setup complete!\033[0m"
line
echo ""
echo "  rembg     : $(command -v rembg 2>/dev/null || echo 'check PATH — reopen terminal if needed')"
echo "  Node.js   : $(node --version)"
echo ""
echo "  Next steps:"
echo "  1. Make sure backend/.env is configured"
echo "  2. Start the backend:  cd backend && npm run dev"
echo "  3. (Optional) Set up Fabric blockchain:"
echo "     bash $SCRIPT_DIR/fabric-setup.sh"
echo ""
