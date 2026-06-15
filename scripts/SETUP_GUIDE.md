# SETUP GUIDE — MSWDO ID Management System

**Purpose:** Step-by-step setup for any new machine (presentation device, new laptop, etc.)
**Last Updated:** 2026-05-23 (Session 16)

---

## Prerequisites

| Tool          | Required Version | Notes                                    |
| ------------- | ---------------- | ---------------------------------------- |
| Windows 11    | Any              | With WSL2 enabled                        |
| Ubuntu (WSL2) | 22.04+ / 24.04+  | `wsl --install Ubuntu`                   |
| Docker Engine | 20.x+            | Install inside WSL2 (NOT Docker Desktop) |
| Node.js       | 20.x LTS         | Install via nvm inside WSL2              |
| Git           | Any              | Pre-installed on Ubuntu                  |
| jq            | Any              | `sudo apt install jq`                    |

---

## FULL SETUP SCRIPT (fresh machine)

Save this as `setup.sh` and run it inside WSL2 Ubuntu:

```bash
#!/bin/bash
set -e

echo "=== MSWDO IDMS Full Setup Script ==="
echo "Run this inside WSL2 Ubuntu on any new machine."
echo ""

# ── 1. System packages ──────────────────────────────────────────
echo "[1/7] Installing system packages..."
sudo apt update -qq
sudo apt install -y curl git jq ca-certificates gnupg lsb-release

# ── 2. Docker Engine (skip if already installed) ────────────────
if ! command -v docker &> /dev/null; then
  echo "[2/7] Installing Docker Engine..."
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update -qq
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker $USER
  echo "Docker installed. You may need to restart WSL2 (exit and reopen terminal)."
else
  echo "[2/7] Docker already installed: $(docker --version)"
fi

# ── 3. docker-compose shim (Fabric scripts need legacy command) ─
if ! command -v docker-compose &> /dev/null; then
  echo "[3/7] Creating docker-compose shim..."
  sudo sh -c 'printf "#!/bin/sh\nexec docker compose \"$@\"\n" > /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose'
else
  echo "[3/7] docker-compose already available"
fi

# ── 4. Node.js 20 via nvm ───────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "[4/7] Installing Node.js 20 via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
else
  echo "[4/7] Node already installed: $(node --version)"
fi

# ── 5. Hyperledger Fabric binaries + fabric-samples ────────────
if [ ! -d "$HOME/fabric-samples" ]; then
  echo "[5/7] Downloading Hyperledger Fabric (this takes ~5 minutes)..."
  cd ~
  curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- docker samples binary
else
  echo "[5/7] fabric-samples already exists at ~/fabric-samples"
fi

# ── 6. Add Fabric binaries to PATH ─────────────────────────────
echo "[6/7] Adding Fabric binaries to PATH..."
if ! grep -q "fabric-samples/bin" ~/.bashrc; then
  echo 'export PATH=$PATH:$HOME/fabric-samples/bin' >> ~/.bashrc
fi
export PATH=$PATH:$HOME/fabric-samples/bin

# ── 7. Start Hyperledger Fabric test network ────────────────────
echo "[7/7] Starting Fabric test network..."
cd ~/fabric-samples/test-network
./network.sh down 2>/dev/null || true
./network.sh up createChannel -ca

echo ""
echo "=== Setup Complete ==="
echo "Next: deploy the chaincode (see SETUP_GUIDE.md Step 3)"
```

---

## STEP-BY-STEP SETUP (manual, if script fails)

### Step 1: System Prerequisites

```bash
# In WSL2 Ubuntu
sudo apt update && sudo apt install -y curl git jq

# docker-compose shim (Fabric uses legacy command name)
sudo sh -c 'printf "#!/bin/sh\nexec docker compose \"$@\"\n" > /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose'

# Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm alias default 20
```

### Step 2: Download Fabric + Start Network

```bash
# Download fabric-samples (only needed once per machine)
cd ~ && curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- docker samples binary

# Add binaries to PATH
echo 'export PATH=$PATH:$HOME/fabric-samples/bin' >> ~/.bashrc && source ~/.bashrc

# Start the test network
cd ~/fabric-samples/test-network
./network.sh up createChannel -ca
```

### Step 3: Deploy the Chaincode

```bash
cd ~/fabric-samples/test-network

./network.sh deployCC \
  -ccn id-contract \
  -ccp /mnt/c/Users/guiri/Desktop/FullStack_Projects/mswdo-idms/blockchain/chaincode \
  -ccl javascript
```

