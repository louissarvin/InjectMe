import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { cookieStorage, createConfig, createStorage, http } from 'wagmi'
import { zeroGMainnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { env } from '@/env'

const projectId = env.VITE_WALLETCONNECT_PROJECT_ID ?? ''

/**
 * Cookie storage keeps wagmi's connection state across page refreshes,
 * preventing the "RETRY" loop in RainbowKit where the wallet is already
 * connected but wagmi doesn't know about it after a refresh.
 */
const persistentStorage = createStorage({ storage: cookieStorage })

/**
 * When a WalletConnect projectId is available, use RainbowKit's getDefaultConfig
 * which bundles MetaMask, Coinbase, Rainbow, WalletConnect wallets automatically.
 * Otherwise fall back to a minimal config with just the injected (browser) connector.
 */
export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: 'InjectMe',
      projectId,
      chains: [zeroGMainnet],
      ssr: true,
      storage: persistentStorage,
      transports: {
        [zeroGMainnet.id]: http('https://evmrpc.0g.ai'),
      },
    })
  : createConfig({
      chains: [zeroGMainnet],
      connectors: [injected()],
      storage: persistentStorage,
      ssr: true,
      transports: {
        [zeroGMainnet.id]: http('https://evmrpc.0g.ai'),
      },
    })
