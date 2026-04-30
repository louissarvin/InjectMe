import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import type {
  AuthState,
  AuthUser,
  WalletAuthCredentials,
} from '@/hooks/useAuth'
import { apiClient } from '@/lib/api/client'
import { useWalletAuth } from '@/hooks/useAuth'

export const AuthContext = createContext<AuthState | null>(null)

/**
 * Backend enforces a 5-minute window on message timestamps.
 * We refresh credentials before they go stale (4 min threshold).
 * The "session" (knowing the user signed in) lasts 24 hours.
 */
const CREDENTIAL_FRESHNESS_MS = 4 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const STORAGE_KEY = 'injectme_auth'

interface StoredAuth {
  address: string
  credentials: WalletAuthCredentials
  timestamp: number
}

/**
 * Load stored auth. The session is valid for 24 hours (to keep the user
 * "signed in" across refreshes). The actual API credentials might be stale
 * and will be refreshed via ensureFreshCredentials() before API calls.
 */
function loadStoredAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredAuth
    if (Date.now() - stored.timestamp > SESSION_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return stored
  } catch {
    return null
  }
}

function saveStoredAuth(
  address: string,
  credentials: WalletAuthCredentials,
  timestamp: number,
) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ address, credentials, timestamp } satisfies StoredAuth),
    )
  } catch {
    // sessionStorage full or unavailable
  }
}

function clearStoredAuth() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Are the stored credentials fresh enough for the backend's 5-min window? */
function areCredentialsFresh(timestamp: number | null): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp < CREDENTIAL_FRESHNESS_MS
}

interface AuthProviderProps {
  children: React.ReactNode
}

function AuthConsumer({ children }: AuthProviderProps) {
  const { address: connectedAddress, isReconnecting } = useAccount()

  // Restore from sessionStorage on mount
  const stored = useRef(loadStoredAuth())
  const [walletAddress, setWalletAddress] = useState<string | null>(
    stored.current?.address ?? null,
  )
  const [user, setUser] = useState<AuthUser | null>(
    stored.current
      ? { address: stored.current.address, createdAt: new Date().toISOString() }
      : null,
  )
  const credentialTimestamp = useRef<number | null>(
    stored.current?.timestamp ?? null,
  )

  // Track whether wagmi has had a chance to reconnect after mount.
  // Without this, the disconnect watcher fires before wagmi restores the
  // connection from cookies, which nukes the auth session on every refresh.
  const hasConnectedOnce = useRef(!!connectedAddress)
  useEffect(() => {
    if (connectedAddress) hasConnectedOnce.current = true
  }, [connectedAddress])

  // Hydrate apiClient from storage on mount (only if credentials are still fresh)
  useEffect(() => {
    if (stored.current && areCredentialsFresh(stored.current.timestamp)) {
      apiClient.setWalletCredentials(stored.current.credentials)
    }
  }, [])

  // If the connected wallet changes (e.g. user switched accounts), clear stale auth
  useEffect(() => {
    if (
      connectedAddress &&
      walletAddress &&
      connectedAddress.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      setWalletAddress(null)
      setUser(null)
      apiClient.clearWalletCredentials()
      clearStoredAuth()
      credentialTimestamp.current = null
    }
  }, [connectedAddress, walletAddress])

  // If wallet explicitly disconnects, clear auth.
  // Skip during reconnection phase (wagmi is restoring from cookies).
  useEffect(() => {
    if (isReconnecting) return
    if (!hasConnectedOnce.current) return
    if (!connectedAddress && walletAddress) {
      setWalletAddress(null)
      setUser(null)
      apiClient.clearWalletCredentials()
      clearStoredAuth()
      credentialTimestamp.current = null
    }
  }, [connectedAddress, walletAddress, isReconnecting])

  const handleAuthSuccess = useCallback(
    (address: string, credentials: WalletAuthCredentials) => {
      const now = Date.now()
      setWalletAddress(address)
      setUser({ address, createdAt: new Date().toISOString() })
      apiClient.setWalletCredentials(credentials)
      credentialTimestamp.current = now
      saveStoredAuth(address, credentials, now)
    },
    [],
  )

  const { login: walletLogin } = useWalletAuth(handleAuthSuccess)

  const logout = useCallback(() => {
    setWalletAddress(null)
    setUser(null)
    apiClient.clearWalletCredentials()
    clearStoredAuth()
    credentialTimestamp.current = null
  }, [])

  /**
   * Ensure API credentials are fresh before making a backend call.
   * If the signed message timestamp is close to the 5-min backend limit,
   * silently re-sign. No-op if credentials are still fresh.
   */
  const ensureFreshCredentials = useCallback(async () => {
    if (!walletAddress) {
      await walletLogin()
      return
    }
    if (areCredentialsFresh(credentialTimestamp.current)) return
    // Stale or missing: re-sign transparently
    await walletLogin()
  }, [walletAddress, walletLogin])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!walletAddress,
        user,
        walletAddress,
        login: walletLogin,
        logout,
        ensureFreshCredentials,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: AuthProviderProps) {
  return <AuthConsumer>{children}</AuthConsumer>
}
