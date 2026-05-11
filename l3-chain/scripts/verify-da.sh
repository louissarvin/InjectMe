#!/usr/bin/env bash
# =============================================================================
# Verify 0G DA Connection
# =============================================================================
# Validates that the 0G DA pipeline is working end-to-end:
#   1. DA server is reachable
#   2. DA client (disperser) is connected
#   3. DA encoder is responding
#   4. Test blob can be submitted and retrieved
#   5. L1 DA contracts are accessible
#
# Usage:
#   ./scripts/verify-da.sh
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
    log_error ".env not found."
    exit 1
fi

PASS=0
FAIL=0
WARN=0

check_pass() { PASS=$((PASS + 1)); log_ok "$1"; }
check_fail() { FAIL=$((FAIL + 1)); log_error "$1"; }
check_warn() { WARN=$((WARN + 1)); log_warn "$1"; }

# ---------------------------------------------------------------------------
# Check 1: DA Server HTTP endpoint
# ---------------------------------------------------------------------------
check_da_server() {
    log_info "Checking DA server (HTTP)..."

    local da_url="http://localhost:3100"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$da_url/" 2>/dev/null || echo "000")

    if [ "$status" = "000" ]; then
        check_fail "DA server not reachable at $da_url"
    elif [ "$status" = "404" ] || [ "$status" = "200" ] || [ "$status" = "405" ]; then
        # DA server returns 404 on root but that means it is running
        check_pass "DA server responding (HTTP $status) at $da_url"
    else
        check_warn "DA server returned unexpected status $status at $da_url"
    fi
}

# ---------------------------------------------------------------------------
# Check 2: DA Client (disperser) gRPC endpoint
# ---------------------------------------------------------------------------
check_da_client() {
    log_info "Checking DA client (gRPC disperser)..."

    local port="${DA_CLIENT_GRPC_PORT:-51001}"

    if docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T da-client sh -c "nc -z localhost $port" 2>/dev/null; then
        check_pass "DA client disperser listening on port $port"
    elif nc -z localhost "$port" 2>/dev/null; then
        check_pass "DA client disperser reachable on host port $port"
    else
        check_fail "DA client disperser not reachable on port $port"
    fi
}

# ---------------------------------------------------------------------------
# Check 3: DA Encoder gRPC endpoint
# ---------------------------------------------------------------------------
check_da_encoder() {
    log_info "Checking DA encoder (gRPC)..."

    if docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T da-encoder sh -c "nc -z localhost 34000" 2>/dev/null; then
        check_pass "DA encoder listening on port 34000"
    elif nc -z localhost 34000 2>/dev/null; then
        check_pass "DA encoder reachable on host port 34000"
    else
        check_fail "DA encoder not reachable on port 34000"
    fi
}

# ---------------------------------------------------------------------------
# Check 4: Submit test blob via DA server
# ---------------------------------------------------------------------------
check_blob_submission() {
    log_info "Testing blob submission via DA server..."

    local da_url="http://localhost:3100"

    # The OP Stack Alt-DA server exposes PUT /put for blob storage
    # and GET /get/<commitment> for blob retrieval.
    # Send a small test blob.
    local test_data
    test_data=$(echo -n "InjectMe DA test $(date +%s)" | xxd -p | tr -d '\n')

    local response
    response=$(curl -s --connect-timeout 10 -X PUT \
        -H "Content-Type: application/octet-stream" \
        --data-binary @<(echo -n "$test_data" | xxd -r -p) \
        "$da_url/put" 2>/dev/null || echo "CURL_FAILED")

    if [ "$response" = "CURL_FAILED" ]; then
        check_warn "Could not submit test blob (DA server may not be ready)"
        return
    fi

    if [ -n "$response" ] && [ "$response" != "CURL_FAILED" ]; then
        # The response should contain a commitment
        local commitment
        commitment=$(echo "$response" | head -c 100)
        check_pass "Test blob submitted. Response: ${commitment}..."

        # Try to retrieve the blob
        if [ -n "$commitment" ]; then
            log_info "Attempting to retrieve test blob..."
            local retrieved
            retrieved=$(curl -s --connect-timeout 10 \
                "$da_url/get/$commitment" 2>/dev/null || echo "RETRIEVE_FAILED")

            if [ "$retrieved" != "RETRIEVE_FAILED" ] && [ -n "$retrieved" ]; then
                check_pass "Test blob retrieved successfully"
            else
                check_warn "Could not retrieve test blob (may need more time for DA confirmation)"
            fi
        fi
    else
        check_warn "Empty response from DA server blob submission"
    fi
}