> ⚠️ Update the `-ccp` path to match the actual Windows username on the new machine.
> On new machine: replace `guiri` with the actual Windows username.

### Step 4: Configure Backend `.env`

```bash
# In the backend .env file (Windows side)
FABRIC_ENABLED=true
FABRIC_PEER_HOST=localhost
FABRIC_PEER_PORT=7051
FABRIC_PEER_NAME=peer0.org1.example.com
FABRIC_MSP_ID=Org1MSP
FABRIC_TLS_CERT_PATH=/home/cedrick/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
FABRIC_CERT_PATH=/home/cedrick/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/cert.pem
FABRIC_PRIVATE_KEY_PATH=/home/cedrick/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore/priv_sk
```

> ⚠️ On a new machine: replace `cedrick` with the actual WSL2 username.
> The `FABRIC_PRIVATE_KEY_PATH` key filename (`priv_sk`) changes each time the network is restarted — update it accordingly.

### Step 5: Run the Application

```bash
# Terminal 1 (WSL2) — Backend
cd /mnt/c/Users/guiri/Desktop/FullStack_Projects/mswdo-idms/backend
npm run dev

# Terminal 2 (Windows or WSL2) — Frontend
cd C:\Users\guiri\Desktop\FullStack_Projects\mswdo-idms\frontend
npm run dev
```

---

## Running Without Blockchain (FABRIC_ENABLED=false)

If the presentation device does NOT have Fabric set up, set in backend `.env`:

```env
FABRIC_ENABLED=false
```

The entire system works normally. Blockchain status shows "Pending Anchor" — this is a valid system state (PARTIAL records are intentionally not anchored until COMPLETE).

---

## Stopping / Restarting the Fabric Network

```bash
# Stop (keeps crypto material — fast restart)
cd ~/fabric-samples/test-network && ./network.sh down

# Full restart (destroys + recreates everything)
./network.sh down && ./network.sh up createChannel -ca

# After full restart: re-deploy chaincode + update FABRIC_PRIVATE_KEY_PATH in .env
```

---

## Troubleshooting

| Error                        | Fix                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose not found`   | Run the docker-compose shim command in Step 1                                                                                                   |
| `PRIVATE KEY path wrong`     | Find actual key: `ls ~/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore/` |
| `connection refused on 7051` | Fabric network not running — run `./network.sh up createChannel -ca`                                                                            |
| `chaincode not found`        | Re-run Step 3 (deployCC)                                                                                                                        |
| Backend crashes on start     | Set `FABRIC_ENABLED=false` to isolate the issue                                                                                                 |

Unang beses sa bagong device (once lang)

# 1. I-clone ang project

cd ~
git clone <your-repo-url> mswdo-idms
cd mswdo-idms

# 2. I-run ang setup script — bahala na siya sa lahat

bash scripts/fabric-setup.sh

Gagawin niya automatically:

- Check kung may Docker, Node.js, curl
- Mag-create ng docker-compose shim (kung wala pa)
- Mag-download ng Fabric 2.5 binaries (~1.5 GB, once lang)
- Mag-install ng chaincode dependencies
- I-start ang network + i-deploy ang chaincode
- I-update ang .env ng tamang key path

---

Daily use (every time mo i-open ang laptop)

# Terminal 1 — WSL2

cd /mnt/c/Users/guiri/Desktop/FullStack_Projects/mswdo-idms

# Step 1: I-start ang Fabric

bash scripts/fabric-start.sh

# Step 2: I-start ang backend

cd backend && npm run dev

# Terminal 2 — Windows CMD/PowerShell

cd C:\Users\guiri\Desktop\FullStack_Projects\mswdo-idms\frontend
npm run dev

---

Para i-stop (pag tapos na mag-trabaho)

bash scripts/fabric-stop.sh

Ito ay mag-stop ng Fabric network at automatic na mag-set ng FABRIC_ENABLED=false sa .env — so kahit hindi mo i-start ang Fabric bukas, mag-run pa
rin ang backend (blockchain features lang ang hindi gagana).

---

Quick reference card

OPEN laptop → bash scripts/fabric-start.sh → npm run dev (backend) → npm run dev (frontend)
CLOSE laptop → bash scripts/fabric-stop.sh
BAGONG DEVICE → bash scripts/fabric-setup.sh (once lang)

Yung pinaka-important na tandaan: fabric-start.sh lang ang kailangan mo araw-araw — siya na bahala sa lahat ng Fabric setup kasama na ang
auto-update ng private key sa .env.
