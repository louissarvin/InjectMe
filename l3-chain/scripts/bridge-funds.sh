#!/usr/bin/env bash
# =============================================================================
# Bridge Funds: 0G Chain L1 --> InjectMe L3
# =============================================================================
# Deposits native 0G tokens from L1 (0G Chain) to L3 (InjectMe) via the
# OP Stack standard bridge. Waits for the deposit to be processed on L3.
#
# Usage:
#   ./scripts/bridge-funds.sh <amount_in_wei> [recipient_address]
#
# Examples:
#   ./scripts/bridge-funds.sh 1000000000000000000          # 1 0G to sender
#   ./scripts/bridge-funds.sh 500000000000000000 0xABC...  # 0.5 0G to 0xABC
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
# Arguments
# ---------------------------------------------------------------------------
AMOUNT_WEI="${1:-}"
RECIPIENT="${2:-${GS_ADMIN_ADDRESS:-}}"

if [ -z "$AMOUNT_WEI" ]; then
    echo "Usage: $0 <amount_in_wei> [recipient_address]"
    echo ""
    echo "  amount_in_wei:     Amount to bridge (e.g., 1000000000000000000 = 1 0G)"
    echo "  recipient_address: L3 recipient (defaults to GS_ADMIN_ADDRESS)"
    exit 1
fi

if [ -z "$RECIPIENT" ]; then
    log_error "No recipient specified and GS_ADMIN_ADDRESS not set."
    exit 1
fi

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
validate() {
    log_info "Validating bridge prerequisites..."

    if [ -z "${L1_STANDARD_BRIDGE_PROXY:-}" ]; then
        log_error "L1_STANDARD_BRIDGE_PROXY not set in .env"
        log_error "Deploy L1 contracts first, then update .env with the bridge proxy address."
        exit 1
    fi

    if [ -z "${GS_ADMIN_PRIVATE_KEY:-}" ]; then
        log_error "GS_ADMIN_PRIVATE_KEY not set. Needed to sign the deposit transaction."
        exit 1
    fi

    # Verify L3 is running
    if ! curl -s --connect-timeout 3 "http://localhost:${OP_GETH_HTTP_PORT:-8545}" &>/dev/null; then
        log_error "L3 RPC not reachable at http://localhost:${OP_GETH_HTTP_PORT:-8545}"
        log_error "Start the L3 chain first: ./scripts/deploy-l3.sh"
        exit 1
    fi

    log_ok "Prerequisites validated."
}

