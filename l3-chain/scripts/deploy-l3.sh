#!/usr/bin/env bash
# =============================================================================
# InjectMe L3 Deployment Script
# =============================================================================
# Deploys the full OP Stack L3 with 0G DA. Idempotent: safe to re-run.
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - .env file configured (copy from env.example)
#   - Operator accounts funded on 0G Chain Galileo testnet
#
# Usage:
#   ./scripts/deploy-l3.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# Step 0: Validate environment
# ---------------------------------------------------------------------------
validate_env() {
    log_info "Validating environment..."

    if [ ! -f "$ROOT_DIR/.env" ]; then
        log_error ".env file not found. Copy env.example to .env and configure it."
        exit 1
    fi

    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"

    local required_vars=(
        "L1_RPC_URL"
        "L3_CHAIN_ID"
        "GS_ADMIN_ADDRESS"
        "GS_ADMIN_PRIVATE_KEY"
        "GS_BATCHER_ADDRESS"
        "GS_BATCHER_PRIVATE_KEY"
        "GS_PROPOSER_ADDRESS"
        "GS_PROPOSER_PRIVATE_KEY"
        "GS_SEQUENCER_ADDRESS"
        "GS_SEQUENCER_PRIVATE_KEY"
        "DA_SIGNER_PRIVATE_KEY"
    )

    local missing=0
    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_error "Missing required variable: $var"
            missing=1
        fi
    done

    if [ "$missing" -eq 1 ]; then
        exit 1
    fi

    # Validate L1 connectivity
    log_info "Testing L1 RPC connection..."
    local chain_id
    chain_id=$(curl -s -X POST "$L1_RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    if [ -z "$chain_id" ]; then
        log_error "Cannot connect to L1 RPC at $L1_RPC_URL"
        exit 1
    fi

    log_ok "L1 RPC connected. Chain ID: $chain_id"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed."
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose v2 is not available."
        exit 1
    fi

    log_ok "Environment validated."
}

# ---------------------------------------------------------------------------
# Step 1: Generate JWT secret
# ---------------------------------------------------------------------------
generate_jwt() {
    local jwt_file="$ROOT_DIR/config/jwt-secret.txt"

    if [ -f "$jwt_file" ] && [ "$(cat "$jwt_file")" != "PLACEHOLDER_REPLACE_ME_WITH_OPENSSL_RAND_HEX_32" ]; then
        log_info "JWT secret already exists. Skipping generation."
        return
    fi

    log_info "Generating JWT secret for Engine API authentication..."
    openssl rand -hex 32 > "$jwt_file"
    chmod 600 "$jwt_file"
    log_ok "JWT secret generated at $jwt_file"
}

# ---------------------------------------------------------------------------
# Step 2: Create data directories
# ---------------------------------------------------------------------------
create_data_dirs() {
    log_info "Creating persistent data directories..."

    mkdir -p "$ROOT_DIR/data/op-geth"
    mkdir -p "$ROOT_DIR/data/op-node"
    mkdir -p "$ROOT_DIR/data/da-client/db"
    mkdir -p "$ROOT_DIR/data/da-client/logs"
    mkdir -p "$ROOT_DIR/data/da-encoder"

    log_ok "Data directories created."
}

# ---------------------------------------------------------------------------
# Step 3: Initialize op-geth with genesis
# ---------------------------------------------------------------------------
init_geth() {
    local genesis_flag="$ROOT_DIR/data/op-geth/.genesis-initialized"

    if [ -f "$genesis_flag" ]; then
        log_info "op-geth genesis already initialized. Skipping."
        return
    fi

    log_info "Initializing op-geth with genesis block..."

    docker run --rm \
        -v "$ROOT_DIR/data/op-geth:/data/op-geth" \
        -v "$ROOT_DIR/config/genesis.json:/config/genesis.json:ro" \
        us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:v1.101408.0 \
        geth init \
        --datadir /data/op-geth \
        --state.scheme hash \
        /config/genesis.json

    touch "$genesis_flag"
    log_ok "op-geth genesis initialized."
}

# ---------------------------------------------------------------------------
# Step 4: Start DA infrastructure
# ---------------------------------------------------------------------------
start_da() {
    log_info "Starting 0G DA infrastructure (encoder, client, server)..."

    cd "$ROOT_DIR"
    docker compose up -d da-encoder
    log_info "Waiting for DA encoder to be healthy..."
    docker compose up -d da-client

    # Wait for DA client to be ready
    local retries=0
    local max_retries=30
    while [ $retries -lt $max_retries ]; do
        if docker compose exec da-client sh -c "nc -z localhost 51001" 2>/dev/null; then
            break
        fi
        retries=$((retries + 1))
        log_info "  Waiting for DA client... ($retries/$max_retries)"
        sleep 5
    done

    if [ $retries -eq $max_retries ]; then
        log_error "DA client failed to start. Check logs: docker compose logs da-client"
        exit 1
    fi

    docker compose up -d da-server
    log_ok "DA infrastructure started."
}

# ---------------------------------------------------------------------------
# Step 5: Start OP Stack components
# ---------------------------------------------------------------------------
start_op_stack() {
    log_info "Starting OP Stack components..."

    cd "$ROOT_DIR"

    # Start execution engine first
    docker compose up -d op-geth
    log_info "Waiting for op-geth to be ready..."
    sleep 10

    # Start consensus/derivation layer
    docker compose up -d op-node
    log_info "Waiting for op-node to sync..."
    sleep 10

    # Start batcher (posts to DA)
    docker compose up -d op-batcher
    log_info "Batcher started. It will submit batches to 0G DA via the DA server."

    # Start proposer (posts state roots to L1)
    if [ -n "${L2OO_ADDRESS:-}" ] && [ "$L2OO_ADDRESS" != "0x0000000000000000000000000000000000000000" ]; then
        docker compose up -d op-proposer
        log_info "Proposer started."
    else
        log_warn "L2OO_ADDRESS not set. Skipping op-proposer."
        log_warn "Deploy L2OutputOracle on L1 first, then set L2OO_ADDRESS in .env and re-run."
    fi

    log_ok "OP Stack components started."
}

# ---------------------------------------------------------------------------
# Step 6: Verify DA connection
# ---------------------------------------------------------------------------
verify_da() {
    log_info "Verifying DA connection..."

    cd "$ROOT_DIR"
    bash "$SCRIPT_DIR/verify-da.sh" || {
        log_warn "DA verification had issues. Check the output above."
        log_warn "The chain may still work. DA issues are often transient on testnet."
    }
}

# ---------------------------------------------------------------------------
# Step 7: Print status
# ---------------------------------------------------------------------------
print_status() {
    echo ""
    echo "============================================================================="
    echo -e "${GREEN}InjectMe L3 Deployment Complete${NC}"
    echo "============================================================================="
    echo ""
    echo "L3 RPC (HTTP):  http://localhost:${OP_GETH_HTTP_PORT:-8545}"
    echo "L3 RPC (WS):    ws://localhost:${OP_GETH_WS_PORT:-8546}"
    echo "L3 Chain ID:    ${L3_CHAIN_ID:-16601}"
    echo ""
    echo "op-node RPC:    http://localhost:${OP_NODE_RPC_PORT:-9545}"
    echo "DA Server:      http://localhost:3100"
    echo ""
    echo "Metrics:"
    echo "  op-geth:      http://localhost:${OP_GETH_METRICS_PORT:-6060}/debug/metrics"
    echo "  op-node:      http://localhost:${OP_NODE_METRICS_PORT:-7300}/metrics"
    echo "  op-batcher:   http://localhost:${OP_BATCHER_METRICS_PORT:-7301}/metrics"
    echo "  op-proposer:  http://localhost:${OP_PROPOSER_METRICS_PORT:-7302}/metrics"
    echo ""
    echo "Logs: docker compose -f $ROOT_DIR/docker-compose.yml logs -f"
    echo ""
    echo "Next steps:"
    echo "  1. Bridge funds:  ./scripts/bridge-funds.sh <amount>"
    echo "  2. Deploy InjectMe contracts on L3"
    echo "  3. Configure monitoring (Prometheus + Grafana)"
    echo "============================================================================="
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo "============================================================================="
    echo "InjectMe L3 App-Chain Deployment (OP Stack + 0G DA)"
    echo "============================================================================="
    echo ""

    validate_env
    generate_jwt
    create_data_dirs
    init_geth
    start_da
    start_op_stack
    verify_da
    print_status
}

main "$@"
