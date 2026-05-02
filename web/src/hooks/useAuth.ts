import { useContext } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { AuthContext } from '@/providers/AuthProvider'

export interface AuthUser {
  address: string
  createdAt: string
}

export interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
  walletAddress: string | null
  login: () => Promise<void>
  logout: () => void
  /** Re-sign credentials if they are stale. Resolves silently if still fresh. */
  ensureFreshCredentials: () => Promise<void>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export interface WalletAuthCredentials {
  address: string
  signature: string
  timestamp: string
  message: string
}

// Internal hook used by AuthProvider to drive wallet signature auth.
// The message format must match the backend walletAuth middleware:
//   InjectMe:attack:<challengeAddress>:<timestamp>
// The challenge address in the auth context uses the zero address as placeholder
// since login is not challenge-specific at this stage.
export function useWalletAuth(
  onSuccess: (address: string, credentials: WalletAuthCredentials) => void,
) {
  const { address } = useAccount()
  const { mutateAsync: signMessage } = useSignMessage()

  const login = async () => {
    if (!address) throw new Error('No wallet connected')

    const timestamp = Date.now().toString()
    // Use the user's own address as the challenge address for general auth
    const message = `InjectMe:attack:${address}:${timestamp}`

    const signature = await signMessage({ message })

    const credentials: WalletAuthCredentials = {
      address,
      signature,
      timestamp,
      message,
    }

    onSuccess(address, credentials)
  }

  return { login, address }
}