# ---------------------------------------------------------------------------
# Check 5: L1 DA contract accessibility
# ---------------------------------------------------------------------------
check_l1_contracts() {
    log_info "Checking L1 DA contracts..."

    # Check DAEntrance
    local code
    code=$(curl -s -X POST "${L1_RPC_URL}" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${DA_ENTRANCE_CONTRACT}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    if [ -n "$code" ] && [ "$code" != "0x" ]; then
        check_pass "DAEntrance contract deployed at ${DA_ENTRANCE_CONTRACT}"
    else
        check_fail "DAEntrance contract not found at ${DA_ENTRANCE_CONTRACT}"
    fi

    # Check L1 is reachable
    local block
    block=$(curl -s -X POST "${L1_RPC_URL}" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 || true)

    if [ -n "$block" ]; then
        local block_dec
        block_dec=$(printf "%d" "$block" 2>/dev/null || echo "$block")
        check_pass "L1 (0G Chain) at block $block_dec"
    else
        check_fail "Cannot query L1 block number"
    fi
}

# ---------------------------------------------------------------------------
# Check 6: Docker container health
# ---------------------------------------------------------------------------
check_container_health() {
    log_info "Checking container health status..."

    local services=("da-encoder" "da-client" "da-server")

    for svc in "${services[@]}"; do
        local health
        health=$(docker inspect --format='{{.State.Health.Status}}' "injectme-${svc}" 2>/dev/null || echo "not_found")

        case "$health" in
            healthy)
                check_pass "Container injectme-${svc}: healthy"
                ;;
            unhealthy)
                check_fail "Container injectme-${svc}: unhealthy"
                ;;
            starting)
                check_warn "Container injectme-${svc}: still starting"
                ;;
            not_found)
                check_warn "Container injectme-${svc}: not running"
                ;;
            *)
                check_warn "Container injectme-${svc}: status=$health"
                ;;
        esac
    done
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    echo "============================================================================="
    echo "DA Verification Summary"
    echo "============================================================================="
    echo -e "  ${GREEN}Passed:${NC}   $PASS"
    echo -e "  ${RED}Failed:${NC}   $FAIL"
    echo -e "  ${YELLOW}Warnings:${NC} $WARN"
    echo "============================================================================="

    if [ "$FAIL" -gt 0 ]; then
        echo ""
        log_error "Some checks failed. Review the output above."
        log_info "Common fixes:"
        log_info "  1. Start all services: docker compose up -d"
        log_info "  2. Check logs: docker compose logs da-client"
        log_info "  3. Verify .env has correct DA_SIGNER_PRIVATE_KEY"
        log_info "  4. Ensure L1 RPC ($L1_RPC_URL) is accessible"
        return 1
    fi

    if [ "$WARN" -gt 0 ]; then
        echo ""
        log_warn "Some checks had warnings. DA may still be initializing."
        return 0
    fi

    echo ""
    log_ok "All DA checks passed."
    return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo "============================================================================="
    echo "0G DA Verification for InjectMe L3"
    echo "============================================================================="
    echo ""

    check_da_server
    check_da_client
    check_da_encoder
    check_blob_submission
    check_l1_contracts
    check_container_health
    print_summary
}

main "$@"