# ---------------------------------------------------------------------------
# Check L1 balance
# ---------------------------------------------------------------------------
check_l1_balance() {
    log_info "Checking L1 balance for sender..."

    local balance_hex
    balance_hex=$(curl -s -X POST "$L1_RPC_URL" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"${GS_ADMIN_ADDRESS}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    if [ -z "$balance_hex" ]; then
        log_error "Could not fetch L1 balance."
        exit 1
    fi

    # Convert hex to decimal for display
    local balance_dec
    balance_dec=$(printf "%d" "$balance_hex" 2>/dev/null || echo "0")

    log_info "L1 Balance: $balance_dec wei"

    # Simple comparison: ensure balance > amount
    if [ "$balance_dec" -lt "$AMOUNT_WEI" ] 2>/dev/null; then
        log_error "Insufficient L1 balance. Need $AMOUNT_WEI wei, have $balance_dec wei."
        log_error "Get testnet tokens: https://faucet.0g.ai"
        exit 1
    fi

    log_ok "Sufficient L1 balance."
}

# ---------------------------------------------------------------------------
# Send deposit transaction
# ---------------------------------------------------------------------------
send_deposit() {
    log_info "Sending deposit to L1StandardBridgeProxy..."
    log_info "  Amount:    $AMOUNT_WEI wei"
    log_info "  Recipient: $RECIPIENT"
    log_info "  Bridge:    $L1_STANDARD_BRIDGE_PROXY"

    # The depositETH function on L1StandardBridge:
    # function depositETH(uint32 _minGasLimit, bytes calldata _extraData) payable
    # Selector: 0xb1a1a882
    # _minGasLimit: 100000 (0x186A0)
    # _extraData: empty bytes

    local calldata="0xb1a1a882"
    calldata+="00000000000000000000000000000000000000000000000000000000000186a0"  # minGasLimit = 100000
    calldata+="0000000000000000000000000000000000000000000000000000000000000040"  # offset to extraData
    calldata+="0000000000000000000000000000000000000000000000000000000000000000"  # extraData length = 0

    # Convert amount to hex
    local amount_hex
    amount_hex=$(printf "0x%x" "$AMOUNT_WEI")

    # Get nonce
    local nonce
    nonce=$(curl -s -X POST "$L1_RPC_URL" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionCount\",\"params\":[\"${GS_ADMIN_ADDRESS}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    log_info "Nonce: $nonce"

    # Use cast (foundry) if available for cleaner tx signing
    if command -v cast &>/dev/null; then
        log_info "Using Foundry cast for transaction signing..."

        local tx_hash
        tx_hash=$(cast send \
            --rpc-url "$L1_RPC_URL" \
            --private-key "$GS_ADMIN_PRIVATE_KEY" \
            "$L1_STANDARD_BRIDGE_PROXY" \
            "depositETH(uint32,bytes)" \
            100000 \
            "0x" \
            --value "$AMOUNT_WEI" \
            2>&1 | grep "transactionHash" | awk '{print $2}' || true)

        if [ -z "$tx_hash" ]; then
            # cast send prints the hash differently in some versions
            tx_hash=$(cast send \
                --rpc-url "$L1_RPC_URL" \
                --private-key "$GS_ADMIN_PRIVATE_KEY" \
                "$L1_STANDARD_BRIDGE_PROXY" \
                "depositETH(uint32,bytes)" \
                100000 \
                "0x" \
                --value "$AMOUNT_WEI" \
                --json 2>/dev/null | grep -o '"transactionHash":"[^"]*"' | cut -d'"' -f4 || true)
        fi

        if [ -n "$tx_hash" ]; then
            log_ok "Deposit transaction sent: $tx_hash"
            echo "$tx_hash"
            return
        fi

        log_warn "cast send did not return a transaction hash. Checking receipt..."
    else
        log_warn "Foundry cast not found. Install: curl -L https://foundry.paradigm.xyz | bash"
        log_error "Manual transaction signing not implemented. Install Foundry to proceed."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Wait for L3 balance update
# ---------------------------------------------------------------------------
wait_for_l3() {
    log_info "Waiting for deposit to be reflected on L3..."
    log_info "This may take 2-5 minutes depending on L1 block confirmations."

    local l3_rpc="http://localhost:${OP_GETH_HTTP_PORT:-8545}"
    local initial_balance
    initial_balance=$(curl -s -X POST "$l3_rpc" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"${RECIPIENT}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    local retries=0
    local max_retries=60  # 5 minutes at 5s intervals

    while [ $retries -lt $max_retries ]; do
        local current_balance
        current_balance=$(curl -s -X POST "$l3_rpc" \
            -H "Content-Type: application/json" \
            -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"${RECIPIENT}\",\"latest\"],\"id\":1}" \
            | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

        if [ "$current_balance" != "$initial_balance" ] && [ -n "$current_balance" ]; then
            log_ok "Deposit confirmed on L3."
            log_ok "L3 Balance: $current_balance (hex)"
            return
        fi

        retries=$((retries + 1))
        echo -ne "\r  Waiting... ($retries/$max_retries)"
        sleep 5
    done

    echo ""
    log_warn "Deposit not yet reflected on L3 after ${max_retries} checks."
    log_warn "This is normal if L1 confirmations are slow. Check again later:"
    log_warn "  cast balance $RECIPIENT --rpc-url $l3_rpc"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo "============================================================================="
    echo "Bridge Funds: 0G Chain (L1) --> InjectMe (L3)"
    echo "============================================================================="
    echo ""

    validate
    check_l1_balance
    send_deposit
    wait_for_l3

    echo ""
    log_ok "Bridge operation complete."
}

main "$@"
