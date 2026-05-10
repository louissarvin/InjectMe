# BreakBase Web

AI adversarial testing platform on Base L2. Players attack AI-defended challenges for USDC prize pools.

![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TanStack Start](https://img.shields.io/badge/TanStack_Start-1.x-FF4154)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![wagmi](https://img.shields.io/badge/wagmi-3.x-35324A)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-F9F1E1?logo=bun&logoColor=black)
![Vite 7](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![HeroUI](https://img.shields.io/badge/HeroUI-2.x-7C3AED)

## Features

- Challenge creation with on-chain deployment (EIP-5792 batch calls)
- Real-time AI chat interface for attacking challenges
- x402 micropayment-gated analytics dashboard
- Automated OWASP security test suite
- AI agent dashboard with autonomous actions
- EAS attestation viewer
- Leaderboard with basename resolution
- Coinbase Smart Wallet with gas sponsorship
- Farcaster MiniApp support
- Dark/light mode with system preference detection

## Quick Start

```bash
bun install
bun dev          # starts on http://localhost:3200
bun build        # production build
bun preview      # preview production build
```

Set `VITE_API_URL` to point at the backend (defaults to `http://localhost:3700`).

## Routes

| Route                | Page         | Description                                |
| -------------------- | ------------ | ------------------------------------------ |
| `/`                  | Home         | Landing page with platform overview        |
| `/challenges`        | Challenges   | Browse and filter active challenges        |
| `/challenges/create` | Create       | Deploy a new AI challenge on-chain         |
| `/challenges/:id`    | Detail       | Chat interface to attack the AI defender   |
| `/leaderboard`       | Leaderboard  | Player rankings with basename resolution   |
| `/analytics`         | Analytics    | x402-gated data marketplace                |
| `/test-suite`        | Test Suite   | Automated OWASP security testing           |
| `/agent`             | Agent        | AI agent dashboard with autonomous actions |
| `/attestations`      | Attestations | EAS attestation viewer                     |
| `/profile`           | Profile      | User stats and settings                    |

## Wallet Integration

The app uses **Coinbase Smart Wallet** in `smartWalletOnly` mode via wagmi v3.

- **EIP-5792 batch transactions** combine approve + action into a single user confirmation (e.g., approve USDC then create challenge in one call)
- **Gas sponsorship** via CDP Paymaster, injected through wagmi's `capabilities` parameter
- **SIWE authentication** with ERC-1271 smart contract signature verification for smart wallet compatibility
- **Farcaster Frame connector** enables wallet access inside Farcaster MiniApps

Configuration lives in `src/lib/wagmi.ts`.

## x402 Payment Flow

The x402 protocol enables HTTP-native micropayments. When the backend returns a `402 Payment Required` response, the client automatically signs a USDC payment authorization and retries the request.

```
X402Provider
  └── X402Sync (effect)
        ├── useX402Fetch()
        │     ├── Creates ExactEvmScheme signer from wagmi wallet
        │     ├── Registers signer with x402Client for eip155:84532 (Base Sepolia)
        │     └── Returns wrapFetchWithPayment(globalThis.fetch, client)
        └── apiClient.setFetch(wrappedFetch)
              └── All API calls now auto-handle 402 responses
```

1. `X402Provider` wraps the app and renders `X402Sync`
2. `useX402Fetch` creates an `ExactEvmScheme` signer from the connected wagmi wallet
3. `wrapFetchWithPayment` wraps native `fetch` to intercept 402 responses
4. `apiClient.setFetch()` injects the wrapped fetch into the API client
5. Any HTTP 402 response triggers automatic USDC payment signing and request retry

Source: `src/hooks/useX402Fetch.ts`, `src/providers/X402Provider.tsx`

## Smart Contract Hooks

All contract interaction hooks live in `src/lib/contracts/hooks.ts`.

### EIP-5792 Batch Hooks

| Hook                           | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `useApproveAndCreateChallenge` | Approve USDC + create challenge in one batch call              |
| `useApproveAndSendMessage`     | Approve USDC + send message (attack attempt) in one batch call |
| `useApproveAndSeedPrizePool`   | Approve USDC + seed prize pool in one batch call               |

### Read Hooks

| Hook                     | Description                                    |
| ------------------------ | ---------------------------------------------- |
| `useUSDCBalance`         | USDC balance for a given address               |
| `useUSDCAllowance`       | USDC allowance for owner/spender pair          |
| `useChallengePrizePool`  | Current prize pool for a challenge clone       |
| `useChallengeCurrentFee` | Current fee to send a message                  |
| `useListingFee`          | Factory listing fee for creating challenges    |
| `useFactoryPaused`       | Whether the factory is paused                  |
| `useFeeDistributorStats` | Total collected, distributed, and agent wallet |
| `useFeeDistribution`     | Fee split BPS (pool, defender, protocol)       |
| `useReputationSchemas`   | EAS schema IDs for attacker, defender, audit   |

### Write Hooks

| Hook                        | Description                             |
| --------------------------- | --------------------------------------- |
| `useCreateChallengeOnChain` | Direct challenge creation (non-batched) |
| `useSendMessageOnChain`     | Direct message send (non-batched)       |
| `useResolveChallenge`       | Resolve challenge with server signature |
| `useSeedPrizePool`          | Seed additional USDC into prize pool    |
| `useCancelChallenge`        | Cancel an active challenge              |

### Emergency Hooks

| Hook                            | Description                               |
| ------------------------------- | ----------------------------------------- |
| `useEmergencyRequestedAt`       | Timestamp of emergency withdrawal request |
| `useRequestEmergencyWithdrawal` | Request emergency withdrawal              |
| `useExecuteEmergencyWithdrawal` | Execute after timelock expires            |
| `useCancelEmergencyWithdrawal`  | Cancel emergency request                  |
| `useEmergencyTimelock`          | Timelock duration constant                |

## API Hooks

`src/lib/api/hooks.ts` exports 33 TanStack Query hooks covering all backend endpoints: authentication, challenges, messages, leaderboard, analytics, attestations, agent actions, and test suite results. All hooks use the shared `apiClient` and automatically benefit from x402 payment handling when the provider is active.

## Providers

All providers are composed in `src/routes/__root.tsx`.

| Provider                    | File                                          | Purpose                              |
| --------------------------- | --------------------------------------------- | ------------------------------------ |
| `AuthProvider`              | `src/providers/AuthProvider.tsx`              | SIWE auth state and token management |
| `FarcasterProvider`         | `src/providers/FarcasterProvider.tsx`         | Farcaster MiniApp SDK context        |
| `HeroUIProvider`            | `src/providers/HeroUIProvider.tsx`            | HeroUI component theme provider      |
| `LenisSmoothScrollProvider` | `src/providers/LenisSmoothScrollProvider.tsx` | Lenis smooth scrolling               |
| `ThemeProvider`             | `src/providers/ThemeProvider.tsx`             | Dark/light mode state                |
| `WagmiProvider`             | `src/providers/WagmiProvider.tsx`             | Wallet connection and chain config   |
| `X402Provider`              | `src/providers/X402Provider.tsx`              | x402 micropayment fetch injection    |

## Project Structure

```
src/
├── components/              # Shared UI components
│   ├── elements/            # Generic reusable elements
│   │   ├── AnimateComponent.tsx
│   │   └── ScrollRevealText.tsx
│   ├── ChallengeCard.tsx
│   ├── ConnectButton.tsx
│   ├── CountdownTimer.tsx
│   ├── ErrorPage.tsx
│   ├── Footer.tsx
│   ├── GlassCard.tsx
│   ├── Navbar.tsx
│   └── StatusBadge.tsx
├── hooks/                   # Custom React hooks
│   ├── useAuth.ts
│   ├── useFarcaster.ts
│   ├── usePaymaster.ts
│   └── useX402Fetch.ts
├── integrations/            # Framework integrations
│   └── tanstack-query/
├── lib/                     # External service integrations
│   ├── api/
│   │   ├── client.ts        # API client with x402 fetch injection
│   │   └── hooks.ts         # 33 TanStack Query hooks
│   ├── contracts/
│   │   ├── abis.ts          # Contract ABIs
│   │   ├── addresses.ts     # Deployed contract addresses
│   │   └── hooks.ts         # wagmi contract hooks
│   ├── polyfills.ts
│   └── wagmi.ts             # Wagmi config (chains, connectors, transports)
├── providers/               # React context providers (7 total)
├── routes/                  # File-based routes (TanStack Router)
│   ├── __root.tsx           # Root layout, provider composition
│   ├── index.tsx            # Home
│   ├── challenges/
│   │   ├── index.tsx        # Challenge list
│   │   ├── create.tsx       # Challenge creation
│   │   └── $id.tsx          # Challenge detail / chat
│   ├── leaderboard.tsx
│   ├── analytics.tsx
│   ├── test-suite.tsx
│   ├── agent.tsx
│   ├── attestations.tsx
│   └── profile.tsx
├── utils/                   # Pure helper functions
│   ├── style.ts             # cnm() (clsx + tailwind-merge)
│   └── format.ts            # Number/currency/date formatting
├── config.ts                # App config, contract addresses, feature flags
├── env.ts                   # Environment variable validation
├── router.tsx               # Router setup
├── routeTree.gen.ts         # Auto-generated route tree
└── styles.css               # Global styles
```

## Scripts

| Command       | Description                       |
| ------------- | --------------------------------- |
| `bun dev`     | Start dev server on port 3200     |
| `bun build`   | Production build via Vite + Nitro |
| `bun preview` | Preview production build locally  |
| `bun lint`    | Run ESLint                        |
| `bun format`  | Run Prettier                      |
| `bun check`   | Prettier write + ESLint fix       |
| `bun test`    | Run Vitest test suite             |

## Configuration

`src/config.ts` exports a typed `AppConfig` object.

**Contract Addresses** (Base Sepolia, chain ID 84532):

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| ChallengeFactory | `0x3C0A3Eb807Df9409979A5eCBD97DCb3B157bcC3B` |
| FeeDistributor   | `0xCAcb144151DB5442caA05258673Faf6f1BB6Ba02` |
| ReputationOracle | `0xc671E09ED9cC6c4FeAA837A01370D65d8EC452B7` |
| USDC             | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

**Feature Flags**: `smoothScroll`, `dataMarketplace`, `testSuite`, `attestations`, `emergencyWithdrawal`, `prizePoolSeeding`, `agentAnalysis`, `x402Payments`, `onchainAnalytics`

**Environment Variables**:

| Variable       | Required | Default                 | Description          |
| -------------- | -------- | ----------------------- | -------------------- |
| `VITE_API_URL` | No       | `http://localhost:3700` | Backend API base URL |
