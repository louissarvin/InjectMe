import { WagmiProvider as Provider } from 'wagmi'
import type { State } from 'wagmi'
import { wagmiConfig } from '@/lib/wagmi'

interface WagmiProviderProps {
  children: React.ReactNode
  initialState?: State
}

export default function WagmiProvider({
  children,
  initialState,
}: WagmiProviderProps) {
  return (
    <Provider config={wagmiConfig} initialState={initialState}>
      {children}
    </Provider>
  )
}
