# InjectMe L3 App-Chain

OP Stack L3 rollup on 0G Chain using 0G DA for data availability.

## Architecture

```
                         0G DA Network
                              |
                        [DA Encoder]  (erasure coding, gRPC :34000)
                              |
                        [DA Client]   (disperser/retriever, gRPC :51001)
                              |
                        [DA Server]   (HTTP sidecar, :3100)
                          /       \
                    [op-batcher]  [op-node]
                         |            |
                         |      [op-geth]  (L3 EVM, :8545)
                         |            |
                    0G Chain L1   Engine API
                    (Galileo)     (JWT :8551)
                         |
                    [op-proposer]
                    (state roots)
```

**Data flow:**

1. Users submit transactions to op-geth (L3 RPC :8545)
2. op-node sequences blocks and drives op-geth via Engine API
3. op-batcher collects L3 transaction batches
4. Batches are sent to DA Server (HTTP), which forwards to DA Client (gRPC)
5. DA Client encodes blobs via DA Encoder, disperses to 0G DA network
6. DA commitments (32 bytes each) are posted to 0G Chain L1
7. op-proposer posts L3 state roots to L1 for verification

**Cost model:** Instead of posting full calldata to Ethereum (~$1-10 per batch), the L3 posts only 32-byte commitments to 0G Chain. Actual data lives on 0G DA (32.5 MiB max blob, 30-day retention).

## Prerequisites

| Dependency | Version | Purpose |
|------------|---------|---------|
| Docker | 24+ | Container runtime |
| Docker Compose | v2+ | Service orchestration |
| Foundry (cast) | latest | Transaction signing, contract interaction |
| curl | any | Health checks, RPC calls |
| openssl | any | JWT secret generation |

**Funded accounts on 0G Chain Galileo testnet:**

| Role | Minimum Balance | Purpose |
|------|----------------|---------|
| Admin | 0.5 0G | Contract deployment and upgrades |
| Batcher | 0.1 0G | Posts DA commitments to L1 |
| Proposer | 0.2 0G | Posts state roots to L1 |
| Sequencer | 0 (signing only) | Signs L3 blocks |
| DA Signer | funded | DA client chain interactions |

Faucet: https://faucet.0g.ai (0.1 0G per day per wallet).

## Quick Start

```bash
# 1. Configure environment
cp env.example .env
# Edit .env with your keys and addresses

# 2. Deploy everything
./scripts/deploy-l3.sh

# 3. Verify DA is working
./scripts/verify-da.sh

# 4. Bridge funds from L1 to L3
./scripts/bridge-funds.sh 1000000000000000000  # 1 0G
```

## Step-by-Step Deployment

### 1. Generate operator keys

Create four separate accounts. Never reuse keys across roles.

```bash
# Using Foundry
cast wallet new  # Repeat 4 times for admin, batcher, proposer, sequencer
cast wallet new  # One more for DA signer
```

### 2. Fund accounts

Send 0G tokens from the faucet to each account:
- Admin: 0.5 0G
- Batcher: 0.1 0G
- Proposer: 0.2 0G
- DA Signer: 0.1 0G

### 3. Configure environment

```bash
cp env.example .env
```

Fill in all private keys, addresses, and verify the contract addresses match the current Galileo testnet deployment.

### 4. Set up DA connection

```bash
./scripts/setup-da.sh
```

This verifies:
- DA contracts are deployed on L1
- DA signer account is configured
- Docker images are available
- Encoder parameters are ready

### 5. Deploy the L3

```bash
./scripts/deploy-l3.sh
```

The script will:
1. Validate all environment variables
2. Generate JWT secret for Engine API
3. Create data directories
4. Initialize op-geth with genesis
5. Start DA infrastructure (encoder, client, server)
6. Start OP Stack (op-geth, op-node, op-batcher, op-proposer)
7. Verify DA connection

### 6. Verify deployment

```bash
# Check all services are healthy
docker compose ps

# Verify DA pipeline
./scripts/verify-da.sh

# Check L3 is producing blocks
cast block-number --rpc-url http://localhost:8545

# Check L3 chain ID
cast chain-id --rpc-url http://localhost:8545
```

## Configuration Reference

### Network Endpoints

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| op-geth HTTP | 8545 | JSON-RPC | L3 user-facing RPC |
| op-geth WS | 8546 | WebSocket | L3 subscriptions |
| op-geth Auth | 8551 | Engine API | op-node <> op-geth (JWT) |
| op-geth P2P | 30303 | devp2p | Peer discovery (disabled) |
| op-node RPC | 9545 | JSON-RPC | Rollup status queries |
| op-node P2P | 9003 | libp2p | Peer sync (disabled) |
| DA Server | 3100 | HTTP | Alt-DA blob put/get |
| DA Client | 51001 | gRPC | Disperser endpoint |
| DA Encoder | 34000 | gRPC | Erasure coding |

