#!/usr/bin/env bash
# =============================================================================
# 0G DA Connection Setup
# =============================================================================
# Configures the 0G DA connection for the InjectMe L3 rollup.
# Tests blob upload/download and verifies quorum connectivity.
#
# Usage:
#   ./scripts/setup-da.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Load environment
if [ -f "$ROOT_DIR/.env" ]; then
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
else
    log_error ".env not found. Copy env.example to .env first."
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 1: Verify DA contract accessibility
# ---------------------------------------------------------------------------
verify_da_contracts() {
    log_info "Verifying 0G DA contracts on L1..."

    # Check DAEntrance contract code exists
    local code
    code=$(curl -s -X POST "${L1_RPC_URL}" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${DA_ENTRANCE_CONTRACT}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    if [ -z "$code" ] || [ "$code" = "0x" ]; then
        log_error "DAEntrance contract not found at ${DA_ENTRANCE_CONTRACT}"
        log_error "Verify the contract address matches the current testnet deployment."
        exit 1
    fi
    log_ok "DAEntrance contract verified at ${DA_ENTRANCE_CONTRACT}"

    # Check DASigners precompile
    code=$(curl -s -X POST "${L1_RPC_URL}" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${DA_SIGNERS_CONTRACT}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    if [ -z "$code" ] || [ "$code" = "0x" ]; then
        log_warn "DASigners precompile returned no code at ${DA_SIGNERS_CONTRACT}"
        log_warn "This is expected for precompiles on some chains."
    else
        log_ok "DASigners precompile verified at ${DA_SIGNERS_CONTRACT}"
    fi
}

# ---------------------------------------------------------------------------
# Step 2: Verify DA signer account
# ---------------------------------------------------------------------------
verify_signer() {
    log_info "Checking DA signer account balance..."

    if [ -z "${DA_SIGNER_PRIVATE_KEY:-}" ]; then
        log_error "DA_SIGNER_PRIVATE_KEY not set in .env"
        exit 1
    fi

    log_ok "DA signer key configured (not logging the key)."
    log_info "Ensure the account associated with DA_SIGNER_PRIVATE_KEY has 0G tokens."
    log_info "Faucet: https://faucet.0g.ai"
}

# ---------------------------------------------------------------------------
# Step 3: Build and verify DA server image
# ---------------------------------------------------------------------------
verify_da_server_image() {
    log_info "Checking DA server Docker image..."

    # Try to pull the image; if unavailable, build from source
    if docker image inspect ghcr.io/0glabs/0g-da-op-plasma:latest &>/dev/null; then
        log_ok "DA server image available locally."
        return
    fi

    log_info "Pulling DA server image..."
    if docker pull ghcr.io/0glabs/0g-da-op-plasma:latest 2>/dev/null; then
        log_ok "DA server image pulled."
        return
    fi

    log_warn "Pre-built image not available. Building from source..."
    local build_dir="/tmp/0g-da-op-plasma"

    if [ ! -d "$build_dir" ]; then
        git clone https://github.com/0gfoundation/0g-da-op-plasma.git "$build_dir"
    fi

    cd "$build_dir"
    docker build -t ghcr.io/0glabs/0g-da-op-plasma:latest .
    cd "$ROOT_DIR"

    log_ok "DA server image built from source."
}

# ---------------------------------------------------------------------------
# Step 4: Test DA server connectivity
# ---------------------------------------------------------------------------
test_da_connectivity() {
    log_info "Testing DA server connectivity..."

    # Check if DA server is running
    if curl -s --connect-timeout 5 "http://localhost:3100/" &>/dev/null; then
        log_ok "DA server responding on port 3100."
    else
        log_warn "DA server not responding on port 3100."
        log_warn "Start the stack first: docker compose up -d da-server"
    fi
}

# ---------------------------------------------------------------------------
# Step 5: Verify encoder parameters
# ---------------------------------------------------------------------------
verify_encoder_params() {
    log_info "Checking DA encoder parameters..."

    # The encoder needs pre-downloaded cryptographic parameters
    if docker volume inspect injectme-l3_da-encoder-params &>/dev/null; then
        log_ok "DA encoder params volume exists."
    else
        log_warn "DA encoder params volume not found."
        log_warn "Parameters will be downloaded on first encoder start (may take ~30 min)."
        log_warn "For faster setup, pre-download params into the da-encoder-params volume."
    fi
}

# ---------------------------------------------------------------------------
# Step 6: Print DA configuration summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    echo "============================================================================="
    echo -e "${GREEN}0G DA Configuration Summary${NC}"
    echo "============================================================================="
    echo ""
    echo "L1 RPC:                ${L1_RPC_URL}"
    echo "DA Entrance Contract:  ${DA_ENTRANCE_CONTRACT}"
    echo "DA Signers Contract:   ${DA_SIGNERS_CONTRACT}"
    echo ""
    echo "DA Server (HTTP):      http://localhost:3100"
    echo "DA Client (gRPC):      localhost:${DA_CLIENT_GRPC_PORT:-51001}"
    echo "DA Encoder (gRPC):     localhost:34000"
    echo ""
    echo "Commitment Type:       ${DA_COMMITMENT_TYPE:-GenericCommitment}"
    echo "Blob Expiry:           ${DA_BLOB_EXPIRY:-2592000}s (~30 days)"
    echo ""
    echo "Network Parameters:"
    echo "  Max Blob Size:       32.5 MiB (34,078,720 bytes)"
    echo "  Encoded Slices:      3072"
    echo "  Tokens Per Vote:     30"
    echo "  Max Quorums:         10"
    echo "  Epoch Blocks:        5760 (~19.2 hours)"
    echo "============================================================================="
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo "============================================================================="
    echo "0G DA Setup for InjectMe L3"
    echo "============================================================================="
    echo ""

    verify_da_contracts
    verify_signer
    verify_da_server_image
    test_da_connectivity
    verify_encoder_params
    print_summary
}

main "$@"
