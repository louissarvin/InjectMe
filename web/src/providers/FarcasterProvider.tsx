import { createContext, useContext } from 'react'

// Farcaster is not applicable on 0G Mainnet (Aristotle).
// This passthrough provider preserves existing import contracts.

interface FarcasterContextValue {
  isInMiniApp: boolean
  context: null
  isReady: boolean
}

const FarcasterContext = createContext<FarcasterContextValue>({
  isInMiniApp: false,
  context: null,
  isReady: true,
})

export function FarcasterProvider({ children }: { children: React.ReactNode }) {
  return (
    <FarcasterContext.Provider
      value={{ isInMiniApp: false, context: null, isReady: true }}
    >
      {children}
    </FarcasterContext.Provider>
  )
}

export function useFarcasterContext() {
  return useContext(FarcasterContext)
}