### 0G Chain Galileo Testnet

| Parameter | Value |
|-----------|-------|
| Chain ID | 16602 |
| RPC (dev) | https://evmrpc-testnet.0g.ai |
| Explorer | https://chainscan-galileo.0g.ai |
| Faucet | https://faucet.0g.ai |
| DAEntrance | 0xE75A073dA5bb7b0eC622170Fd268f35E675a957B |
| DASigners | 0x0000000000000000000000000000000000001000 |

### InjectMe L3

| Parameter | Value |
|-----------|-------|
| Chain ID | 16601 |
| Block time | 2 seconds |
| Gas limit | 30,000,000 |
| DA commitment type | GenericCommitment |

### Alt-DA Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| da_commitment_type | GenericCommitment | DA server generates commitments |
| da_challenge_window | 160 blocks | Time to challenge DA availability |
| da_resolve_window | 160 blocks | Time to resolve DA challenges |
| max_channel_duration | 1 | Batcher submits every L1 block |

### 0G DA Network Parameters

| Parameter | Value |
|-----------|-------|
| Max blob size | 32.5 MiB (34,078,720 bytes) |
| Encoded slices | 3072 |
| Tokens per vote | 30 |
| Max votes per signer | 1024 |
| Max quorums | 10 |
| Epoch blocks | 5760 (~19.2 hours) |
| Blob TTL | 30 days |

## Monitoring

All OP Stack components expose Prometheus metrics when `METRICS_ENABLED=true`.

| Component | Metrics URL |
|-----------|-------------|
| op-geth | http://localhost:6060/debug/metrics |
| op-node | http://localhost:7300/metrics |
| op-batcher | http://localhost:7301/metrics |
| op-proposer | http://localhost:7302/metrics |

### Key Metrics to Watch

**Latency:**
- `op_node_derivation_pipeline_step_duration` (derivation pipeline speed)
- `op_batcher_batch_submission_duration` (time to submit batch)

**Traffic:**
- `op_geth_txpool_pending` (pending transactions)
- `op_node_unsafe_head_number` (latest L3 block)

**Errors:**
- `op_batcher_batch_submission_errors_total` (DA submission failures)
- `op_node_derivation_errors_total` (derivation failures)

**Saturation:**
- `op_geth_db_size` (chain database growth)
- Container CPU/memory via Docker stats

## Troubleshooting

### DA server returns errors

```bash
# Check DA server logs
docker compose logs da-server --tail 50

# Check DA client connectivity
docker compose logs da-client --tail 50

# Verify DA encoder is running
docker compose exec da-encoder nc -z localhost 34000
```

### op-node cannot derive blocks

```bash
# Check op-node logs for derivation errors
docker compose logs op-node --tail 100

# Verify L1 RPC is accessible from the container
docker compose exec op-node wget -q -O - https://evmrpc-testnet.0g.ai

# Check rollup.json is valid
docker compose exec op-node cat /config/rollup.json | jq .
```

### op-batcher not submitting

```bash
# Check batcher logs
docker compose logs op-batcher --tail 50

# Verify batcher account has L1 balance
cast balance $GS_BATCHER_ADDRESS --rpc-url $L1_RPC_URL

# Check DA server is healthy
curl http://localhost:3100/
```

### L3 not producing blocks

```bash
# Check op-geth sync status
cast rpc eth_syncing --rpc-url http://localhost:8545

# Check Engine API connectivity
docker compose logs op-geth --tail 50 | grep -i engine

# Verify JWT secret matches between op-geth and op-node
```

## Rollback

### Stop the chain

```bash
docker compose down
```

### Reset to genesis

```bash
# WARNING: This destroys all L3 state
docker compose down -v
rm -rf data/
./scripts/deploy-l3.sh
```

### Rollback to specific block

```bash
# Stop sequencing
docker compose stop op-batcher

# Debug rewind via op-geth
docker compose exec op-geth geth --datadir /data/op-geth debug setHead <block_hex>

# Restart
docker compose start op-batcher
```

## Security Notes

- All private keys are passed via environment variables, never baked into images
- JWT secret protects the Engine API from unauthorized access
- op-geth P2P is disabled (single-sequencer mode); no external peers
- The DA signer key should be a dedicated account, not shared with operator roles
- Rotate keys immediately if compromised; update .env and restart services
- Never expose port 8551 (Engine API) to the public internet
