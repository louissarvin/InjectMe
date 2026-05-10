import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockUseReadContract, mockUseWriteContract } from '@/test/mocks/wagmi'

// Activate the wagmi mock
import '@/test/mocks/wagmi'

import {
  useAgentBalance,
  useAttackerReputation,
  useBountyListingFee,
  useChallengeCount,
  useChallengePrizePool,
  useClaimExpiry,
  useCommitAttempt,
  useFactoryConfig,
  usePendingWithdrawal,
  useStakingConfig,
  useWithdraw,
} from '@/lib/contracts/hooks'
import { CONTRACT_ADDRESSES } from '@/lib/contracts/addresses'
import { renderHook } from '@testing-library/react'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseReadContract.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  mockUseWriteContract.mockReturnValue({
    writeContractAsync: vi.fn().mockResolvedValue('0xtxhash'),
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  })
})

describe('useChallengePrizePool', () => {
  it('calls useReadContract with challenge abi and prizePool function', () => {
    renderHook(() => useChallengePrizePool('0xCHALLENGE' as `0x${string}`))

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xCHALLENGE',
        functionName: 'prizePool',
        query: expect.objectContaining({
          enabled: true,
          refetchInterval: 10_000,
        }),
      }),
    )
  })

  it('is disabled when address is undefined', () => {
    renderHook(() => useChallengePrizePool(undefined))

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: undefined,
        query: expect.objectContaining({ enabled: false }),
      }),
    )
  })
})

describe('usePendingWithdrawal', () => {
  it('passes both challenge and user address', () => {
    renderHook(() =>
      usePendingWithdrawal(
        '0xCHAL' as `0x${string}`,
        '0xUSER' as `0x${string}`,
      ),
    )

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xCHAL',
        functionName: 'pendingWithdrawals',
        args: ['0xUSER'],
        query: expect.objectContaining({ enabled: true }),
      }),
    )
  })

  it('is disabled when either address is missing', () => {
    renderHook(() => usePendingWithdrawal(undefined, '0xUSER' as `0x${string}`))

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    )
  })
})

describe('useCommitAttempt', () => {
  it('returns commitAttemptAsync that calls writeContractAsync with value', async () => {
    const { result } = renderHook(() =>
      useCommitAttempt('0xCHAL' as `0x${string}`),
    )

    await result.current.commitAttemptAsync(
      '0xCOMMIT' as `0x${string}`,
      BigInt(1000),
    )

    const writeContractAsync =
      mockUseWriteContract.mock.results[0].value.writeContractAsync
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xCHAL',
        functionName: 'commitAttempt',
        args: ['0xCOMMIT'],
        value: BigInt(1000),
      }),
    )
  })

  it('throws if challengeAddress is undefined', () => {
    const { result } = renderHook(() => useCommitAttempt(undefined))

    expect(() =>
      result.current.commitAttemptAsync('0xCOMMIT' as `0x${string}`, BigInt(0)),
    ).toThrow('challengeAddress is required')
  })
})

describe('useWithdraw', () => {
  it('returns withdrawAsync that calls writeContractAsync', async () => {
    const { result } = renderHook(() => useWithdraw('0xCHAL' as `0x${string}`))

    await result.current.withdrawAsync()

    const writeContractAsync =
      mockUseWriteContract.mock.results[0].value.writeContractAsync
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xCHAL',
        functionName: 'withdraw',
      }),
    )
  })

  it('throws if challengeAddress is undefined', () => {
    const { result } = renderHook(() => useWithdraw(undefined))
    expect(() => result.current.withdrawAsync()).toThrow(
      'challengeAddress is required',
    )
  })
})

describe('useClaimExpiry', () => {
  it('returns claimExpiryAsync that calls writeContractAsync', async () => {
    const { result } = renderHook(() =>
      useClaimExpiry('0xCHAL' as `0x${string}`),
    )

    await result.current.claimExpiryAsync()

    const writeContractAsync =
      mockUseWriteContract.mock.results[0].value.writeContractAsync
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xCHAL',
        functionName: 'claimExpiry',
      }),
    )
  })
})

describe('useBountyListingFee', () => {
  it('uses factory address', () => {
    renderHook(() => useBountyListingFee())

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT_ADDRESSES.challengeFactory,
        functionName: 'bountyListingFee',
      }),
    )
  })
})

describe('useFactoryConfig', () => {
  it('makes three separate reads for fee, minPrize, and minMessage', () => {
    renderHook(() => useFactoryConfig())

    // Should have been called 3 times for protocolFeeBps, minPrizePool, minMessagePrice
    expect(mockUseReadContract).toHaveBeenCalledTimes(3)

    const calls = mockUseReadContract.mock.calls
    const fnNames = calls.map(
      (c: Array<{ functionName: string }>) => c[0].functionName,
    )
    expect(fnNames).toContain('protocolFeeBps')
    expect(fnNames).toContain('minPrizePool')
    expect(fnNames).toContain('minMessagePrice')

    // All should use the factory address
    for (const call of calls) {
      expect(call[0].address).toBe(CONTRACT_ADDRESSES.challengeFactory)
    }
  })
})

describe('useChallengeCount', () => {
  it('reads from factory with getChallengeCount', () => {
    renderHook(() => useChallengeCount())

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT_ADDRESSES.challengeFactory,
        functionName: 'getChallengeCount',
      }),
    )
  })
})

describe('useAgentBalance', () => {
  it('reads from agentNFT address with balanceOf', () => {
    renderHook(() => useAgentBalance('0xOWNER' as `0x${string}`))

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT_ADDRESSES.agentNFT,
        functionName: 'balanceOf',
        args: ['0xOWNER'],
      }),
    )
  })
})

describe('useAttackerReputation', () => {
  it('reads from reputation registry', () => {
    renderHook(() => useAttackerReputation('0xATK' as `0x${string}`))

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT_ADDRESSES.reputationRegistry,
        functionName: 'getAttackerReputation',
        args: ['0xATK'],
      }),
    )
  })
})

describe('useStakingConfig', () => {
  it('makes three reads for minStake, activeOracleCount, confirmationsRequired', () => {
    renderHook(() => useStakingConfig())

    expect(mockUseReadContract).toHaveBeenCalledTimes(3)
    const fnNames = mockUseReadContract.mock.calls.map(
      (c: Array<{ functionName: string }>) => c[0].functionName,
    )
    expect(fnNames).toContain('minStake')
    expect(fnNames).toContain('activeOracleCount')
    expect(fnNames).toContain('confirmationsRequired')
  })
})
