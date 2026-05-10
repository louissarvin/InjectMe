import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { mockUseAccount, mockUseSignMessage } from '@/test/mocks/wagmi'

// Activate wagmi mocks
import '@/test/mocks/wagmi'

import { useAuth, useWalletAuth } from '@/hooks/useAuth'
import { AuthContext } from '@/providers/AuthProvider'
import type { AuthState } from '@/hooks/useAuth'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth())
    }).toThrow('useAuth must be used within AuthProvider')
  })

  it('returns auth state from context', () => {
    const mockState: AuthState = {
      isAuthenticated: true,
      user: { address: '0xuser', createdAt: '2026-01-01' },
      walletAddress: '0xuser',
      login: vi.fn(),
      logout: vi.fn(),
      ensureFreshCredentials: vi.fn(),
    }

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: mockState }, children)

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user?.address).toBe('0xuser')
    expect(result.current.walletAddress).toBe('0xuser')
  })

  it('returns unauthenticated state', () => {
    const mockState: AuthState = {
      isAuthenticated: false,
      user: null,
      walletAddress: null,
      login: vi.fn(),
      logout: vi.fn(),
      ensureFreshCredentials: vi.fn(),
    }

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(AuthContext.Provider, { value: mockState }, children)

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })
})

describe('useWalletAuth', () => {
  it('calls signMessage with correct format and invokes onSuccess', async () => {
    const mockSignFn = vi.fn().mockResolvedValue('0xsig123')
    mockUseAccount.mockReturnValue({
      address: '0xUserAddr',
      isConnected: true,
    })
    mockUseSignMessage.mockReturnValue({
      mutateAsync: mockSignFn,
    })

    const onSuccess = vi.fn()
    const { result } = renderHook(() => useWalletAuth(onSuccess))

    expect(result.current.address).toBe('0xUserAddr')

    await result.current.login()

    // Sign message should have been called with the auth format
    expect(mockSignFn).toHaveBeenCalledWith({
      message: expect.stringMatching(/^InjectMe:attack:0xUserAddr:\d+$/),
    })

    // onSuccess should receive address and credentials
    expect(onSuccess).toHaveBeenCalledWith(
      '0xUserAddr',
      expect.objectContaining({
        address: '0xUserAddr',
        signature: '0xsig123',
        message: expect.stringMatching(/^InjectMe:attack:0xUserAddr:\d+$/),
      }),
    )
  })

  it('throws when no wallet is connected', async () => {
    mockUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    })

    const onSuccess = vi.fn()
    const { result } = renderHook(() => useWalletAuth(onSuccess))

    await expect(result.current.login()).rejects.toThrow('No wallet connected')
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
